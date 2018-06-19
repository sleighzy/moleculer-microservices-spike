const { Service } = require('moleculer');
const JaegerService = require('moleculer-jaeger');

class GreeterService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'greeter',
      version: 'v2',
      meta: {
        scalable: true,
      },

      mixins: [JaegerService],

      settings: {
        host: process.env.JAEGER_HOST || '127.0.0.1',
        upperCase: true,
      },

      actions: {
        hello: this.hello,
        helloAuth: {
          auth: 'required',
          handler: this.helloAuth,
        },
        welcome: {
          cache: {
            keys: ['name'],
          },
          params: {
            name: 'string',
          },
          handler: this.welcome,
        },
      },
      events: {
        'user.created': this.userCreated,
      },
      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  // Action handler
  hello() { // eslint-disable-line class-methods-use-this
    return 'Hello Moleculer';
  }

  helloAuth() { // eslint-disable-line class-methods-use-this
    return 'Hello Authenticated Moleculer';
  }

  welcome(ctx) {
    return this.sayWelcome(ctx.params.name);
  }

  // Private method
  sayWelcome(name) {
    this.logger.info('Say hello to', name);
    return `Welcome, ${this.settings.upperCase ? name.toUpperCase() : name}`;
  }

  // Event handler
  userCreated(user) {
    this.broker.call('emailer.send', { user });
  }

  serviceCreated() {
    this.logger.debug('Greeter service created.');
  }
  serviceStarted() {
    this.logger.debug('Greeter service started.');
  }
  serviceStopped() {
    this.logger.debug('Greeter service stopped.');
  }
}

module.exports = GreeterService;
