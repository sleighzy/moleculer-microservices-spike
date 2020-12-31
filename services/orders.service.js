const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const KafkaService = require('../mixins/kafka.mixin');

class OrdersService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'orders',
      meta: {
        scalable: true,
      },

      mixins: [DbService, KafkaService],

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
   * @param {String} eventType the event type
   * @returns {Promise}
   */
  sendEvent(order, eventType) {
    return new this.Promise((resolve, reject) => {
      if (!order) {
        reject('No order provided when sending event.');
      }
      if (!eventType) {
        reject('No event type specified when sending event.');
      }

      this.sendMessage(
        this.settings.ordersTopic,
        { key: order.product, value: JSON.stringify({ eventType, order }) },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            this.logger.debug('Result:', result);
            resolve({ eventType, order });
          }
        },
      );
    });
  }

  serviceCreated() {
    this.logger.debug('Orders service created.');
  }

  serviceStarted() {
    this.logger.debug(this.settings);

    this.startKafkaProducer(this.settings.bootstrapServer, (error) =>
      this.logger.error(error),
    );

    // Start the Kafka consumer to read messages from the topic
    // to be sent to the Slack channel
    this.startKafkaConsumer(
      this.settings.bootstrapServer,
      this.settings.ordersTopic,
      (error, message) => {
        if (error) {
          this.Promise.reject(
            new MoleculerError(
              `${error.message} ${error.detail}`,
              500,
              'CONSUMER_MESSAGE_ERROR',
            ),
          );
        }

        this.processEvent(message.value);
      },
    );

    this.logger.debug('Orders service started.');
  }

  serviceStopped() {
    this.logger.debug('Orders service stopped.');
  }
}

module.exports = OrdersService;
