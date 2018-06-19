const os = require('os');

module.exports = {
  namespace: '',
  // It will be unique when scale up instances in Docker or on local computer
  nodeID: (process.env.NODEID ? `${process.env.NODEID}-` : '') + os.hostname().toLowerCase(),

  logger: true,
  logLevel: 'info',
  logFormatter: 'default',

  transporter: 'Kafka',

  cacher: 'Redis',

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
  created(broker) { // eslint-disable-line no-unused-vars

  },

  // Called after broker starte.
  started(broker) { // eslint-disable-line no-unused-vars

  },

  // Called after broker stopped.
  stopped(broker) { // eslint-disable-line no-unused-vars

  },
};
