const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const KafkaService = require('../mixins/kafka.mixin');

class InventoryService extends Service {
  constructor(broker) {
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
          state: { type: String, enum: ['Available', 'Reserved', 'Shipped'] },
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

      events: {
        // No events
      },

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

    return this.sendEvent(newProduct, 'ItemAdded');
  }

  reserveItem(ctx) {
    const { product, quantity } = ctx.params;
    this.logger.debug('Reserve item:', product, quantity);

    return this.Promise.resolve()
      .then(() => this.getQuantity(ctx, product, true))
      .then((available) => {
        if (quantity > available) {
          // Emit an event that there is no further stock available
          this.broker.emit('inventory.insufficientStock', { product });

          return this.Promise.reject(
            new MoleculerError(
              `Not enough items available in inventory for product '${product}'.`,
            ),
          );
        }
        // Retrieve "Available" items, limited by the requested quantity to reserve.
        // This calls "inventory.list" which is the list() function from the DbService mixin.
        // Update each item retrieved and set their state to "Reserved" while payment processing takes place.
        return ctx.call('inventory.list', {
          query: { product, state: 'Available' },
          pageSize: quantity,
        });
      })
      .then((res) =>
        res.rows.forEach((doc) =>
          // eslint-disable-next-line no-underscore-dangle
          this.updateItemState(ctx, doc._id, 'Reserved'),
        ),
      )
      .catch((err) => this.logger.error(err));
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

    return this.sendEvent({ id, state, updated: Date.now() }, 'ItemUpdated');
  }

  /**
   * Function to consume item events from a Kafka topic and process them.
   *
   * @param {Object} event event containing event type and item information.
   * @returns {Promise}
   */
  processEvent(event) {
    this.logger.debug(event);
    const itemEvent = JSON.parse(event);

    return new this.Promise((resolve) => {
      if (itemEvent.eventType === 'ItemAdded') {
        // This calls "inventory.insert" which is the insert() function from the DbService mixin.
        resolve(
          this.broker.call('inventory.insert', { entity: itemEvent.item }),
        );
      } else if (itemEvent.eventType === 'ItemUpdated') {
        // This calls "inventory.update" which is the update() function from the DbService mixin.
        resolve(this.broker.call('inventory.update', itemEvent.item));
      } else if (itemEvent.eventType === 'ItemRemoved') {
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
  sendEvent(item, eventType) {
    return new this.Promise((resolve, reject) => {
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

  serviceCreated() {
    this.logger.debug('Inventory service created.');
  }

  serviceStarted() {
    this.startKafkaProducer(this.settings.bootstrapServer, (error) =>
      this.logger.error(error),
    );

    this.startKafkaConsumer(
      this.settings.bootstrapServer,
      this.settings.inventoryTopic,
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

    this.logger.debug('Inventory service started.');
  }

  serviceStopped() {
    this.logger.debug('Inventory service stopped.');
  }
}

module.exports = InventoryService;
