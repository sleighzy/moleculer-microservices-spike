import { Context, Service, ServiceBroker } from 'moleculer';
import ApiGateway from 'moleculer-web';
import { User } from '../types/users';

const { UnAuthorizedError, ERR_INVALID_TOKEN } = ApiGateway.Errors;

interface ApiGatewayContext extends Context {
  meta: {
    user: User;
    token: string;
  };
}

class ApiService extends Service {
  constructor(broker: ServiceBroker) {
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
  async authorize(ctx: ApiGatewayContext, route: any, req: any): Promise<User> {
    let authToken: string;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [type, value] = authHeader.split(' ');
      if (type === 'Token' || type === 'Bearer') {
        authToken = value;
      }
    }

    return Promise.resolve(authToken)
      .then((token: string) => {
        if (token) {
          // Verify JWT token
          return ctx
            .call('auth.resolveToken', { token })
            .then((user: User) => {
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
      .then((user: User) => {
        if (req.$endpoint.action.auth === 'required' && !user) {
          return Promise.reject(
            new UnAuthorizedError(ERR_INVALID_TOKEN, {
              message: 'No user found for token',
            }),
          );
        }
        return Promise.resolve(user);
      });
  }
}

export default ApiService;
