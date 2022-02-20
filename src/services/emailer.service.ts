import { Context, Service, ServiceBroker } from 'moleculer';
import { MoleculerError } from 'moleculer/src/errors';
import nodemailer from 'nodemailer';
import KafkaService from '../mixins/kafka.mixin';
import { Message, OrderEvent, OrderEventType } from '../types/emailer';
import { User } from '../types/users';

interface ContextWithParams extends Context {
  params: {
    message: string;
  };
}

class EmailerService extends Service {
  constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'emailer',
      meta: {
        scalable: true,
      },

      mixins: [KafkaService],

      settings: {
        smtp: {
          host: process.env.SMTP_HOST || 'smtp.ethereal.email',
          port: process.env.SMTP_PORT || 587,
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        kafka: {
          bootstrapServer: process.env.EMAILER_BOOTSTRAP_SERVER || 'localhost:9092',
          ordersTopic: process.env.EMAILER_ORDERS_TOPIC || 'orders',
        },
      },

      actions: {
        send: {
          params: {
            message: 'string',
          },
          handler: this.send,
        },
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
    });
  }

  /**
   * Send email action handler.
   *
   * @param {String} message - Email message body
   */
  send(ctx: ContextWithParams) {
    this.sendEmail({
      from: '"foo" <foo@example.com>',
      to: 'bar@example.com, baz@example.com',
      subject: 'Hello',
      text: `${ctx.params.message}`,
      html: `<b>${ctx.params.message}</b>`,
    });
  }

  sendEmail(message: Message): Promise<unknown> {
    // Send mail with defined transport object.
    return new Promise((resolve, reject) => {
      this.transporter.sendMail(message, (error: any, info: any) => {
        if (error) {
          this.logger.error(error);
          reject(error);
        }
        // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
        // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
        // Preview only available when sending through an Ethereal account
        this.logger.debug('Preview URL: %s', nodemailer.getTestMessageUrl(info));

        resolve(nodemailer.getTestMessageUrl(info));
      });
    });
  }

  async processEvent(event: OrderEvent) {
    if (event.eventType === OrderEventType.ORDER_CREATED) {
      this.logger.debug(event);
      const { customerId, product, quantity } = event.order;
      const user: User = await this.broker.call('users.getUserByCustomerId', {
        customerId,
      });

      this.sendEmail({
        from: '"Customer Services" <noreply@example.com>',
        to: user.email,
        subject: `Order: ${product}`,
        text: `Hi ${user.username}, your order for ${product} is currently being processed.`,
        html: `Hi ${user.username},<p>Your order for the below product(s) is currently being processed:<ul><li>${product} <i>(Quantity: ${quantity})</i></li></ul></p>`,
      });
    }
  }

  handleMessage = (error: any, message: string): void => {
    if (error) {
      Promise.reject(new MoleculerError(`${error.message} ${error.detail}`, 500, 'CONSUMER_MESSAGE_ERROR'));
    }
    this.processEvent(JSON.parse(message));
  };

  /**
   * Service created lifecycle event handler
   */
  serviceCreated() {
    const { host, port, user, pass } = this.settings.smtp;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      auth: {
        user,
        pass,
      },
    });

    this.logger.debug('Emailer service created.');
  }

  /**
   * Service started lifecycle event handler
   */
  serviceStarted(): Promise<void> {
    // Start the Kafka consumer to read order events for sending emails
    this.startKafkaConsumer({
      bootstrapServer: this.settings.kafka.bootstrapServer,
      topic: this.settings.kafka.ordersTopic,
      callback: this.handleMessage,
    });

    this.logger.debug('Emailer service started.');

    return Promise.resolve();
  }
}

export default EmailerService;
