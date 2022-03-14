import os from 'os';
import { BrokerOptions, Errors, MetricRegistry } from 'moleculer';

/**
 * Moleculer ServiceBroker configuration file
 *
 * More info about options:
 *     https://moleculer.services/docs/0.14/configuration.html
 *
 *
 * Overwriting options in production:
 * ================================
 *    You can overwrite any option with environment variables.
 *    For example to overwrite the "logLevel" value, use `LOGLEVEL=warn` env var.
 *    To overwrite a nested parameter, e.g. retryPolicy.retries, use `RETRYPOLICY_RETRIES=10` env var.
 *
 *    To overwrite broker’s deeply nested default options, which are not presented in "moleculer.config.ts",
 *    use the `MOL_` prefix and double underscore `__` for nested properties in .env file.
 *    For example, to set the cacher prefix to `MYCACHE`, you should declare an env var as `MOL_CACHER__OPTIONS__PREFIX=mycache`.
 *  It will set this:
 *  {
 *    cacher: {
 *      options: {
 *        prefix: "mycache"
 *      }
 *    }
 *  }
 *
 * NOTE: Configuration items within this moleculer.config.ts file will be
 * overridden by config specified via environment variables when running
 * Docker containers. See docker-compose.env file if deploying this using
 * the Docker Compose deployment instructions.
 */
