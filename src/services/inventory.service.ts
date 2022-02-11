import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import KafkaService from '../mixins/kafka.mixin';
import {
  InventoryEventType,
  InventoryItem,
  InventoryQuery,
  InventoryState,
} from '../types/inventory';

const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');

interface ContextWithInventory extends Context {
  params: {
    id: string;
    item: {
      product: string;
      price: string;
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

      adapter: new MongooseAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: ['_id', 'product', 'price', 'state', 'created', 'updated'],
      model: mongoose.model(
        'Product',
        mongoose.Schema({
          product: { type: String },
          price: { type: Number },
          state: {
            type: String,
            enum: [
              InventoryState.AVAILABLE,
              InventoryState.RESERVED,
              InventoryState.SHIPPED,
            ],
          },
          created: { type: Date, default: Date.now },
          updated: { type: Date, default: Date.now },
        }),
      ),

      settings: {
        bootstrapServer:
          process.env.INVENTORY_BOOTSTRAP_SERVER || 'localhost:9092',
        inventoryTopic: process.env.INVENTORY_TOPIC || 'inventory',
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
          handler: this.reserveItem,
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

    const newProduct = {
      id: Math.random(),
      product,
      price,
      state: InventoryState.AVAILABLE,
      updated: Date.now(),
    };

    return this.sendEvent({
      item: newProduct,
      eventType: InventoryEventType.ITEM_ADDED,
    });
  }

  async reserveItem(ctx: ContextWithInventory): Promise<any> {
    const { product, quantity } = ctx.params;
    this.logger.debug('Reserve item:', product, quantity);

    return Promise.resolve()
      .then(() => this.getQuantity({ ctx, product, available: true }))
      .then((available) => {
        if (quantity > available) {
          // Emit an event that there is no further stock available
          this.broker.emit('inventory.insufficientStock', { product });

          return Promise.reject(
            new MoleculerError(
              `Not enough items available in inventory for product '${product}'.`,
            ),
          );
        }
        // Retrieve "Available" items, limited by the requested quantity to reserve.
        // This calls "inventory.list" which is the list() function from the DbService mixin.
        // Update each item retrieved and set their state to "Reserved" while payment processing takes place.
        return ctx.call('inventory.list', {
          query: { product, state: InventoryState.AVAILABLE },
          pageSize: quantity,
        });
      })
      .then((res: any) =>
        res.rows.forEach((doc) =>
          // eslint-disable-next-line no-underscore-dangle
          this.updateItemState({
            ctx,
            item: doc._id,
            state: InventoryState.RESERVED,
          }),
        ),
      )
      .catch((err) => this.logger.error(err));
  }

  async shipItem(ctx: ContextWithInventory): Promise<any> {
    const { id } = ctx.params;
    this.logger.debug('Ship item:', id);
    const item = await this.getItem({ ctx, id });
    return this.updateItemState({ ctx, item, state: InventoryState.SHIPPED });
  }

  // Private methods
  async getItem({
    ctx,
    id,
  }: {
    ctx: Context;
    id: string;
  }): Promise<InventoryItem> {
    this.logger.debug('Get item:', id);
    const item: InventoryItem = await ctx.call('inventory.get', { id });
    if (!item) {
      return Promise.reject(
        new MoleculerError(
          `Inventory item not found for id '${id}'`,
          404,
          'NOT_FOUND',
          [{ field: `${id}`, message: 'is not found' }],
        ),
      );
    }

    this.logger.debug('Item found:', item);
    return item;
  }

  async getQuantity({
    ctx,
    product,
    available,
  }: {
    ctx: ContextWithInventory;
    product: string;
    available: boolean;
  }): Promise<unknown> {
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
    ctx,
    item,
    state,
  }: {
    ctx: ContextWithInventory;
    item: InventoryItem;
    state: InventoryState;
  }): Promise<any> {
    this.logger.debug('Update item state:', item.id, state);

    return this.sendEvent({ item, eventType: InventoryEventType.ITEM_UPDATED });
  }

  /**
   * Function to consume item events from a Kafka topic and process them.
   *
   * @param {Object} event event containing event type and item information.
   * @returns {Promise}
   */
  async processEvent(event: InventoryEventType): Promise<any> {
    this.logger.debug(event);
    const itemEvent = JSON.parse(event);

    return new Promise((resolve) => {
      if (itemEvent.eventType === InventoryEventType.ITEM_ADDED) {
        // This calls "inventory.insert" which is the insert() function from the DbService mixin.
        resolve(
          this.broker.call('inventory.insert', { entity: itemEvent.item }),
        );
      } else if (itemEvent.eventType === InventoryEventType.ITEM_UPDATED) {
        // This calls "inventory.update" which is the update() function from the DbService mixin.
        resolve(this.broker.call('inventory.update', itemEvent.item));
      } else if (itemEvent.eventType === InventoryEventType.ITEM_REMOVED) {
        // This calls "inventory.update" which is the remove() function from the DbService mixin.
        resolve(this.broker.call('inventory.remove', itemEvent.item));
      } else {
        // Not an error as services may publish different event types in the future.
        this.logger.debug('Unknown eventType:', itemEvent.eventType);
      }
    });
  }

  /**
   * Function to publish item event data to a Kafka topic.
   *
   * @param {Object} item the item information
   * @param {eventType} type the event type
   * @returns {Promise}
   */
  async sendEvent({
    item,
    eventType,
  }: {
    item: InventoryItem;
    eventType: InventoryEventType;
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!item) {
        reject('No inventory item provided when sending event.');
      }
      if (!eventType) {
        reject('No event type specified when sending event.');
      }

      this.sendMessage(
        this.settings.inventoryTopic,
        { key: item.product, value: JSON.stringify({ eventType, item }) },
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

  serviceStarted(): Promise<void> {
    this.startKafkaProducer(this.settings.bootstrapServer, (error: any) =>
      this.logger.error(error),
    );

    this.startKafkaConsumer({
      bootstrapServer: this.settings.bootstrapServer,
      topic: this.settings.inventoryTopic,
      callback: (error: any, message: any) => {
        if (error) {
          Promise.reject(
            new MoleculerError(
              `${error.message} ${error.detail}`,
              500,
              'CONSUMER_MESSAGE_ERROR',
            ),
          );
        }
        this.processEvent(message.value);
      },
    });

    this.logger.debug('Inventory service started.');

    return Promise.resolve();
  }
}

export default InventoryService;
