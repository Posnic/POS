const nodemailer = require('nodemailer');
const pug = require('pug');
const { convert } = require('html-to-text');

class Email {
  constructor(user, url) {
    // Support both generic auth users (with name) and Posnic users (firstname/lastname/username)
    this.to = user.email;

    const fullName =
      (user && user.name) ||
      [user && user.firstname, user && user.lastname].filter(Boolean).join(' ') ||
      (user && user.username) ||
      (user && user.email) ||
      'User';

    this.firstName = String(fullName).trim().split(' ')[0] || 'User';
    this.url = url;

    const emailFrom = process.env.EMAIL_FROM || 'no-reply@posnic.local';
    this.from = `Your App <${emailFrom}>`;
  }

  newTransport() {
    if (process.env.NODE_ENV === 'production') {
      // Sendgrid
      return nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: process.env.SENDGRID_USERNAME,
          pass: process.env.SENDGRID_PASSWORD,
        },
      });
    }

    const hasCustomCredentials =
      process.env.EMAIL_HOST &&
      process.env.EMAIL_PORT &&
      process.env.EMAIL_USERNAME &&
      process.env.EMAIL_PASSWORD &&
      !['your_mailtrap_username', 'your_mailtrap_password'].includes(process.env.EMAIL_USERNAME) &&
      !['your_mailtrap_username', 'your_mailtrap_password'].includes(process.env.EMAIL_PASSWORD);

    if (hasCustomCredentials) {
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
    }

    // Fallback to a json transport in development so password reset works
    console.warn(
      'Email transport falling back to console output because SMTP credentials are missing. Update EMAIL_* env vars for real delivery.'
    );
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  // Send the actual email
  async send(template, subject) {
    // 1) Render HTML based on a pug template
    const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
      firstName: this.firstName,
      url: this.url,
      subject,
      email: this.to,
    });

    // 2) Define email options
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    // 3) Create a transport and send email
    const transporter = this.newTransport();
    const info = await transporter.sendMail(mailOptions);

    if (transporter.options && transporter.options.jsonTransport) {
      const preview = typeof info.message === 'string' ? JSON.parse(info.message) : info;
      console.info('Email preview (console transport):', JSON.stringify(preview, null, 2));
    }
  }

  async sendWelcome() {
    await this.send('welcome', 'Welcome to Your App!');
  }

  async sendPasswordReset() {
    await this.send('passwordReset', 'Your password reset token (valid for only 10 minutes)');
  }
}

// Helper function to send emails
const sendEmail = async (options) => {
  // 1) Create a transporter (reuse the same fallback logic)
  const emailHelper = {
    email: options.email || process.env.EMAIL_FROM || 'dev@localhost',
    name: String(options.name || options.email || 'User'),
  };
  const tempEmail = new Email(emailHelper, options.url || '');
  const transporter = tempEmail.newTransport();

  // 2) Define the email options
  const mailOptions = {
    from: 'Your App <hello@yourapp.com>',
    to: options.email,
    subject: options.subject,
    text: options.message,
  };

  // 3) Actually send the email
  const info = await transporter.sendMail(mailOptions);
  if (transporter.options && transporter.options.jsonTransport) {
    console.info(
      'Email preview (console transport):',
      typeof info.message === 'string' ? info.message : JSON.stringify(info)
    );
  }
};

/*
 * Owner rule: a shop that configured its own SMTP sends through it; a
 * cloud shop without one rides the platform transport (the Email class
 * chain above). Pass the branch doc (settings live on it) - absent or
 * incomplete config falls through to the platform chain.
 */
const nodemailer = require('nodemailer');
const resolveShopTransport = (branchDoc) => {
  const b = branchDoc || {};
  if (b.email_smtp_host && b.email_smtp_username) {
    return {
      transporter: nodemailer.createTransport({
        host: String(b.email_smtp_host),
        port: parseInt(b.email_smtp_port, 10) || 587,
        secure: b.email_smtp_secure === true,
        auth: {
          user: String(b.email_smtp_username),
          pass: String(b.email_smtp_password || ''),
        },
      }),
      from: String(b.email_smtp_from || b.email_smtp_username),
      shopOwned: true,
    };
  }
  const platform = new Email({ email: 'noreply', name: 'noreply' }, '').newTransport();
  return {
    transporter: platform,
    from: process.env.EMAIL_FROM || 'no-reply@posnic.local',
    shopOwned: false,
  };
};

module.exports = {
  Email,
  sendEmail,
  resolveShopTransport,
};
