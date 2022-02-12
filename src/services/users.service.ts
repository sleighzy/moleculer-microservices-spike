import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import * as DbService from 'moleculer-db';
import MongooseDbAdapter from 'moleculer-db-adapter-mongoose';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, UserIdentity } from '../types/users';
import KafkaService from '../mixins/kafka.mixin';

interface ContextWithUser extends Context {
  params: {
    username?: string;
    user: User;
  };
  meta: {
    token?: string;
  };
}

interface ContextWithCustomer extends Context {
  params: {
    customerId: string;
  };
}

class UsersService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'users',
      meta: {
        scalable: true,
      },

      mixins: [DbService, KafkaService],

      adapter: new MongooseDbAdapter('mongodb://mongodb:27017/moleculer-db'),
      fields: ['_id', 'username', 'email'],
      model: mongoose.model(
        'User',
        new mongoose.Schema({
          customerId: { type: Number },
          username: { type: String },
          password: { type: String },
          email: { type: String },
          created: { type: Date, default: Date.now },
          updated: { type: Date, default: Date.now },
        }),
      ),

      settings: {
        // Base request route path
        rest: 'users/',

        jwtSecret: process.env.JWT_SECRET || 'jwt-secret-string',
        kafka: {
          bootstrapServer:
            process.env.USERS_BOOTSTRAP_SERVER || 'localhost:9092',
          usersTopic: process.env.USERS_TOPIC || 'users',
        },
      },

      // The user service aliases are defined explicitly vs generic 'REST' as the username
      // is used for operations and not the actual database id directly. These actions
      // delegate to the underlying database mixin actions after the id for the user associated
      // with the username has been resolved.
      actions: {
        list: {
          rest: 'GET /',
          auth: 'required',
        },
        getUser: {
          rest: 'GET /:username',
          auth: 'required',
          params: {
            username: 'string',
          },
          handler: this.getUser,
        },
        createUser: {
          rest: 'POST /',
          auth: 'required',
          params: {
            user: {
              type: 'object',
              props: {
                username: 'string',
                email: 'string',
                password: 'string',
              },
            },
          },
          handler: this.createUser,
        },
        updateUser: {
          rest: 'PUT /:username',
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
        deleteUser: {
          rest: 'DELETE /:username',
          auth: 'required',
          params: {
            username: 'string',
          },
          handler: this.deleteUser,
        },

        // This is not exposed as a REST endpoint but as an action that
        // can be called by the brokers
        getUserByCustomerId: {
          params: {
            customerId: 'number',
          },
          handler: this.getUserByCustomerId,
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

      started: this.serviceStarted,
    });
  }

  // Action handlers

  async getUser(ctx: ContextWithUser) {
    const { username } = ctx.params;
    this.logger.debug('getUser:', username);
    return this.retrieveUser(ctx, { username }).then((user) =>
      ctx.call('users.get', { id: user._id }),
    );
  }

  async getUserByCustomerId(ctx: ContextWithCustomer) {
    const { customerId } = ctx.params;
    this.logger.debug('getUserByCustomerId:', customerId);

    return this.retrieveUser(ctx, { customerId }).then((user) =>
      ctx.call('users.get', { id: user._id }),
    );
  }

  async createUser(ctx: ContextWithUser): Promise<UserIdentity> {
    const { username, email, password } = ctx.params.user;
    this.logger.debug('createUser:', username);

    const users: User[] = await ctx.call('users.find', { query: { username } });
    if (users.length) {
      return Promise.reject(
        new MoleculerError('User already exists.', 409, 'ALREADY_EXISTS', [
          { field: 'username', message: 'already exists' },
        ]),
      );
    }

    const userEntity = {
      customerId: Date.now(),
      username,
      email,
      password: bcrypt.hashSync(password, 10),
    };

    // This calls "users.insert" which is the insert() function from the DbService mixin.
    const user: User = await ctx.call('users.insert', { entity: userEntity });
    return this.transformUser(user, true, ctx.meta.token);
  }

  async updateUser(ctx: ContextWithUser): Promise<void> {
    const { username, email } = ctx.params.user;
    this.logger.debug('updateUser', username);

    if (username !== ctx.params.username) {
      return Promise.reject(
        new MoleculerError(
          'User in request body does not match.',
          400,
          'DOES_NOT_MATCH',
          [{ field: 'username', message: 'does not match' }],
        ),
      );
    }

    const user = await this.retrieveUser(ctx, { username });
    await ctx.call('users.update', {
      id: user._id,
      email,
      updated: Date.now(),
    });

    this.logger.info('Updated user', user._id, user.username);
  }

  async deleteUser(ctx: ContextWithUser): Promise<void> {
    const { username } = ctx.params;
    this.logger.debug('deleteUser:', username);

    const user = await this.retrieveUser(ctx, { username });
    await ctx.call('users.remove', { id: user._id });

    this.logger.info('Deleted user', user._id, user.username);
  }

  // Private methods.

  async retrieveUser(ctx: Context, criteria): Promise<User> {
    const users: User[] = await ctx.call('users.find', { query: criteria });
    if (!users.length) {
      return Promise.reject(
        new MoleculerError(
          `User not found for criteria '${JSON.stringify(criteria)}'`,
          404,
          'NOT_FOUND',
          [{ field: `${JSON.stringify(criteria)}`, message: 'is not found' }],
        ),
      );
    }
    return users[0];
  }

  transformUser(user: User, withToken: boolean, token: string): UserIdentity {
    const identity: UserIdentity = user;
    // TODO: add extra information to user object from identity source
    if (withToken) {
      identity.token = token || this.generateToken(user);
    }
    return identity;
  }

  generateToken(user: User): string {
    return jwt.sign(
      { id: user._id, username: user.username },
      this.settings.jwtSecret,
      { expiresIn: '60m' },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userCreated(user: User, ctx: Context) {
    this.logger.debug('User created:', user);
    return this.sendEvent(user, 'UserCreated');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userUpdated(user: User, ctx: Context) {
    this.logger.debug('User updated:', user);
    return this.sendEvent(user, 'UserUpdated');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userRemoved(user: User, ctx: Context) {
    this.logger.debug('User deleted:', user);
    return this.sendEvent(user, 'UserDeleted');
  }

  sendEvent(user: any, eventType: any) {
    return new this.Promise((resolve, reject) => {
      const data = user;
      data.eventType = eventType;

      this.sendMessage(
        this.settings.kafka.usersTopic,
        { key: user.username, value: JSON.stringify(data) },
        (error: any, result: any) => {
          if (error) {
            reject(error);
          } else {
            this.logger.debug('Result:', result);
            resolve(data);
          }
        },
      );
    });
  }

  // Event handlers

  serviceStarted(): Promise<void> {
    this.startKafkaProducer(this.settings.kafka.bootstrapServer, (error) =>
      this.logger.error(error),
    );

    this.logger.debug('Users service started.');

    return Promise.resolve();
  }
}

export default UsersService;
