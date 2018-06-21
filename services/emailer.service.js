const { Service } = require('moleculer');
const nodemailer = require('nodemailer');

class EmailerService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: 'emailer',
      meta: {
        scalable: true,
      },

      settings: {
        smtp: {
          host: process.env.SMTP_HOST || 'smtp.ethereal.email',
          port: process.env.SMTP_PORT || 587,
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
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
   * @param {String} message - Email message
   */
  send(ctx) {
    this.sendEmail(ctx.params.message);
  }

  sendEmail(message) {
    const mailOptions = {
      from: '"foo" <foo@example.com>', // sender address
      to: 'bar@example.com, baz@example.com', // list of receivers
      subject: 'Hello', // Subject line
      text: `${message}`, // plain text body
      html: '<b>Hello world?</b>', // html body
    };

    // Send mail with defined transport object.
    return new Promise((resolve, reject) => {
      this.transporter.sendMail(mailOptions, (error, info) => {
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

  /**
   * Service created lifecycle event handler
   */
  serviceCreated() {
    const { host, port, user, pass } = this.settings.smtp; // eslint-disable-line object-curly-newline

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
