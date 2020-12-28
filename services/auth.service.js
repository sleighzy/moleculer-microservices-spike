const { Service } = require('moleculer');
const { MoleculerClientError } = require('moleculer').Errors;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class AuthService extends Service {
  constructor(broker) {
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

      events: {
        // No events
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  /**
   * Function to authenticate user.
   *
   * @param {Context} ctx Moleculer request context
   * @returns a user identity and JWT token
   */
  login(ctx) {
    const { username, password } = ctx.params;
    this.logger.debug('Logging in user:', username);

    return this.Promise.resolve()
      .then(() => ctx.call('users.getUser', { username }))
      .then((user) => {
        if (!user) {
          return this.Promise.reject(
            new MoleculerClientError(
              'Username or password is invalid!',
              422,
              '',
              [{ field: 'username', message: 'is not found' }],
            ),
          );
        }
        return bcrypt.compare(password, user.password).then((res) => {
          if (!res) {
            return this.Promise.reject(
              new MoleculerClientError(
                'Username or password is invalid!',
                422,
                '',
                [{ field: 'password', message: 'is not valid' }],
              ),
            );
          }
          return user;
        });
      })
      .then((user) => this.addToken(user, ctx.meta.token));
  }

  /**
   * Register new users.
   *
   * @param {Context} ctx Moleculer request context
   * @returns new user
   */
  register(ctx) {
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
  resolveToken(ctx) {
    return new this.Promise((resolve, reject) => {
      jwt
        .verify(ctx.params.token, this.settings.jwtSecret, (err, decoded) => {
          if (err) {
            return reject(err);
          }
          return resolve(decoded);
        })
        .then((decoded) => {
          if (decoded.id) {
            return this.getById(ctx, decoded.id);
          }
          return null;
        });
    });
  }

  /**
   * Function to return an identity and the JWT token.
   *
   * @param {User} user the authenticated user
   * @param {String} token the JWT token
   */
  addToken(user, token) {
    const { _id, username, email } = user;
    const identity = {
      _id,
      username,
      email,
    };

    identity.token = token || this.generateToken(user);

    return identity;
  }

  /**
   * Function to generate a JWT token for a user.
   *
   * @param {User} user the user to generate a token for
   * @returns signed JWT token
   */
  generateToken(user) {
    return jwt.sign(
      // eslint-disable-next-line no-underscore-dangle
      { id: user._id, username: user.username },
      this.settings.jwtSecret,
      { expiresIn: '60m' },
    );
  }

  /**
   * Function to retrieve user by unique database identifier.
   *
   * @param {Context} ctx Moleculer request context
   * @param {String} id identifier for user, this is the database id and not the username
   */
  getById(ctx, id) {
    this.logger.debug('Get by id: ', id);
    return ctx.call('users.get', { id });
  }

  serviceCreated() {
    this.logger.debug('Auth service created.');
  }

  serviceStarted() {
    this.logger.debug('Auth service started.');
  }

  serviceStopped() {
    this.logger.debug('Auth service stopped.');
  }
}

module.exports = AuthService;
