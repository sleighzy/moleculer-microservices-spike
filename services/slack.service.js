const { Service } = require('moleculer');
const { MoleculerError } = require('moleculer').Errors;
const Kafka = require('kafka-node');
const Slack = require('slack-node');

class SlackService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'slack',

      meta: {
        scalable: true,
      },

      settings: {
        webhookUri: process.env.SLACK_WEBHOOK_URI,
        channel: process.env.SLACK_CHANNEL || '#general',
        username: process.env.SLACK_USERNAME || 'slack_service',
        bootstrapServer: process.env.SLACK_BOOTSTRAP_SERVER || 'localhost:9092',
        kafkaTopic: process.env.SLACK_KAFKA_TOPIC || 'slack-notifications',

        // Base request route path
        rest: 'slack/',
      },

      actions: {
        create: {
          rest: 'POST /',
          handler: this.send,
        },
      },

      events: {
        // No events
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  // Action handler
  send(ctx) {
    this.sendMessage(ctx.params.message);
  }

  // Private method
  sendMessage(message) {
    this.logger.debug(`Sending message '${message}'`);

    this.slack.webhook(
      {
        channel: this.settings.channel,
        username: this.settings.username,
        text: message,
      },
      (err, response) => {
        if (err) {
          return this.Promise.reject(
            new MoleculerError(
              `${err.message} ${err.detail}`,
              500,
              'SEND_MESSAGE_ERROR',
            ),
          );
        }
        this.logger.debug(response);
        return this.Promise.resolve(response);
      },
    );
  }

  /**
   * Service created lifecycle event handler
   */
  serviceCreated() {
    if (!this.settings.webhookUri) {
      this.logger.warn(
        "The `webhookUri` is not configured. Please set the 'SLACK_WEBHOOK_URI' environment variable!",
      );
    }
    if (!this.settings.channel) {
      this.logger.warn(
        "The `channel` is not configured. Please set the 'SLACK_CHANNEL' environment variable!",
      );
    }
    if (!this.settings.username) {
      this.logger.warn(
        "The `username` is not configured. Please set the 'SLACK_USERNAME' environment variable!",
      );
    }
    if (!this.settings.bootstrapServer) {
      this.logger.warn(
        "The `bootstrapServer` is not configured. Please set the 'SLACK_BOOTSTRAP_SERVER' environment variable!",
      );
    }
    if (!this.settings.kafkaTopic) {
      this.logger.warn(
        "The `kafkaTopic` is not configured. Please set the 'SLACK_KAFKA_TOPIC' environment variable!",
      );
    }

    this.logger.debug('Slack service created.');

    return this.Promise.resolve();
  }

  /**
   * Service started lifecycle event handler
   */
  serviceStarted() {
    this.slack = new Slack();
    this.slack.setWebhook(this.settings.webhookUri);

    const kafkaOptions = {
      kafkaHost: this.settings.bootstrapServer, // connect directly to kafka broker (instantiates a KafkaClient)
      batch: undefined, // put client batch settings if you need them (see Client)
      // ssl: true, // optional (defaults to false) or tls options hash
      groupId: 'kafka-node-slack',
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
      migrateHLC: false, // for details please see Migration section below
      migrateRolling: true,
    };

    this.consumer = new Kafka.ConsumerGroup(
      kafkaOptions,
      this.settings.kafkaTopic,
    );

    this.consumer.on('message', (message) => {
      // const buf = new Buffer(message.value, 'binary'), // Read string into a buffer.
      // decodedMessage = type.fromBuffer(buf.slice(0)); // Skip prefix.
      // this.logger.debug(decodedMessage);

      this.logger.debug(message);

      return this.sendMessage(message.value);
    });

    this.consumer.on('error', (err) =>
      this.Promise.reject(
        new MoleculerError(
          `${err.message} ${err.detail}`,
          500,
          'CONSUMER_MESSAGE_ERROR',
        ),
      ),
    );

    process.on('SIGINT', () => this.consumer.close(true));

    this.logger.debug(this.settings);
    this.logger.debug('Slack service started.');

    return this.Promise.resolve();
  }

  /**
   * Service stopped lifecycle event handler
   */
  serviceStopped() {
    this.logger.debug('Slack service stopped.');

    return this.Promise.resolve();
  }
}

module.exports = SlackService;
