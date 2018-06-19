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

        routes: [{
          path: '/api',

          authorization: true,

          whitelist: [
            '*',
          ],

          aliases: {
            'POST login': 'auth.login',

            'REST users': 'users',

            'GET orders/:id': 'orders.getOrder',
            'GET orders/:id/validated': 'orders.getOrderValidation',
            'POST orders': 'orders.submitOrder',
          },
        }],

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
          return ctx.call('auth.resolveToken', { token })
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
