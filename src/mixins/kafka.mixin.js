const { HighLevelProducer, KafkaClient, KeyedMessage } = require('kafka-node');
const Kafka = require('kafka-node');

module.exports = {
  name: 'kafka',

  actions: {},

  methods: {
    /**
     * Function to create a Kafka producer to publish messages to a kafka topic.
     *
     * @param {String} bootstrapServer the Kafka bootstrap server to connect to
     * @param {Function} callback a callback function invoked for any Kafka client or producer errors
     */
    startKafkaProducer(bootstrapServer, callback) {
      const client = new KafkaClient({
        kafkaHost: bootstrapServer,
      });

      client.on('error', (error) => callback(error));

      this.producer = new HighLevelProducer(client, {
        // Configuration for when to consider a message as acknowledged, default 1
        requireAcks: 1,
        // The amount of time in milliseconds to wait for all acks before considered, default 100ms
        ackTimeoutMs: 100,
        // Partitioner type (default = 0, random = 1, cyclic = 2, keyed = 3, custom = 4), default 2
        partitionerType: 3,
      });

      this.producer.on('error', (error) => callback(error));
    },

    /**
     * Function to publish a message to a kafka topic.
     *
     * @param {String} topic the Kafka topic to publish the message to
     * @param {Object} message the message to be published, this object must contain "key" and "value" fields
     * @param {Function} callback a callback function invoked for each published message,
     * the callback takes an error and the result returned from Kafka for the sent message
     */
    sendMessage(topic, message, callback) {
      const payload = [
        {
          topic,
          messages: [new KeyedMessage(message.key, message.value)],
          attributes: 1, // Use GZip compression for the payload.
          timestamp: Date.now(),
        },
      ];

      this.producer.send(payload, (error, result) => {
        this.logger.debug('Sent message to Kafka:', JSON.stringify(payload));
        if (error) {
          return callback(error);
        }
        return callback(null, result);
      });
    },

    /**
     * Function to create a Kafka consumer and start consuming messages from a topic.
     * @param {Object} consumer object containing properties for:
     * @param {String} consumer.bootstrapServer the Kafka bootstrap server to connect to
     * @param {String} consumer.topic the Kafka topic to send messages to
     * @param {Function} consumer.callback a callback function invoked for each consumed message,
     * the callback takes an error and the message from the topic
     */
    startKafkaConsumer(consumer) {
      const { bootstrapServer, topic, callback } = consumer;
      const kafkaOptions = {
        kafkaHost: bootstrapServer, // connect directly to kafka broker (instantiates a KafkaClient)
        batch: undefined, // put client batch settings if you need them (see Client)
        // ssl: true, // optional (defaults to false) or tls options hash
        // The consumer group id consists of the prefix 'moleculer-', the name of the service that
        // this mixin is being merged into, and the topic being consumed.
        groupId: `moleculer-${this.name}-${topic}`,
        sessionTimeout: 15000,
        // An array of partition assignment protocols ordered by preference.
        // 'roundrobin' or 'range' string for built ins (see below to pass in custom assignment protocol)
        protocol: ['roundrobin'],

        // Set encoding to 'buffer' for binary data.
        // encoding: 'buffer',

        // Offsets to use for new groups other options could be 'earliest' or 'none' (none will emit an error if no offsets were saved)
        // equivalent to Java client's auto.offset.reset
        fromOffset: 'latest', // default

        // how to recover from OutOfRangeOffset error (where save offset is past server retention) accepts same value as fromOffset
        outOfRangeOffset: 'earliest', // default
        migrateHLC: false,
        migrateRolling: true,
      };

      new Kafka.ConsumerGroup(kafkaOptions, topic)
        .on('message', (message) => callback(null, message))
        .on('error', (err) => callback(err))
        .on('SIGINT', () => this.consumer.close(true));
    },

    /**
     * Function to create and start consuming messages for multiple Kafka consumers
     *
     * @param {Object[]} consumers an array of consumer objects containing properties for
     * each Kafka consumer to create
     */
    startKafkaConsumers(consumers) {
      consumers.forEach((consumer) => this.startKafkaConsumer(consumer));
    },
  },
};
