const { Service } = require('moleculer');
// const { MoleculerError } = require('moleculer').Errors;
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');
const JaegerService = require('moleculer-jaeger');

class OrdersService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'orders',
      meta: {
        scalable: true,
      },

      mixins: [DbService, JaegerService],

      adapter: new MongooseAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: ['_id', 'customerId', 'product', 'quantity', 'price', 'created'],
      model: mongoose.model('Order', mongoose.Schema({
        customerId: { type: Number },
        product: { type: String },
        quantity: { type: Number },
        price: { type: Number },
        created: { type: Date, default: Date.now },
      })),

      settings: {
        host: process.env.JAEGER_HOST || '127.0.0.1',
        bootstrapServer: process.env.ORDERS_BOOTSTRAP_SERVER || 'localhost:9092',
        ordersTopic: process.env.ORDERS_TOPIC || 'orders',
      },

      metrics: {
        params: true,
      },

      actions: {
        submitOrder: {
          params: {
            order: {
              type: 'object',
              props: {
                id: 'string',
                customerId: 'string',
                state: 'string',
                product: 'string',
                quantity: { type: 'number', positive: true, integer: true },
                price: { type: 'number', positive: true },
              },
            },
          },
          handler: this.submitOrder,
        },
        getOrder: {
          params: {
            id: 'string',
          },
          handler: this.getOrder,
        },
        getOrderValidation: {
          params: {
            id: 'string',
          },
          handler: this.getOrderValidation,
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
    return this.send(ctx.params.order);
  }

  getOrder(ctx) {
    this.logger.debug('Get Order:', ctx.params.id);
  }

  getOrderValidation(ctx) {
    this.logger.debug('Get Order Validation:', ctx.params.id);
  }

  // const payloads = [{
  //   topic: config.topic,
  //   messages: ['test 1', 'test 2'],
  //   attributes: 1, // Use GZip compression for the payload.
  //   timestamp: Date.now()
  // }];
  send(order) {
    const payload = this.createPayload(order);
    return new this.Promise((resolve, reject) => {
      this.producer.send(payload, (error, result) => {
        this.logger.debug('Sent payload to Kafka: ', payload);
        if (error) {
          reject(error);
        } else {
          // const formattedResult = result[0]
          this.logger.debug('result: ', result);
          resolve(result);
        }
      });
    });
  }

  createPayload(order) {
    const { id, customerId, state, product, quantity, price } = order; // eslint-disable-line object-curly-newline
    const message = new KeyedMessage(order.id, {
      id,
      customerId,
      state,
      product,
      quantity,
      price,
    });
    return [{
      topic: this.settings.ordersTopic,
      messages: [message],
      attributes: 1,
      timestamp: Date.now(),
    }];
  }

  serviceCreated() {
    this.logger.debug('Orders service created.');
  }

  serviceStarted() {
    const client = new KafkaClient({
      kafkaHost: this.settings.bootstrapServer,
    });

    // For this demo we just log client errors to the console.
    client.on('error', error => this.logger.error(error));

    client.on('error', error => this.logger.error(error));

    this.producer = new HighLevelProducer(client, {
      // Configuration for when to consider a message as acknowledged, default 1
      requireAcks: 1,
      // The amount of time in milliseconds to wait for all acks before considered, default 100ms
      ackTimeoutMs: 100,
      // Partitioner type (default = 0, random = 1, cyclic = 2, keyed = 3, custom = 4), default 2
      partitionerType: 3,
    });

    this.producer.on('error', error => this.logger.error(error));

    this.logger.debug('Orders service started.');
  }

  serviceStopped() {
    this.logger.debug('Orders service stopped.');
  }
}

module.exports = OrdersService;
