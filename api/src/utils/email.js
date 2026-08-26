const nodemailer = require('nodemailer');
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
    const brandName = process.env.WHITE_LABEL_NAME || 'Posnic';
    this.from = `${brandName} <${emailFrom}>`;
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
    /* the public demo sends nothing anywhere - see config/demo-mode.js */
    if (require('../config/demo-mode').isDemoMode()) {
      console.info('[demo] email suppressed:', subject);
      return;
    }
    /*
     * The shared layout, same as every document mail - the auth mails were
     * the last two still wearing the scaffold pug files. The body copy
     * lives here; the frame (header, footer, brand, white-label) is the
     * one frame everything sends with.
     */
    const { brandFor, renderEmail, ctaButton, esc: e } = require('./email-layout');
    const brand = brandFor(null);
    const BODIES = {
      welcome:
        '<p style="margin:0 0 12px;font-size:13.5px;color:#3a4459;">' +
        `Welcome aboard, ${e(this.firstName)}! Your account is ready - your shop, ` +
        'your products and your sales all live in one place from here on.</p>' +
        (this.url ? ctaButton('Open your dashboard', this.url) : ''),
      passwordReset:
        '<p style="margin:0 0 12px;font-size:13.5px;color:#3a4459;">' +
        `Hi ${e(this.firstName)}, we received a request to reset your password. ` +
        'The link below is valid for 10 minutes.</p>' +
        (this.url ? ctaButton('Reset your password', this.url) : '') +
        '<p style="margin:12px 0 0;font-size:12.5px;color:#69758c;">' +
        'If you did not ask for this, you can safely ignore this email - ' +
        'your password stays as it is.</p>',
    };
    const html = renderEmail({
      brand,
      title: subject,
      preheader: subject,
      bodyHtml: BODIES[template] || `<p style="font-size:13.5px;color:#3a4459;">${e(subject)}</p>`,
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
    await this.send('welcome', `Welcome to ${process.env.WHITE_LABEL_NAME || 'Posnic'}!`);
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
    from: `${process.env.WHITE_LABEL_NAME || 'Posnic'} <${process.env.EMAIL_FROM || 'no-reply@posnic.local'}>`,
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
const resolveShopTransport = (branchDoc) => {
  const b = branchDoc || {};
  /* A HALF-filled card (password missing) must not outrank the working
     platform path - 'Missing credentials for PLAIN' taught this. */
  if (b.email_smtp_host && b.email_smtp_username && b.email_smtp_password) {
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
      branch: b,
    };
  }
  /*
   * White-label from-address (owner: "from address white label as per their
   * configuration"). Used on the PLATFORM paths below - a shop with its own
   * SMTP already sends as itself above. The address must belong to a domain
   * the white-label partner has verified with the mail provider, which is
   * exactly what "as per their configuration" means.
   */
  const whiteLabelFrom = String(b.white_label_from || process.env.WHITE_LABEL_FROM || '').trim();
  /*
   * The platform's PROVEN mail path is Brevo (the daily reports arrive
   * through it); the legacy SMTP env rejects with EAUTH. So: Brevo when
   * its key exists, legacy chain only as the last resort. The from stays
   * the platform address while the DISPLAY NAME is the shop's (owner:
   * "white label from later; name is shop name").
   */
  const brevoKey = process.env.SENDINBLUE_KEY || process.env.BREVO_API_KEY || '';
  if (brevoKey) {
    return {
      transporter: {
        options: { brevo: true },
        sendMail: async (mail) => {
          const { BrevoClient } = require('@getbrevo/brevo');
          const client = new BrevoClient({ apiKey: brevoKey });
          const m = String(mail.from || '').match(/^(.*)<([^>]+)>\s*$/);
          const sender = m
            ? { name: m[1].trim().replace(/(^"|"$)/g, ''), email: m[2].trim() }
            : { email: String(mail.from || process.env.EMAIL_FROM || 'info@posnic.com').trim() };
          const to = String(mail.to || '')
            .split(',')
            .map((e) => ({ email: e.trim() }))
            .filter((x) => x.email);
          const payload = {
            sender,
            to,
            subject: String(mail.subject || ''),
            ...(mail.html ? { htmlContent: String(mail.html) } : {}),
            ...(!mail.html && mail.text ? { textContent: String(mail.text) } : {}),
            ...(Array.isArray(mail.attachments) && mail.attachments.length
              ? {
                  attachment: mail.attachments.map((a) => ({
                    name: a.filename || 'attachment.pdf',
                    content: Buffer.isBuffer(a.content)
                      ? a.content.toString('base64')
                      : String(a.content),
                  })),
                }
              : {}),
          };
          const result = await client.transactionalEmails.sendTransacEmail(payload);
          return {
            messageId:
              (result && (result.messageId || (result.body && result.body.messageId))) || 'brevo',
          };
        },
      },
      from: whiteLabelFrom || process.env.EMAIL_FROM || 'info@posnic.com',
      shopOwned: false,
      branch: b,
    };
  }
  const platform = new Email({ email: 'noreply', name: 'noreply' }, '').newTransport();
  return {
    transporter: platform,
    from: whiteLabelFrom || process.env.EMAIL_FROM || 'no-reply@posnic.local',
    shopOwned: false,
    branch: b,
  };
};

module.exports = {
  Email,
  sendEmail,
  resolveShopTransport,
};

/* env note: BREVO_API_KEY arrives via the deploy env-write (4c875ca). */
