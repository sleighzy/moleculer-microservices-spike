/* eslint-disable import/no-unresolved */
const { Service } = require('moleculer');
import JaegerService from 'moleculer-jaeger';

class MetricsService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'metrics',
      meta: {
        scalable: true,
      },

      mixins: [JaegerService],

      settings: {
        host: process.env.JAEGER_HOST || '127.0.0.1',
      },

      events: {
        // No events
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  serviceCreated() {
    this.logger.debug('Metrics service created.');
  }

  serviceStarted() {
    this.logger.debug('Metrics service started.');
  }

  serviceStopped() {
    this.logger.debug('Metrics service stopped.');
  }
}

export default MetricsService;
