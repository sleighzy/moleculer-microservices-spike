const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');

class InventoryService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'inventory',
      meta: {
        scalable: true,
      },

      mixins: [DbService],

      adapter: new MongooseAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: ['_id', 'product', 'price', 'state', 'created', 'updated'],
      model: mongoose.model('Product', mongoose.Schema({
        product: { type: String },
        price: { type: Number },
        state: { type: String, enum: ['Available', 'Reserved', 'Shipped'] },
        created: { type: Date, default: Date.now },
        updated: { type: Date, default: Date.now },
      })),

      settings: {
        bootstrapServer: process.env.INVENTORY_BOOTSTRAP_SERVER || 'localhost:9092',
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

      events: {
        // No events
      },

      // These entityX functions are called by the moleculer-db
      // mixin when entities are created, updated, or deleted.
      entityCreated: this.itemAdded,
      entityUpdated: this.itemUpdated,
      entityRemoved: this.itemRemoved,

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  addItem(ctx) {
    const { product, price } = ctx.params.item;
    this.logger.debug('Add item:', product, price);

    const newProduct = {
      product,
      price,
      state: 'Available',
    };
    // This calls "inventory.insert" which is the insert() function from the DbService mixin.
    return ctx.call('inventory.insert', { entity: newProduct });
  }

  reserveItem(ctx) {
    const { product, quantity } = ctx.params;
    this.logger.debug('Reserve item:', product, quantity);

    return this.Promise.resolve()
      .then(() => this.getQuantity(ctx, product, true))
      .then((available) => {
        if (quantity > available) {
          return this.Promise.reject(new MoleculerError(`Not enough items available in inventory for product '${product}'.`));
        }
        // Retrieve "Available" items, limited by the requested quantity to reserve.
        // This calls "inventory.list" which is the list() function from the DbService mixin.
        // Update each item retrieved and set their state to "Reserved" while payment processing takes place.
        return ctx.call('inventory.list', { query: { product, state: 'Available' }, pageSize: quantity });
      })
      .then(res => res.rows.forEach(doc => this.updateItemState(ctx, doc._id, 'Reserved'))) // eslint-disable-line no-underscore-dangle
      .catch(err => this.logger.error(err));
  }

  shipItem(ctx) {
    const { id } = ctx.params;
    this.logger.debug('Ship item:', id);
    return this.updateItemState(ctx, id, 'Shipped');
  }

  // Private methods
  getQuantity(ctx, product, available) {
    this.logger.debug('Get quantity:', product, available);
    const query = { product };
    // Filter for "Available" items only, otherwise return all.
    if (available) {
      query.state = 'Available';
    }
    // This calls "inventory.count" which is the count() function from the DbService mixin.
    return ctx.call('inventory.count', { query });
  }

  updateItemState(ctx, id, state) {
    this.logger.debug('Update item state:', id, state);
    // This calls "inventory.update" which is the update() function from the DbService mixin.
    return ctx.call('inventory.update', { id, state, updated: Date.now() });
  }

  itemAdded(item, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('Item added:', item);
    return this.sendEvent(item, 'ItemAdded');
  }

  itemUpdated(item, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('Item updated:', item);
    return this.sendEvent(item, 'ItemUpdated');
  }

  itemRemoved(item, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('Item removed:', item);
    return this.sendEvent(item, 'ItemRemoved');
  }

  sendEvent(item, type) {
    return new this.Promise((resolve, reject) => {
      if (!item) {
        reject('No item found when sending event.');
      }
      if (!type) {
        reject('No event type specified when sending event.');
      }

      const data = item;
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
      topic: this.settings.inventoryTopic,
      messages: [message],
      attributes: 1, // Use GZip compression for the payload.
      timestamp: Date.now(),
    }];
  }

  serviceCreated() {
    this.logger.debug('Inventory service created.');
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

    this.logger.debug('Inventory service started.');
  }

  serviceStopped() {
    this.logger.debug('Inventory service stopped.');
  }
}

module.exports = InventoryService;