const brokerConfig: BrokerOptions = {
  // Namespace of nodes to segment your nodes on the same network.
  namespace: 'development',
  // Unique node identifier. Must be unique in a namespace.
  // It will be unique when scaling up instances in Docker or on local computer
  nodeID: (process.env.NODE_ID ? `${process.env.NODE_ID}-` : '') + os.hostname().toLowerCase(),

  // Custom metadata store. Store here what you want. Accessing: `this.broker.metadata`
  metadata: {},

  // Enable/disable logging or use custom logger. More info: https://moleculer.services/docs/0.14/logging.html
  // Available logger types: "Console", "File", "Pino", "Winston", "Bunyan", "debug", "Log4js", "Datadog"
  logger: {
    type: 'Console',
    options: {
      // Using colors on the output
      colors: true,
      // Print module names with different colors (like docker-compose for containers)
      moduleColors: false,
      // Line formatter. It can be "json", "short", "simple", "full", a `Function` or a template string like "{timestamp} {level} {nodeID}/{mod}: {msg}"
      formatter: 'full',
      // Custom object printer. If not defined, it uses the `util.inspect` method.
      objectPrinter: null,
      // Auto-padding the module name in order to messages begin at the same column.
      autoPadding: false,
    },
  },
  // Default log level for built-in console logger. It can be overwritten in logger options above.
  // Available values: trace, debug, info, warn, error, fatal
  logLevel: 'info',

  // Define transporter.
  // More info: https://moleculer.services/docs/0.14/networking.html
  // Note: During the development, you don't need to define it because all services will be loaded locally.
  // In production you can set it via environment variable, e.g. `TRANSPORTER=nats://localhost:4222`
  transporter: 'TCP',

  // Define a cacher.
  // More info: https://moleculer.services/docs/0.14/caching.html
  cacher: 'MemoryLRU',

  // Define a serializer.
  // Available values: "JSON", "Avro", "ProtoBuf", "MsgPack", "Notepack", "Thrift".
  // More info: https://moleculer.services/docs/0.14/networking.html#Serialization
  serializer: 'JSON',

  // Number of milliseconds to wait before reject a request with a RequestTimeout error. Disabled: 0
  requestTimeout: 10 * 1000,

  // Retry policy settings. More info: https://moleculer.services/docs/0.14/fault-tolerance.html#Retry
  retryPolicy: {
    // Enable feature
    enabled: false,
    // Count of retries
    retries: 5,
    // First delay in milliseconds.
    delay: 100,
    // Maximum delay in milliseconds.
    maxDelay: 1000,
    // Backoff factor for delay. 2 means exponential backoff.
    factor: 2,
    // A function to check failed requests.
    check: (err: Errors.MoleculerError) => err && !!err.retryable,
  },

  // Limit of calling level. If it reaches the limit, broker will throw an MaxCallLevelError error. (Infinite loop protection)
  maxCallLevel: 100,

  // Number of seconds to send heartbeat packet to other nodes.
  heartbeatInterval: 5,
  // Number of seconds to wait before setting node to unavailable status.
  heartbeatTimeout: 15,

  // Disable built-in request & emit balancer. (Transporter must support it, as well.). More info: https://moleculer.services/docs/0.14/networking.html#Disabled-balancer
  disableBalancer: false,

  // Settings of Service Registry. More info: https://moleculer.services/docs/0.14/registry.html
  registry: {
    // Define balancing strategy. More info: https://moleculer.services/docs/0.14/balancing.html
    // Available values: "RoundRobin", "Random", "CpuUsage", "Latency", "Shard"
    strategy: 'RoundRobin',
    // Enable local action call preferring. Always call the local action instance if available.
    preferLocal: true,
  },

  // Settings of Circuit Breaker. More info: https://moleculer.services/docs/0.14/fault-tolerance.html#Circuit-Breaker
  circuitBreaker: {
    // Enable feature
    enabled: false,
    // Threshold value. 0.5 means that 50% should be failed for tripping.
    threshold: 0.5,
    // Minimum request count. Below it, CB does not trip.
    minRequestCount: 20,
    // Number of seconds for time window.
    windowTime: 60,
    // Number of milliseconds to switch from open to half-open state
    halfOpenTime: 10 * 1000,
    // A function to check failed requests.
    check: (err: Errors.MoleculerError) => err && err.code >= 500,
  },

  // Enable action & event parameter validation. More info: https://moleculer.services/docs/0.14/validating.html
  validator: true,

  errorHandler: null,

  // Enable/disable built-in metrics function. More info: https://moleculer.services/docs/0.14/metrics.html
  metrics: {
    enabled: false,
    // Available built-in reporters: "Console", "CSV", "Event", "Prometheus", "Datadog", "StatsD"
    // reporter: {
    //   type: 'Console',
    //   options: {
    //     // HTTP port
    //     port: 3030,
    //     // HTTP URL path
    //     path: '/metrics',
    //     // Default labels which are appended to all metrics labels
    //     defaultLabels: (registry: MetricRegistry) => ({
    //       namespace: registry.broker.namespace,
    //       nodeID: registry.broker.nodeID,
    //     }),
    //   },
    // },

    reporter: {
      type: 'Prometheus',
      options: {
        // HTTP port
        port: 3030,
        // HTTP URL path
        path: '/metrics',
        // Default labels which are appended to all metrics labels
        defaultLabels: (registry: MetricRegistry) => ({
          namespace: registry.broker.namespace,
          nodeID: registry.broker.nodeID,
        }),
      },
    },
  },

  // Enable built-in tracing function. More info: https://moleculer.services/docs/0.14/tracing.html
  tracing: {
    enabled: false,
    // Available built-in exporters: "Console", "Datadog", "Event", "EventLegacy", "Jaeger", "Zipkin"
    // exporter: {
    //   type: 'Console', // Console exporter is only for development!
    //   options: {
    //     // Custom logger
    //     logger: null,
    //     // Using colors
    //     colors: true,
    //     // Width of row
    //     width: 100,
    //     // Gauge width in the row
    //     gaugeWidth: 40,
    //   },
    // },

    exporter: {
      type: 'Jaeger',
      options: {
        // HTTP Reporter endpoint. If set, HTTP Reporter will be used.
        endpoint: null,
        // UDP Sender host option.
        host: '127.0.0.1',
        // UDP Sender port option.
        port: 6832,
        // Jaeger Sampler configuration.
        sampler: {
          // Sampler type. More info: https://www.jaegertracing.io/docs/1.14/sampling/#client-sampling-configuration
          type: 'Const',
          // Sampler specific options.
          options: {},
        },
        // Additional options for `Jaeger.Tracer`
        tracerOptions: {},
        // Default tags. They will be added into all span tags.
        defaultTags: null,
      },
    },
  },

  hotReload: false,

  // Register custom middlewares
  middlewares: [],

  // Register custom REPL commands.
  replCommands: null,

  /*
	// Called after broker created.
	created : (broker: ServiceBroker): void => {},
	// Called after broker started.
	started: async (broker: ServiceBroker): Promise<void> => {},
	stopped: async (broker: ServiceBroker): Promise<void> => {},
	 */
};

module.exports = brokerConfig;
