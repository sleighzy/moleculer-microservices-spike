import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import * as DbService from 'moleculer-db';
import MongooseDbAdapter from 'moleculer-db-adapter-mongoose';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { User, UserEvent, UserEventType, UserIdentity } from '../types/users';
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
      model: mongoose.model(
        'User',
        new mongoose.Schema<User>({
          _id: { type: String, default: uuidv4 },
          username: { type: String, required: true },
          password: { type: String, required: true },
          email: { type: String, required: true },
          created: { type: Date, default: Date.now },
          updated: { type: Date, default: Date.now },
        }),
      ),

      settings: {
        // Base request route path
        rest: 'users/',

        jwtSecret: process.env.JWT_SECRET || 'jwt-secret-string',
        kafka: {
          bootstrapServer: process.env.USERS_BOOTSTRAP_SERVER || 'localhost:9092',
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

  async getUser(ctx: ContextWithUser): Promise<User> {
    const { username } = ctx.params;
    this.logger.debug('getUser:', username);

    const user = await this.retrieveUser(ctx, { username });
    if (!user) {
      throw new MoleculerError(`User not found for username: ${username}`, 404, 'NOT_FOUND');
    }
    this.logger.debug('Found user:', user);

    return user;
  }

  async createUser(ctx: ContextWithUser): Promise<UserIdentity> {
    const { username, email, password } = ctx.params.user;
    this.logger.debug('createUser:', { username, email });

    const users: User[] = await ctx.call('users.find', { query: { username } });
    if (users.length) {
      throw new MoleculerError(`User ${username} already exists.`, 409, 'ALREADY_EXISTS', [
        { field: 'username', message: 'already exists' },
      ]);
    }

    const userEntity: User = {
      _id: uuidv4(),
      username,
      email,
      password: bcrypt.hashSync(password, 10),
    };

    // This calls "users.insert" which is the insert() function from the DbService mixin.
    const user: User = await ctx.call('users.insert', { entity: userEntity });

    this.logger.info('Created user', {
      id: user._id,
      username: user.username,
      email: user.email,
    });

    return this.transformUser({ user, withToken: true, token: ctx.meta.token });
  }

  async updateUser(ctx: ContextWithUser): Promise<void> {
    const { username, email } = ctx.params.user;
    this.logger.debug('updateUser', username);

    if (username !== ctx.params.username) {
      throw new MoleculerError('User in request body does not match.', 400, 'DOES_NOT_MATCH', [
        { field: 'username', message: 'does not match' },
      ]);
    }

    const user = await this.getUser(ctx);
    await ctx.call('users.update', {
      _id: user._id,
      email,
      updated: Date.now(),
    });

    this.logger.info('Updated user', {
      id: user._id,
      username: user.username,
      email: user.email,
    });
  }

  async deleteUser(ctx: ContextWithUser) {
    const { username } = ctx.params;
    this.logger.debug('deleteUser:', username);

    const user = await this.getUser(ctx);
    await ctx.call('users.remove', { id: user._id });

    this.logger.info('Deleted user', { id: user._id, username });
  }

  // Private methods.

  async retrieveUser(ctx: Context, criteria): Promise<User | undefined> {
    const users: User[] = await ctx.call('users.find', { query: criteria });
    if (!users.length) {
      this.logger.info('User not found', criteria);
      return undefined;
    }
    return users[0];
  }

  transformUser({ user, withToken, token }: { user: User; withToken: boolean; token: string }): UserIdentity {
    const identity: UserIdentity = user;
    // TODO: add extra information to user object from identity source
    if (withToken) {
      identity.token = token || this.generateToken(user);
    }
    return identity;
  }

  generateToken(user: User): string {
    return jwt.sign({ id: user._id, username: user.username }, this.settings.jwtSecret, { expiresIn: '60m' });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userCreated(user: User, ctx: Context): Promise<unknown> {
    this.logger.debug('User created:', user);
    return this.sendEvent({ user, eventType: UserEventType.USER_CREATED });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userUpdated(user: User, ctx: Context): Promise<unknown> {
    this.logger.debug('User updated:', user);
    return this.sendEvent({ user, eventType: UserEventType.USER_UPDATED });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userRemoved(user: User, ctx: Context): Promise<unknown> {
    this.logger.debug('User deleted:', user);
    return this.sendEvent({ user, eventType: UserEventType.USER_DELETED });
  }

  sendEvent(event: UserEvent): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.sendMessage(
        this.settings.kafka.usersTopic,
        { key: event.user.username, value: JSON.stringify(event) },
        (error: any, result: any) => {
          if (error) {
            reject(error);
          } else {
            this.logger.debug('Result:', result);
            resolve(result);
          }
        },
      );
    });
  }

  // Event handlers

  serviceStarted(): Promise<void> {
    this.startKafkaProducer(this.settings.kafka.bootstrapServer, (error) => this.logger.error(error));

    this.logger.debug('Users service started.');

    return Promise.resolve();
  }
}

export default UsersService;
