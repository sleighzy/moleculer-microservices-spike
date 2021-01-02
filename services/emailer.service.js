const { MoleculerError } = require('moleculer').Errors;
const { Service } = require('moleculer');
const nodemailer = require('nodemailer');
const KafkaService = require('../mixins/kafka.mixin');

class EmailerService extends Service {
  constructor(broker) {
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
          bootstrapServer:
            process.env.EMAILER_BOOTSTRAP_SERVER || 'localhost:9092',
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

      events: {
        // no events
      },

      created: this.serviceCreated,
      started: this.serviceStarted,
      stopped: this.serviceStopped,
    });
  }

  /**
   * Send email action handler.
   *
   * @param {String} message - Email message body
   */
  send(ctx) {
    this.sendEmail({
      from: '"foo" <foo@example.com>',
      to: 'bar@example.com, baz@example.com',
      subject: 'Hello',
      text: `${ctx.params.message}`,
      html: `<b>${ctx.params.message}</b>`,
    });
  }

  sendEmail(message) {
    // Send mail with defined transport object.
    return new Promise((resolve, reject) => {
      this.transporter.sendMail(message, (error, info) => {
        if (error) {
          this.logger.error(error);
          reject(error);
        }
        // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
        // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
        // Preview only available when sending through an Ethereal account
        this.logger.debug(
          'Preview URL: %s',
          nodemailer.getTestMessageUrl(info),
        );

        resolve(nodemailer.getTestMessageUrl(info));
      });
    });
  }

  async processEvent(event) {
    if (event.eventType === 'OrderCreated') {
      this.logger.debug(event);
      const { customerId, product, quantity } = event.order;
      const user = await this.broker.call('users.getUserByCustomerId', {
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
  serviceStarted() {
    // Start the Kafka consumer to read order events for sending emails
    this.startKafkaConsumer(
      this.settings.kafka.bootstrapServer,
      this.settings.kafka.ordersTopic,
      (error, message) => {
        if (error) {
          this.Promise.reject(
            new MoleculerError(
              `${error.message} ${error.detail}`,
              500,
              'CONSUMER_MESSAGE_ERROR',
            ),
          );
        }
        this.processEvent(JSON.parse(message.value));
      },
    );

    this.logger.debug('Emailer service started.');
  }

  /**
   * Service stopped lifecycle event handler
   */
  serviceStopped() {
    this.logger.debug('Emailer service stopped.');
  }
}

module.exports = EmailerService;
