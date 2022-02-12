import { Service, ServiceBroker } from 'moleculer';
import JaegerService from 'moleculer-jaeger';

class MetricsService extends Service {
  constructor(broker: ServiceBroker) {
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
    });
  }
}

export default MetricsService;
