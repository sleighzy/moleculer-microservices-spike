const { Service } = require('moleculer');
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');

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
      fields: ['_id', 'customerId', 'product', 'quantity', 'price', 'created', 'updated', 'state'],
      model: mongoose.model('Order', mongoose.Schema({
        customerId: { type: Number },
        product: { type: String },
        quantity: { type: Number },
        price: { type: Number },
        state: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'] },
        created: { type: Date, default: Date.now },
        updated: { type: Date, default: Date.now },
      })),

      settings: {
        bootstrapServer: process.env.ORDERS_BOOTSTRAP_SERVER || 'localhost:9092',
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

      // These entityX functions are called by the moleculer-db
      // mixin when entities are created, updated, or deleted.
      entityCreated: this.orderCreated,
      entityUpdated: this.orderUpdated,

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  submitOrder(ctx) {
    const { customerId, product, quantity, price } = ctx.params.order; // eslint-disable-line object-curly-newline
    this.logger.debug('Submit Order:', customerId, product, quantity, price);

    const order = {
      customerId,
      product,
      quantity,
      price,
      state: 'Pending',
    };
    // This calls "orders.insert" which is the insert() function from the DbService mixin.
    return ctx.call('orders.insert', { entity: order });
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
    this.logger.debug('Update order state:', id, state);
    // This calls "orders.update" which is the update() function from the DbService mixin.
    return ctx.call('orders.update', { id, state, updated: Date.now() });
  }

  orderCreated(order, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('Order created:', order);
    return this.sendEvent(order, 'OrderCreated');
  }

  orderUpdated(order, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('Order updated:', order);
    return this.sendEvent(order, 'OrderUpdated');
  }

  sendEvent(order, type) {
    return new this.Promise((resolve, reject) => {
      if (!order) {
        reject('No order found when sending event.');
      }
      if (!type) {
        reject('No event type specified when sending event.');
      }

      const data = order;
      data.eventType = type;
      this.logger.debug('data:', data);
      const payload = this.createPayload(data);
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

  createPayload(data) {
    const message = new KeyedMessage(data.id, JSON.stringify(data));
    return [{
      topic: this.settings.ordersTopic,
      messages: [message],
      attributes: 1, // Use GZip compression for the payload.
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
