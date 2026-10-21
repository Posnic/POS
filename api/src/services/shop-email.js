'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');
const addressparser = require('nodemailer/lib/addressparser');
const { secretUpdate } = require('./settings-groups');
const FIELDS = ['email_provider', 'email_method', 'email_encryption', 'email_oauth_client_id'];
const SECRETS = ['email_api_key', 'email_oauth_client_secret', 'email_oauth_refresh_token'];
const API_PROVIDERS = ['brevo', 'sendgrid', 'postmark', 'resend'];

function settingsUpdate(data, previous = {}) {
  const out = {};
  for (const field of FIELDS)
    if (data[field] !== undefined) out[field] = String(data[field] || '').trim();
  for (const field of SECRETS) Object.assign(out, secretUpdate(field, data[field]));
  if (out.email_method && !['platform', 'smtp', 'api'].includes(out.email_method))
    throw new Error('Choose SMTP, API or Posnic email.');
  if (out.email_encryption && !['starttls', 'tls'].includes(out.email_encryption))
    throw new Error('Choose STARTTLS or SSL/TLS.');
  if (
    data.email_provider &&
    data.email_provider !==
      (previous.email_provider || (previous.email_smtp_host ? 'custom' : 'platform'))
  ) {
    for (const field of [...SECRETS, 'email_smtp_password']) out[field] = String(data[field] || '');
  }
  return out;
}

function addresses(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((v) =>
    typeof v === 'object'
      ? [{ email: v.address, name: v.name }]
      : addressparser(String(v || '')).map((a) => ({ email: a.address, name: a.name || undefined }))
  );
}

