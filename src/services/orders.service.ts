import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import * as DbService from 'moleculer-db';
import MongooseDbAdapter from 'moleculer-db-adapter-mongoose';
import mongoose from 'mongoose';
import KafkaService from '../mixins/kafka.mixin';
import { OrderEvent, OrderEventType, OrderState } from '../types/orders';

interface ContextWithOrder extends Context {
  params: {
    id: string;
    order: {
      customerId: string;
      product: string;
      quantity: number;
      price: string;
    };
  };
}

class OrdersService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'orders',
      meta: {
        scalable: true,
      },

      mixins: [DbService, KafkaService],

      adapter: new MongooseDbAdapter('mongodb://mongodb:27017/moleculer-db'),
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
        new mongoose.Schema({
          customerId: { type: Number },
          product: { type: String },
          quantity: { type: Number },
          price: { type: Number },
          state: {
            type: String,
            enum: [
              OrderState.PENDING,
              OrderState.APPROVED,
              OrderState.REJECTED,
              OrderState.COMPLETED,
              OrderState.CANCELLED,
            ],
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

      started: this.serviceStarted,
    });
  }

  submitOrder(ctx: ContextWithOrder) {
    const { customerId, product, quantity, price } = ctx.params.order;
    this.logger.debug('Submit Order:', customerId, product, quantity, price);

    const order = {
      customerId,
      product,
      quantity,
      price,
      state: OrderState.PENDING,
    };
    return this.sendEvent(order, OrderEventType.ORDER_CREATED);
  }

  rejectOrder(ctx: ContextWithOrder) {
    const { id } = ctx.params;
    this.logger.debug('Rejecting Order:', id);
    return this.updateOrderState(ctx, id, OrderState.REJECTED);
  }

  cancelOrder(ctx: ContextWithOrder) {
    const { id } = ctx.params;
    this.logger.debug('Cancelling Order:', id);
    return this.updateOrderState(ctx, id, OrderState.CANCELLED);
  }

  completeOrder(ctx: ContextWithOrder) {
    const { id } = ctx.params;
    this.logger.debug('Completing Order:', id);
    return this.updateOrderState(ctx, id, OrderState.COMPLETED);
  }

  // Private methods
  updateOrderState(ctx: ContextWithOrder, id: string, state: string) {
    return this.sendEvent(
      { id, state, updated: Date.now() },
      OrderEventType.ORDER_UPDATED,
    );
  }

  /**
   * Function to consume order events from a Kafka topic and process them.
   *
   * @param {Object} event event containing event type and order information.
   * @returns {Promise}
   */
  processEvent(event: OrderEvent): Promise<unknown> {
    this.logger.debug(event);

    return new Promise((resolve: any) => {
      if (event.eventType === OrderEventType.ORDER_CREATED) {
        // This calls "orders.insert" which is the insert() function from the DbService mixin.
        resolve(this.broker.call('orders.insert', { entity: event.order }));
      } else if (event.eventType === OrderEventType.ORDER_UPDATED) {
        // This calls "orders.update" which is the update() function from the DbService mixin.
        resolve(this.broker.call('orders.update', event.order));
      } else {
        // Not an error as services may publish different event types in the future.
        this.logger.debug('Unknown eventType:', event.eventType);
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
  sendEvent(order: any, eventType: OrderEventType): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!order) {
        reject('No order provided when sending event.');
      }
      if (!eventType) {
        reject('No event type specified when sending event.');
      }

      this.sendMessage(
        this.settings.ordersTopic,
        { key: order.product, value: JSON.stringify({ eventType, order }) },
        (error: any, result: any) => {
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

  handleMessage = (error: any, message: string): void => {
    this.logger.debug(message);
    if (error) {
      Promise.reject(
        new MoleculerError(
          `${error.message} ${error.detail}`,
          500,
          'CONSUMER_MESSAGE_ERROR',
        ),
      );
    }
    this.processEvent(JSON.parse(message));
  };

  serviceStarted(): Promise<void> {
    this.logger.debug(this.settings);

    this.startKafkaProducer(this.settings.bootstrapServer, (error) =>
      this.logger.error(error),
    );

    // Start the Kafka consumer to read messages from the topic
    // to be sent to the Slack channel
    this.startKafkaConsumer({
      bootstrapServer: this.settings.bootstrapServer,
      topic: this.settings.ordersTopic,
      callback: this.handleMessage,
    });

    this.logger.debug('Orders service started.');

    return Promise.resolve();
  }
}

export default OrdersService;
