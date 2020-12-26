const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');
const Kafka = require('kafka-node');

class OrdersService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'orders',
      meta: {
        scalable: true,
      },

      mixins: [DbService],

      adapter: new MongooseAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: [
        '_id',
        'customerId',
        'product',
        'quantity',
        'price',
        'created',
        'updated',
        'state',
      ],
      model: mongoose.model(
        'Order',
        mongoose.Schema({
          customerId: { type: Number },
          product: { type: String },
          quantity: { type: Number },
          price: { type: Number },
          state: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'],
          },
          created: { type: Date, default: Date.now },
          updated: { type: Date, default: Date.now },
        }),
      ),

      settings: {
        bootstrapServer:
          process.env.ORDERS_BOOTSTRAP_SERVER || 'localhost:9092',
        ordersTopic: process.env.ORDERS_TOPIC || 'orders',
      },

      actions: {
        create: {
          params: {
            order: {
              type: 'object',
              props: {
                customerId: 'string',
                product: 'string',
                quantity: { type: 'number', positive: true, integer: true },
                price: { type: 'number', positive: true },
              },
            },
          },
          handler: this.submitOrder,
        },
        remove: {
          handler: this.cancelOrder,
        },
      },

      events: {
        // No events
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  submitOrder(ctx) {
    const { customerId, product, quantity, price } = ctx.params.order;
    this.logger.debug('Submit Order:', customerId, product, quantity, price);

    const order = {
      customerId,
      product,
      quantity,
      price,
      state: 'Pending',
    };
    return this.sendEvent(order, 'OrderCreated');
  }

  rejectOrder(ctx) {
    const { id } = ctx.params;
    this.logger.debug('Rejecting Order:', id);
    return this.updateOrderState(ctx, id, 'Rejected');
  }

  cancelOrder(ctx) {
    const { id } = ctx.params;
    this.logger.debug('Cancelling Order:', id);
    return this.updateOrderState(ctx, id, 'Cancelled');
  }

  completeOrder(ctx) {
    const { id } = ctx.params;
    this.logger.debug('Completing Order:', id);
    return this.updateOrderState(ctx, id, 'Completed');
  }

  // Private methods
  updateOrderState(ctx, id, state) {
    return this.sendEvent({ id, state, updated: Date.now() }, 'OrderUpdated');
  }

  /**
   * Function to create a Kafka producer to publish order events to a kafka topic.
   */
  startKafkaProducer() {
    const client = new KafkaClient({
      kafkaHost: this.settings.bootstrapServer,
    });

    // For this demo we just log client errors to the console.
    client.on('error', (error) => this.logger.error(error));

    this.producer = new HighLevelProducer(client, {
      // Configuration for when to consider a message as acknowledged, default 1
      requireAcks: 1,
      // The amount of time in milliseconds to wait for all acks before considered, default 100ms
      ackTimeoutMs: 100,
      // Partitioner type (default = 0, random = 1, cyclic = 2, keyed = 3, custom = 4), default 2
      partitionerType: 3,
    });

    this.producer.on('error', (error) => this.logger.error(error));
  }

  /**
   * Function to create a Kafka consumer and start consuming events off the order topic.
   */
  startKafkaConsumer() {
    const kafkaOptions = {
      kafkaHost: this.settings.bootstrapServer, // connect directly to kafka broker (instantiates a KafkaClient)
      batch: undefined, // put client batch settings if you need them (see Client)
      // ssl: true, // optional (defaults to false) or tls options hash
      groupId: 'kafka-node-orders',
      sessionTimeout: 15000,
      // An array of partition assignment protocols ordered by preference.
      // 'roundrobin' or 'range' string for built ins (see below to pass in custom assignment protocol)
      protocol: ['roundrobin'],

      // Set encoding to 'buffer' for binary data.
      // encoding: 'buffer',

      // Offsets to use for new groups other options could be 'earliest' or 'none' (none will emit an error if no offsets were saved)
      // equivalent to Java client's auto.offset.reset
      fromOffset: 'latest', // default

      // how to recover from OutOfRangeOffset error (where save offset is past server retention) accepts same value as fromOffset
      outOfRangeOffset: 'earliest', // default
      migrateHLC: false, // for details please see Migration section below
      migrateRolling: true,
    };

    this.consumer = new Kafka.ConsumerGroup(
      kafkaOptions,
      this.settings.ordersTopic,
    );
    this.consumer.on('message', (message) => this.processEvent(message.value));
    this.consumer.on('error', (err) =>
      this.Promise.reject(
        new MoleculerError(
          `${err.message} ${err.detail}`,
          500,
          'CONSUMER_MESSAGE_ERROR',
        ),
      ),
    );

    process.on('SIGINT', () => this.consumer.close(true));
  }

  /**
   * Function to consume order events from a Kafka topic and process them.
   *
   * @param {Object} event event containing event tpye and order information.
   * @returns {Promise}
   */
  processEvent(event) {
    this.logger.debug(event);
    const orderEvent = JSON.parse(event);

    return new this.Promise((resolve) => {
      if (orderEvent.eventType === 'OrderCreated') {
        // This calls "orders.insert" which is the insert() function from the DbService mixin.
        resolve(
          this.broker.call('orders.insert', { entity: orderEvent.order }),
        );
      } else if (orderEvent.eventType === 'OrderUpdated') {
        // This calls "orders.update" which is the update() function from the DbService mixin.
        resolve(this.broker.call('orders.update', orderEvent.order));
      } else {
        // Not an error as services may publish different event types in the future.
        this.logger.debug('Unknown eventType:', orderEvent.eventType);
      }
    });
  }

  /**
   * Function to publish order event data to a Kafka topic.
   *
   * @param {Object} order the order information
   * @param {String} type the event type
   * @returns {Promise}
   */
  sendEvent(order, type) {
    return new this.Promise((resolve, reject) => {
      if (!order) {
        reject('No order found when sending event.');
      }
      if (!type) {
        reject('No event type specified when sending event.');
      }

      const payload = this.createPayload({ order, eventType: type });
      this.producer.send(payload, (error, result) => {
        this.logger.debug('Sent payload to Kafka:', JSON.stringify(payload));
        if (error) {
          reject(error);
        } else {
          this.logger.debug('Result:', result);
          resolve(result);
        }
      });
    });
  }

  /**
   * Function to create a Kafka message payload with an order event.
   *
   * @param {any} data Order event data.
   * @returns {Array} an array of order event messages.
   */
  createPayload(data) {
    const message = new KeyedMessage(data.product, JSON.stringify(data));
    return [
      {
        topic: this.settings.ordersTopic,
        messages: [message],
        attributes: 1, // Use GZip compression for the payload.
        timestamp: Date.now(),
      },
    ];
  }

  serviceCreated() {
    this.logger.debug('Orders service created.');
  }

  serviceStarted() {
    this.startKafkaProducer();
    this.startKafkaConsumer();

    this.logger.debug('Orders service started.');
  }

  serviceStopped() {
    this.logger.debug('Orders service stopped.');
  }
}

module.exports = OrdersService;
