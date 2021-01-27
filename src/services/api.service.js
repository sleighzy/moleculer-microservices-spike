/* eslint-disable import/no-unresolved */
const { Service } = require('moleculer');
const ApiGateway = require('moleculer-web');

const { UnAuthorizedError } = ApiGateway.Errors;

class ApiService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'api',
      mixins: [ApiGateway],

      // More info about settings: http://moleculer.services/docs/moleculer-web.html
      settings: {
        port: process.env.PORT || 3000,

        routes: [
          {
            path: '/api',

            authorization: true,

            whitelist: [
              'auth.login',
              'auth.register',
              'users.list',
              'users.getUser',
              'users.createUser',
              'users.updateUser',
              'users.deleteUser',
              'slack.create',
              'inventory.*',
              'orders.*',
              '$node.*',
            ],

            aliases: {
              'POST auth/login': 'auth.login',
              'POST auth/register': 'auth.register',

              'REST inventory': 'inventory',

              'REST orders': 'orders',
            },

            // Allow services to directly declare their routes
            autoAliases: true,
            // Only expose routes that have had aliases defined
            mappingPolicy: 'restrict',
          },
          {
            path: '/system',

            whitelist: ['$node.*'],

            // Allow services to directly declare their routes
            autoAliases: true,
            // Expose all routes, even with no aliases
            mappingPolicy: 'all',
          },
        ],

        assets: {
          folder: 'public',
        },
      },
    });
  }

  /**
   * Invoked when calling services that require authentication.
   */
  authorize(ctx, route, req) {
    let authToken;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [type, value] = authHeader.split(' ');
      if (type === 'Token' || type === 'Bearer') {
        authToken = value;
      }
    }

    return this.Promise.resolve(authToken)
      .then((token) => {
        if (token) {
          // Verify JWT token
          return ctx
            .call('auth.resolveToken', { token })
            .then((user) => {
              if (user) {
                this.logger.debug('Authenticated via JWT: ', user.username);
                const { id, username, email } = user;
                ctx.meta.user = {
                  id,
                  username,
                  email,
                };
                ctx.meta.token = token;
              }
              return user;
            })
            .catch((err) => {
              this.logger.warn(err);
              return null;
            });
        }
        return null;
      })
      .then((user) => {
        if (req.$endpoint.action.auth === 'required' && !user) {
          return this.Promise.reject(new UnAuthorizedError());
        }
        return this.Promise.resolve(user);
      });
  }
}

module.exports = ApiService;
