import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerClientError } from 'moleculer/src/errors';
import bcrypt from 'bcryptjs';
import jwt, { JwtPayload, VerifyErrors } from 'jsonwebtoken';

import { User, UserIdentity } from '../types/users';

interface AuthContext extends Context {
  params: {
    user?: User;
    username?: string;
    password?: string;
    token?: string;
  };
  meta: {
    token?: string;
  };
}

class AuthService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'auth',
      meta: {
        scalable: true,
      },

      settings: {
        jwtSecret: process.env.JWT_SECRET || 'jwt-secret-string',
      },

      actions: {
        login: {
          params: {
            username: 'string',
            password: 'string',
          },
          handler: this.login,
        },

        register: {
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
          handler: this.register,
        },

        resolveToken: {
          params: {
            token: 'string',
          },
          handler: this.resolveToken,
        },
      },
    });
  }

  /**
   * Function to authenticate user.
   *
   * @param {Context} ctx Moleculer request context
   * @returns a user identity and JWT token
   */
  async login(ctx: AuthContext): Promise<UserIdentity> {
    const { username, password } = ctx.params;
    this.logger.debug('Logging in user:', username);

    const user: User = await ctx.call('users.getUser', { username });
    if (!user) {
      throw new MoleculerClientError('Username or password is invalid!', 422, '', [
        { field: 'username', message: 'is not found' },
      ]);
    }

    const result = bcrypt.compare(password, user.password);
    if (!result) {
      throw new MoleculerClientError('Username or password is invalid!', 422, '', [
        { field: 'password', message: 'is not valid' },
      ]);
    }

    return this.addToken(user, ctx.meta.token);
  }

  /**
   * Register new users.
   *
   * @param {Context} ctx Moleculer request context
   * @returns new user
   */
  register(ctx: AuthContext): Promise<User> {
    this.logger.debug('Registering user', ctx.params.user.username);

    return ctx.call('users.createUser', { user: ctx.params.user });
  }

  /**
   * Function to resolve the data within the JWT token and return
   * the user associated with it.
   *
   * @param {Context} ctx Moleculer request context
   * @returns user associated with this JWT token
   */
  resolveToken(ctx: AuthContext): Promise<User> {
    return new Promise((resolve, reject) => {
      jwt.verify(ctx.params.token, this.settings.jwtSecret, (err: VerifyErrors, decoded: JwtPayload) => {
        if (err) {
          return reject(err);
        }
        return resolve(this.getById(ctx, decoded.id));
      });
    });
  }

  /**
   * Function to return an identity and the JWT token.
   *
   * @param {User} user the authenticated user
   * @param {String} token the JWT token
   */
  addToken(user: User, token: string): UserIdentity {
    const identity: UserIdentity = {
      ...user,
      token: token || this.generateToken(user),
    };

    return identity;
  }

  /**
   * Function to generate a JWT token for a user.
   *
   * @param {User} user the user to generate a token for
   * @returns signed JWT token
   */
  generateToken(user: User): string {
    return jwt.sign({ id: user._id, username: user.username }, this.settings.jwtSecret, { expiresIn: '60m' });
  }

  /**
   * Function to retrieve user by unique database identifier.
   *
   * @param {Context} ctx Moleculer request context
   * @param {String} id identifier for user, this is the database id and not the username
   */
  getById(ctx: AuthContext, id: string): Promise<User> {
    this.logger.debug('Get by id: ', id);
    return ctx.call('users.get', { id });
  }
}

export default AuthService;
