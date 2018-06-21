const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');
const DbService = require('moleculer-db');
const MongooseAdapter = require('moleculer-db-adapter-mongoose');
const mongoose = require('mongoose');
const JaegerService = require('moleculer-jaeger');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class UsersService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'users',
      meta: {
        scalable: true,
      },

      mixins: [DbService, JaegerService],

      adapter: new MongooseAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: ['_id', 'username', 'email'],
      model: mongoose.model('User', mongoose.Schema({
        username: { type: String },
        password: { type: String },
        email: { type: String },
        created: { type: Date, default: Date.now },
        updated: { type: Date, default: Date.now },
      })),

      settings: {
        host: process.env.JAEGER_HOST || '127.0.0.1',
        jwtSecret: process.env.JWT_SECRET || 'jwt-secret-string',
        bootstrapServer: process.env.USERS_BOOTSTRAP_SERVER || 'localhost:9092',
        usersTopic: process.env.USERS_TOPIC || 'users',
      },

      actions: {
        list: {
          auth: 'required',
          handler: this.getUsers,
        },
        get: {
          auth: 'required',
          handler: this.getUser,
        },
        getById: {
          auth: 'required',
          handler: this.getUserById,
        },
        create: {
          // auth: 'required',    TODO: Initial admin user needs to be created before possible to login
          user: {
            type: 'object',
            props: {
              username: 'string',
              email: 'string',
              password: 'string',
            },
          },
          handler: this.createUser,
        },
        update: {
          auth: 'required',
          params: {
            user: {
              type: 'object',
              props: {
                username: 'string',
                email: 'string',
              },
            },
          },
          handler: this.updateUser,
        },
        remove: {
          auth: 'required',
          handler: this.deleteUser,
        },
      },

      events: {
        'user.created': this.userCreated,
      },

      // These entityX functions are called by the moleculer-db
      // mixin when entities are created, updated, or deleted.
      entityCreated: this.userCreated,
      entityUpdated: this.userUpdated,
      entityRemoved: this.userRemoved,

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  // Action handlers
  async getUsers() {
    this.logger.debug('getUsers');
    return this.adapter.find();
  }

  async getUser(ctx) {
    const username = ctx.params.id;
    this.logger.debug('getUser:', username);
    return this.adapter.findOne({ username });
  }

  async getUserById(ctx) {
    return this.adapter.findById(ctx.params.id);
  }

  async createUser(ctx) {
    const { username, email, password } = ctx.params.user;
    this.logger.debug('createUser:', username);

    const found = await this.adapter.findOne({ username });
    if (found) {
      return Promise.reject(new MoleculerError('User already exists.', 422, '', [{ field: 'username', message: 'already exists' }]));
    }

    const entity = {
      username,
      email,
      password: bcrypt.hashSync(password, 10),
    };
    return this.adapter.insert(entity)
      .then(doc => this.transformDocuments(ctx, {}, doc))
      .then(user => this.transformUser(user, true, ctx.meta.token))
      .then(json => this.entityChanged('created', json, ctx).then(() => json));
  }

  async updateUser(ctx) {
    const { username, email } = ctx.params.user;
    if (username !== ctx.params.id) {
      return Promise.reject(new MoleculerError('User in request body does not match.', 422, '', [{ field: 'username', message: 'does not match' }]));
    }
    this.logger.debug('updateUser', username);

    const update = {
      email,
      updated: Date.now(),
    };
    return this.adapter.updateMany({ username }, update)
      .then(json => this.entityChanged('updated', json, ctx).then(() => json));
  }

  async deleteUser(ctx) {
    const username = ctx.params.id;
    this.logger.debug('deleteUser:', username);
    return this.adapter.removeMany({ username })
      .then(json => this.entityChanged('removed', json, ctx).then(() => json));
  }

  // Private methods.
  transformUser(user, withToken, token) {
    const identity = user;
    // TODO: add extra information to user object from identity source
    if (withToken) {
      identity.token = token || this.generateToken(user);
    }
    return { identity };
  }

  generateToken(user) {
    return jwt.sign({ id: user._id, username: user.username }, this.settings.jwtSecret, { expiresIn: '60m' }); // eslint-disable-line no-underscore-dangle
  }

  userCreated(user, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('User created:', user);
    return this.sendEvent(user, 'userCreated');
  }

  userUpdated(user, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('User updated:', user);
    return this.sendEvent(user, 'userUpdated');
  }

  userRemoved(user, ctx) { // eslint-disable-line no-unused-vars
    this.logger.debug('User deleted:', user);
    return this.sendEvent(user, 'userRemoved');
  }

  sendEvent(user, eventType) {
    const data = user;
    data.eventType = eventType;
    const payload = this.createPayload(data);
    return new this.Promise((resolve, reject) => {
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

  createPayload(user) {
    const message = new KeyedMessage(user.username, JSON.stringify(user));
    return [{
      topic: this.settings.usersTopic,
      messages: [message],
      attributes: 1, // Use GZip compression for the payload.
      timestamp: Date.now(),
    }];
  }

  // Event handlers
  serviceCreated() {
    this.logger.debug('Users service created.');
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

    this.logger.debug('Users service started.');
  }

  serviceStopped() {
    this.logger.debug('Users service stopped.');
  }
}

module.exports = UsersService;
