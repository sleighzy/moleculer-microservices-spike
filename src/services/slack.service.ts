import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import Slack from 'slack-node';
import KafkaService from '../mixins/kafka.mixin';

interface ContextWithSlack extends Context {
  params: {
    message: string;
    product: string;
  };
}

class SlackService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'slack',

      mixins: [KafkaService],

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
          params: {
            message: 'string',
          },
          handler: this.send,
        },
      },

      events: {
        'inventory.insufficientStock': {
          handler(ctx: ContextWithSlack) {
            this.postChatMessage(`Insufficient Stock: ${ctx.params.product}`);
          },
        },
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
    });
  }

  // Action handler
  send(ctx: ContextWithSlack) {
    this.postChatMessage(ctx.params.message);
  }

  postChatMessage(message: string) {
    this.logger.debug(`Posting message '${message}' to Slack channel ${this.settings.channel}`);

    this.slack.webhook(
      {
        channel: this.settings.channel,
        username: this.settings.username,
        text: message,
      },
      (err: any, response: any) => {
        if (err) {
          return Promise.reject(new MoleculerError(`${err.message} ${err.detail}`, 500, 'SEND_MESSAGE_ERROR'));
        }
        this.logger.debug(response);
        return Promise.resolve(response);
      },
    );
  }

  handleMessage = (error: any, message: string) => {
    if (error) {
      Promise.reject(new MoleculerError(`${error.message} ${error.detail}`, 500, 'CONSUMER_MESSAGE_ERROR'));
    }

    this.postChatMessage(message);
  };

  /**
   * Service created lifecycle event handler
   */
  serviceCreated() {
    if (!this.settings.webhookUri) {
      this.logger.warn("The `webhookUri` is not configured. Please set the 'SLACK_WEBHOOK_URI' environment variable!");
    }
    if (!this.settings.channel) {
      this.logger.warn("The `channel` is not configured. Please set the 'SLACK_CHANNEL' environment variable!");
    }
    if (!this.settings.username) {
      this.logger.warn("The `username` is not configured. Please set the 'SLACK_USERNAME' environment variable!");
    }
    if (!this.settings.bootstrapServer) {
      this.logger.warn(
        "The `bootstrapServer` is not configured. Please set the 'SLACK_BOOTSTRAP_SERVER' environment variable!",
      );
    }
    if (!this.settings.kafkaTopic) {
      this.logger.warn("The `kafkaTopic` is not configured. Please set the 'SLACK_KAFKA_TOPIC' environment variable!");
    }

    this.logger.debug('Slack service created.');
  }

  /**
   * Service started lifecycle event handler
   */
  serviceStarted(): Promise<void> {
    this.slack = new Slack();
    this.slack.setWebhook(this.settings.webhookUri);

    this.logger.debug(this.settings);

    // Start the Kafka consumer to read messages from the topic
    // to be sent to the Slack channel
    this.startKafkaConsumer({
      bootstrapServer: this.settings.bootstrapServer,
      topic: this.settings.kafkaTopic,
      callback: this.handleMessage,
    });

    this.logger.debug('Slack service started.');

    return Promise.resolve();
  }
}

export default SlackService;
