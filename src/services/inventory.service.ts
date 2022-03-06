import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import * as DbService from 'moleculer-db';
import MongooseDbAdapter from 'moleculer-db-adapter-mongoose';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import KafkaService from '../mixins/kafka.mixin';
import {
  InventoryEvent,
  InventoryEventType,
  InventoryItem,
  InventoryItemsResult,
  InventoryQuery,
  InventoryState,
} from '../types/inventory';
import { OrderEvent, OrderState } from '../types/orders';

interface ContextWithInventory extends Context {
  params: {
    id: string;
    item: {
      product: string;
      price: number;
    };
    product: string;
    quantity: number;
  };
}

class InventoryService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'inventory',
      meta: {
        scalable: true,
      },

      mixins: [DbService, KafkaService],

      adapter: new MongooseDbAdapter('mongodb://mongodb:27017/moleculer-db'),
      model: mongoose.model(
        'Product',
        new mongoose.Schema<InventoryItem>({
          _id: { type: String, default: uuidv4 },
          product: { type: String, required: true },
          price: { type: Number },
          state: {
            type: String,
            enum: [InventoryState.AVAILABLE, InventoryState.RESERVED, InventoryState.SHIPPED],
          },
          created: { type: Date, default: Date.now },
          updated: { type: Date, default: Date.now },
        }),
      ),

      settings: {
        bootstrapServer: process.env.INVENTORY_BOOTSTRAP_SERVER || 'localhost:9092',
        inventoryTopic: process.env.INVENTORY_TOPIC || 'inventory',
        ordersTopic: process.env.ORDERS_TOPIC || 'orders',
      },

      actions: {
        create: {
          params: {
            item: {
              type: 'object',
              props: {
                product: 'string',
                price: { type: 'number', positive: true },
              },
            },
          },
          handler: this.addItem,
        },
        reserve: {
          params: {
            product: 'string',
            quantity: 'number',
          },
          handler: this.reserveItems,
        },
        ship: {
          handler: this.shipItem,
        },
      },

      started: this.serviceStarted,
    });
  }

  addItem(ctx: ContextWithInventory): Promise<any> {
    const { product, price } = ctx.params.item;
    this.logger.debug('Add item:', product, price);

    const newProduct: InventoryItem = {
      _id: uuidv4(),
      product,
      price,
      state: InventoryState.AVAILABLE,
      created: Date.now(),
      updated: Date.now(),
    };

    return this.sendEvent({
      item: newProduct,
      eventType: InventoryEventType.ITEM_ADDED,
    });
  }

  async reserveItems(ctx: ContextWithInventory): Promise<InventoryItem[]> {
    const { product, quantity } = ctx.params;
    this.logger.debug('Reserve item:', product, quantity);

    const available = await this.getQuantity({ ctx, product, available: true });
    if (quantity > available) {
      // Emit an event that there is no further stock available
      this.broker.emit('inventory.insufficientStock', { product });

      throw new MoleculerError(`Not enough items available in inventory for product '${product}'.`);
    }

    // Retrieve "Available" items, limited by the requested quantity to reserve.
    // This calls "inventory.list" which is the list() function from the DbService mixin.
    // Update each item retrieved and set their state to "Reserved" while payment processing takes place.
    const result: InventoryItemsResult = await ctx.call('inventory.list', {
      query: { product, state: InventoryState.AVAILABLE },
      pageSize: quantity,
    });
    const availableItems = result.rows ?? [];
    this.logger.debug('Available items:', availableItems);

    availableItems.forEach((item) =>
      this.updateItemState({
        ctx,
        item,
        state: InventoryState.RESERVED,
      }),
    );

    return availableItems;
  }

  async freeItems(ids) {
    this.logger.debug('Free ids:', ids);
    // Call the getByIds() helper method from the DbService mixin
    // for the Mongoose adapter.
    const items = await this.getById(ids);
    this.logger.debug('Free items:', items);
    items.forEach((item) => this.updateItemState({ ctx: undefined, item: item._doc, state: InventoryState.AVAILABLE }));
  }

  async shipItem(ctx: ContextWithInventory): Promise<any> {
    const { id } = ctx.params;
    this.logger.debug('Ship item:', id);
    const item = await this.getItem({ ctx, id });
    return this.updateItemState({ ctx, item, state: InventoryState.SHIPPED });
  }

  // Private methods
  async getItem({ ctx, id }: { ctx: Context; id: string }): Promise<InventoryItem> {
    this.logger.debug('Get item:', id);
    const item: InventoryItem = await ctx.call('inventory.get', { id });
    if (!item) {
      return Promise.reject(
        new MoleculerError(`Inventory item not found for id '${id}'`, 404, 'NOT_FOUND', [
          { field: `${id}`, message: 'is not found' },
        ]),
      );
    }

    this.logger.debug('Item found:', item);
    return item;
  }

  getQuantity({
    ctx,
    product,
    available,
  }: {
    ctx: ContextWithInventory;
    product: string;
    available: boolean;
  }): Promise<number> {
    this.logger.debug('Get quantity:', product, available);
    // Filter for "Available" items only, otherwise return all.
    const query: InventoryQuery = {
      product,
      state: available ? InventoryState.AVAILABLE : '',
    };
    // This calls "inventory.count" which is the count() function from the DbService mixin.
    return ctx.call('inventory.count', { query });
  }

  updateItemState({
    ctx, // eslint-disable-line @typescript-eslint/no-unused-vars
    item,
    state,
  }: {
    ctx: ContextWithInventory | undefined;
    item: InventoryItem;
    state: InventoryState;
  }): Promise<any> {
    this.logger.debug('Update item state:', { id: item._id, product: item.product, state });

    return this.sendEvent({ item: { ...item, state }, eventType: InventoryEventType.ITEM_UPDATED });
  }

  /**
   * Function to publish item event data to a Kafka topic.
   *
   * @param {Object} item the item information
   * @param {eventType} type the event type
   * @returns {Promise}
   */
  async sendEvent(event: InventoryEvent): Promise<any> {
    return new Promise((resolve, reject) => {
      const { item, eventType } = event;
      if (!item) {
        reject('No inventory item provided when sending event.');
      }
      if (!eventType) {
        reject('No event type specified when sending event.');
      }

      this.sendMessage(
        this.settings.inventoryTopic,
        { key: item._id, value: JSON.stringify({ eventType, item }) },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            this.logger.debug('Result:', result);
            resolve({ eventType, item });
          }
        },
      );
    });
  }

  /**
   * Function to consume inventory item events from a Kafka topic and process them.
   */
  handleInventoryEvent = (error: any, message: string): void => {
    if (error) {
      Promise.reject(new MoleculerError(`${error.message} ${error.detail}`, 500, 'CONSUMER_MESSAGE_ERROR'));
    }

    this.logger.debug('Processing inventory event message:', message);
    const event: InventoryEvent = JSON.parse(message);

    const { item, eventType } = event;
    if (eventType === InventoryEventType.ITEM_ADDED) {
      // This calls "inventory.insert" which is the insert() function from the DbService mixin.
      this.broker.call('inventory.insert', { entity: item });
    } else if (eventType === InventoryEventType.ITEM_UPDATED) {
      // This calls "inventory.update" which is the update() function from the DbService mixin.
      this.broker.call('inventory.update', item);
    } else if (eventType === InventoryEventType.ITEM_REMOVED) {
      // This calls "inventory.update" which is the remove() function from the DbService mixin.
      this.broker.call('inventory.remove', item);
    } else {
      // Not an error as services may publish different event types in the future.
      this.logger.warn('Unknown eventType:', eventType);
    }
  };

  /**
   * Function to consume order events from a Kafka topic and process them.
   */
  handleOrderEvent = (error: any, message: string): void => {
    if (error) {
      throw new MoleculerError(`${error.message} ${error.detail}`, 500, 'CONSUMER_MESSAGE_ERROR');
    }

    this.logger.debug('Processing order event message:', message);
    const event: OrderEvent = JSON.parse(message);

    const { order } = event;
    if (order.state === OrderState.CANCELLED) {
      // free items associated with the cancelled order
      this.freeItems(order.items);
    }
  };

  serviceStarted(): Promise<void> {
    this.startKafkaProducer(this.settings.bootstrapServer, (error: any) => this.logger.error(error));

    // Start multiple consumers, one for inventory events and one for order events.
    this.startKafkaConsumers([
      {
        bootstrapServer: this.settings.bootstrapServer,
        topic: this.settings.inventoryTopic,
        callback: this.handleInventoryEvent,
      },
      {
        bootstrapServer: this.settings.bootstrapServer,
        topic: this.settings.ordersTopic,
        callback: this.handleOrderEvent,
      },
    ]);

    this.logger.debug('Inventory service started.');

    return Promise.resolve();
  }
}

export default InventoryService;
