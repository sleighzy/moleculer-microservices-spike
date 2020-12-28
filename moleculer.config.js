const os = require('os');

/**
 * https://moleculer.services/docs/0.14/configuration.html
 * NOTE: Configuration items within this moleculer.config.js file will be
 * overridden by config specified via environment variables when running
 * Docker containers. See docker-compose.env file if deploying this using
 * the Docker Compose deployment instructions.
 */
module.exports = {
  namespace: 'development',
  // It will be unique when scaling up instances in Docker or on local computer
  nodeID:
    (process.env.NODEID ? `${process.env.NODEID}-` : '') +
    os.hostname().toLowerCase(),

  logger: true,
  logLevel: 'info',
  logFormatter: 'default',

  transporter: 'TCP',

  cacher: 'MemoryLRU',

  serializer: 'JSON',

  requestTimeout: 10 * 1000,
  requestRetry: 0,
  maxCallLevel: 100,
  heartbeatInterval: 5,
  heartbeatTimeout: 15,

  disableBalancer: false,

  registry: {
    strategy: 'RoundRobin',
    preferLocal: true,
  },

  circuitBreaker: {
    enabled: false,
    maxFailures: 3,
    halfOpenTime: 10 * 1000,
    failureOnTimeout: true,
    failureOnReject: true,
  },

  validation: true,
  validator: null,
  metrics: true,
  metricsRate: 1,
  statistics: false,
  internalActions: true,

  hotReload: false,

  replCommands: null,

  // Register middlewares
  middlewares: [],

  // Called after broker created.
  // eslint-disable-next-line no-unused-vars
  created(broker) {},

  // Called after broker started.
  // eslint-disable-next-line no-unused-vars
  started(broker) {},

  // Called after broker stopped.
  // eslint-disable-next-line no-unused-vars
  stopped(broker) {},
};
