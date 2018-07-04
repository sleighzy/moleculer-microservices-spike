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

            // The user service aliases are defined explicitely v.s. 'REST' as the username is used
            // for operations and not the id directly. These actions delegate to the underlying database
            // mixin actions after the id for the user associated with the username has been retrieved.
            'GET users': 'users.list',
            'GET users/:username': 'users.getUser',
            'POST users': 'users.createUser',
            'PUT users/:username': 'users.updateUser',
            'DELETE users/:username': 'users.deleteUser',

            'REST inventory': 'inventory',

            'REST orders': 'orders',
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