// Explicit shop settings never fall back to a different sender after an error.
function resolve(b) {
  if (!b.email_method || b.email_method === 'platform') return null;
  const from = String(b.email_smtp_from || b.email_smtp_username || '').trim();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(from))
    throw new Error('Add your verified From email address in Email settings.');
  const timeout = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 };
  if (b.email_method === 'smtp') {
    const port = Number(b.email_smtp_port);
    if (
      !b.email_smtp_host ||
      !b.email_smtp_username ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error('Complete the SMTP host, port and username in Email settings.');
    const secure = b.email_encryption === 'tls';
    if ((port === 465 && !secure) || (port === 587 && secure))
      throw new Error('Use SSL/TLS for port 465 and STARTTLS for port 587.');
    const options = {
      ...timeout,
      host: b.email_smtp_host,
      port,
      secure,
      requireTLS: !secure,
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    const microsoft = ['outlook', 'microsoft365'].includes(b.email_provider);
    let transporter;
    if (microsoft) {
      if (!b.email_oauth_client_id || !b.email_oauth_client_secret || !b.email_oauth_refresh_token)
        throw new Error('Complete Microsoft OAuth setup in Email settings.');
      // No password auth or arbitrary token endpoint. Obtain a fresh scoped token
      // for each send; do not cache credentials across tenant requests.
      transporter = {
        sendMail: async (mail) => {
          let token;
          try {
            const response = await axios.post(
              'https://login.microsoftonline.com/common/oauth2/v2.0/token',
              new URLSearchParams({
                client_id: b.email_oauth_client_id,
                client_secret: b.email_oauth_client_secret,
                refresh_token: b.email_oauth_refresh_token,
                grant_type: 'refresh_token',
                scope: 'https://outlook.office.com/SMTP.Send offline_access',
              }).toString(),
              {
                timeout: 15000,
                maxRedirects: 0,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              }
            );
            token = response.data.access_token;
          } catch (_) {
            // eslint-disable-next-line preserve-caught-error -- HTTP request errors include secrets; do not retain them.
            throw new Error(
              'Microsoft authorization failed. Check app consent and renew the refresh token in Email settings.'
            );
          }
          if (!token) throw new Error('Microsoft did not return an access token.');
          return nodemailer
            .createTransport({
              ...options,
              auth: { type: 'OAuth2', user: b.email_smtp_username, accessToken: token },
            })
            .sendMail(mail);
        },
      };
    } else {
      if (!b.email_smtp_password)
        throw new Error('Add your SMTP password or app password in Email settings.');
      transporter = nodemailer.createTransport({
        ...options,
        auth: { user: b.email_smtp_username, pass: b.email_smtp_password },
      });
    }
    return { transporter, from, shopOwned: true, branch: b };
  }
  if (b.email_method !== 'api' || !API_PROVIDERS.includes(b.email_provider))
    throw new Error('This email provider does not support API sending in Posnic.');
  if (!b.email_api_key) throw new Error('Add your email API key in Email settings.');
  return {
    from,
    shopOwned: true,
    branch: b,
    transporter: { options: { emailApi: b.email_provider }, sendMail: (mail) => sendApi(b, mail) },
  };
}

async function sendApi(b, mail) {
  const to = addresses(mail.to),
    sender = addresses(mail.from)[0];
  const attachments = (mail.attachments || []).map((a) => {
    if (a.path || a.href || (!Buffer.isBuffer(a.content) && typeof a.content !== 'string'))
      throw new Error('Email attachments must contain file data.');
    return {
      filename: a.filename,
      content: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content, a.encoding || 'utf8').toString('base64'),
      type: a.contentType || 'application/octet-stream',
    };
  });
  let url, body, headers;
  const common = { subject: mail.subject };
  if (b.email_provider === 'brevo') {
    url = 'https://api.brevo.com/v3/smtp/email';
    headers = { 'api-key': b.email_api_key };
    body = {
      ...common,
      sender,
      to,
      htmlContent: mail.html || undefined,
      textContent: mail.text || undefined,
      attachment: attachments.map((a) => ({ name: a.filename, content: a.content })),
    };
  } else if (b.email_provider === 'sendgrid') {
    url = 'https://api.sendgrid.com/v3/mail/send';
    headers = { Authorization: `Bearer ${b.email_api_key}` };
    body = {
      ...common,
      from: sender,
      personalizations: [{ to }],
      content: [
        ...(mail.text ? [{ type: 'text/plain', value: mail.text }] : []),
        ...(mail.html ? [{ type: 'text/html', value: mail.html }] : []),
      ],
      attachments: attachments.map((a) => ({ ...a, disposition: 'attachment' })),
    };
  } else if (b.email_provider === 'postmark') {
    url = 'https://api.postmarkapp.com/email';
    headers = { 'X-Postmark-Server-Token': b.email_api_key };
    body = {
      From: mail.from,
      To: to.map((a) => a.email).join(','),
      Subject: mail.subject,
      HtmlBody: mail.html,
      TextBody: mail.text,
      MessageStream: 'outbound',
      Attachments: attachments.map((a) => ({
        Name: a.filename,
        Content: a.content,
        ContentType: a.type,
      })),
    };
  } else {
    url = 'https://api.resend.com/emails';
    headers = { Authorization: `Bearer ${b.email_api_key}` };
    body = {
      ...common,
      from: mail.from,
      to: to.map((a) => a.email),
      html: mail.html,
      text: mail.text,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
    };
  }
  let response;
  try {
    response = await axios.post(url, body, { headers, timeout: 30000, maxRedirects: 0 });
  } catch (error) {
    // Axios errors contain the request headers (including keys). Never pass them
    // into logs or controller responses. No blind retry of uncertain submissions.
    const status = error.response && error.response.status;
    // eslint-disable-next-line preserve-caught-error -- Never retain Axios request headers containing API keys.
    throw new Error(
      status
        ? `Email provider rejected the request (HTTP ${status}). Check credentials, verified sender, allowed server IPs and provider logs.`
        : 'Email submission could not be confirmed. Check provider logs before retrying.'
    );
  }
  const data = response.data || {};
  const id =
    data.messageId || data.MessageID || data.id || (response.headers || {})['x-message-id'];
  if (!id || (data.ErrorCode && data.ErrorCode !== 0))
    throw new Error(
      'Email provider did not confirm acceptance. Check provider logs before retrying.'
    );
  return { messageId: id, accepted: to.map((a) => a.email), rejected: [] };
}
const SMTP_FIELDS = [
  'email_smtp_host',
  'email_smtp_port',
  'email_smtp_username',
  'email_smtp_password',
  'email_smtp_from',
];
async function raw(branchId) {
  const BaseModel = require('../models/base.model');
  const { ObjectId } = require('mongodb');
  if (!branchId || !BaseModel.license)
    throw new Error('Branch context is required for email settings.');
  const db = await BaseModel.getDb();
  const filter = { license: { $eq: BaseModel.license }, branch_id: new ObjectId(String(branchId)) };
  const row = await db.collection('messaging_settings').findOne(filter);
  return { db, filter, config: row && row.email_config };
}
async function read(branch) {
  const state = await raw(branch._id);
  return state.config || branch;
}
async function save(branch, data) {
  const state = await raw(branch._id),
    previous = state.config || branch;
  const config = { ...previous, ...settingsUpdate(data, previous) };
  // Store only email fields, never copy a whole branch into sender settings.
  for (const field of SMTP_FIELDS) {
    if (field === 'email_smtp_password') Object.assign(config, secretUpdate(field, data[field]));
    else if (data[field] !== undefined) config[field] = String(data[field] || '').trim();
  }
  if (
    data.email_provider &&
    data.email_provider !==
      (previous.email_provider || (previous.email_smtp_host ? 'custom' : 'platform')) &&
    !data.email_smtp_password
  )
    config.email_smtp_password = '';
  config.email_smtp_secure = config.email_encryption === 'tls';
  const values = {};
  for (const field of [...FIELDS, ...SECRETS, ...SMTP_FIELDS, 'email_smtp_secure'])
    if (config[field] !== undefined) values[field] = config[field];
  const transport = resolve(values); // Validate before saving; no network request.
  if (transport && transport.transporter.close) transport.transporter.close();
  await state.db
    .collection('messaging_settings')
    .updateOne(
      state.filter,
      { $set: { email_config: values, updated_date: new Date() }, $setOnInsert: state.filter },
      { upsert: true }
    );
  return publicConfig(values);
}
function publicConfig(config) {
  const values = {};
  for (const field of [...FIELDS, ...SMTP_FIELDS, 'email_smtp_secure'])
    if (config[field] !== undefined) values[field] = config[field];
  const secrets_configured = {};
  for (const field of [...SECRETS, 'email_smtp_password']) {
    secrets_configured[field] = !!config[field];
    delete values[field];
  }
  return { ...values, secrets_configured };
}
module.exports = { resolve, settingsUpdate, API_PROVIDERS, read, save, publicConfig };
