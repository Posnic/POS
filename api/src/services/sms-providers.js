'use strict';

/*
 * SMS provider registry.
 *
 * SMS is the customer's own account, not ours - each shop brings its provider
 * and its credentials, so we never own an SMS permission or a DLT template. This
 * registry describes the popular providers (global and per-country) and, for
 * each, how to turn (credentials, phone, message) into one HTTP request.
 *
 * Every provider implements the same pure contract so the sender is uniform and
 * testable without a network:
 *
 *   build(config, to, message) -> { method, url, headers, body, bodyType, success }
 *     - config   : the credentials/settings the shop saved for this provider
 *     - to        : destination phone (E.164-ish, provider decides '+' handling)
 *     - message   : the fully-rendered text
 *     - bodyType  : 'json' | 'form' | 'none'  (how the sender serialises body)
 *     - success(data, statusCode) -> boolean  (did the provider accept it?)
 *
 * `fields` is what the settings screen renders; `secret: true` fields are masked
 * on read and stored server-side only. A universal "custom" provider covers any
 * gateway not listed, by letting the shop describe the request itself.
 */

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const digits = (p) => String(p || '').replace(/[^\d]/g, '');
const plus = (p) => {
  const d = digits(p);
  return d ? '+' + d : '';
};
const ok2xx = (_data, status) => Number(status) >= 200 && Number(status) < 300;

const PROVIDERS = {
  // ------------------------------- global -------------------------------
  twilio: {
    id: 'twilio',
    name: 'Twilio',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'account_sid', label: 'Account SID', required: true },
      { key: 'auth_token', label: 'Auth Token', required: true, secret: true },
      { key: 'sender', label: 'From number / Messaging Service SID', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.account_sid)}/Messages.json`,
        headers: { Authorization: basic(c.account_sid, c.auth_token) },
        bodyType: 'form',
        body: { To: plus(to), From: c.sender, Body: message },
        success: (data, status) => ok2xx(data, status) && !!(data && data.sid),
      };
    },
  },

  vonage: {
    id: 'vonage',
    name: 'Vonage (Nexmo)',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'api_secret', label: 'API Secret', required: true, secret: true },
      { key: 'sender', label: 'From (name or number)', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://rest.nexmo.com/sms/json',
        headers: {},
        bodyType: 'form',
        body: {
          api_key: c.api_key,
          api_secret: c.api_secret,
          to: digits(to),
          from: c.sender,
          text: message,
        },
        success: (data) =>
          !!(data && data.messages && data.messages[0] && String(data.messages[0].status) === '0'),
      };
    },
  },

  plivo: {
    id: 'plivo',
    name: 'Plivo',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'auth_id', label: 'Auth ID', required: true },
      { key: 'auth_token', label: 'Auth Token', required: true, secret: true },
      { key: 'sender', label: 'Source number / sender', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: `https://api.plivo.com/v1/Account/${encodeURIComponent(c.auth_id)}/Message/`,
        headers: {
          Authorization: basic(c.auth_id, c.auth_token),
          'Content-Type': 'application/json',
        },
        bodyType: 'json',
        body: { src: c.sender, dst: digits(to), text: message },
        success: (data, status) => Number(status) === 202 || ok2xx(data, status),
      };
    },
  },

  infobip: {
    id: 'infobip',
    name: 'Infobip',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'base_url', label: 'Base URL (e.g. xxxxx.api.infobip.com)', required: true },
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender', required: true },
    ],
    build(c, to, message) {
      const base = String(c.base_url || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      return {
        method: 'POST',
        url: `https://${base}/sms/2/text/advanced`,
        headers: { Authorization: `App ${c.api_key}`, 'Content-Type': 'application/json' },
        bodyType: 'json',
        body: { messages: [{ from: c.sender, destinations: [{ to: digits(to) }], text: message }] },
        success: (data, status) => ok2xx(data, status),
      };
    },
  },

  brevo: {
    id: 'brevo',
    name: 'Brevo',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender name', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://api.brevo.com/v3/transactionalSMS/sms',
        headers: {
          'api-key': c.api_key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        bodyType: 'json',
        body: { sender: c.sender, recipient: digits(to), content: message, type: 'marketing' },
        success: (data, status) =>
          ok2xx(data, status) &&
          !!(
            (data && (data.messageId || data.reference)) ||
            ['delivered', 'sent', 'accepted'].includes((data && data.status) || '')
          ),
      };
    },
  },

  messagebird: {
    id: 'messagebird',
    name: 'MessageBird (Bird)',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'access_key', label: 'Access Key', required: true, secret: true },
      { key: 'sender', label: 'Originator (name/number)', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://rest.messagebird.com/messages',
        headers: {
          Authorization: `AccessKey ${c.access_key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        bodyType: 'form',
        body: { originator: c.sender, recipients: digits(to), body: message },
        success: (data, status) => ok2xx(data, status) && !!(data && data.id),
      };
    },
  },

  sinch: {
    id: 'sinch',
    name: 'Sinch',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'service_plan_id', label: 'Service Plan ID', required: true },
      { key: 'api_token', label: 'API Token', required: true, secret: true },
      { key: 'sender', label: 'From (number / sender ID)', required: true },
      { key: 'region', label: 'Region (us/eu/au/br/ca)', required: false },
    ],
    build(c, to, message) {
      const region = c.region || 'us';
      return {
        method: 'POST',
        url: `https://${region}.sms.api.sinch.com/xms/v1/${encodeURIComponent(c.service_plan_id)}/batches`,
        headers: { Authorization: `Bearer ${c.api_token}`, 'Content-Type': 'application/json' },
        bodyType: 'json',
        body: { from: c.sender, to: [plus(to)], body: message },
        success: (data, status) =>
          (Number(status) === 201 || ok2xx(data, status)) && !!(data && data.id),
      };
    },
  },

  telnyx: {
    id: 'telnyx',
    name: 'Telnyx',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'From number / sender', required: true },
      { key: 'messaging_profile_id', label: 'Messaging Profile ID (optional)', required: false },
    ],
    build(c, to, message) {
      const body = { from: c.sender, to: plus(to), text: message };
      if (c.messaging_profile_id) body.messaging_profile_id = c.messaging_profile_id;
      return {
        method: 'POST',
        url: 'https://api.telnyx.com/v2/messages',
        headers: { Authorization: `Bearer ${c.api_key}`, 'Content-Type': 'application/json' },
        bodyType: 'json',
        body,
        success: (data, status) => ok2xx(data, status) && !!(data && data.data && data.data.id),
      };
    },
  },

  clicksend: {
    id: 'clicksend',
    name: 'ClickSend',
    scope: 'global',
    freeform: true,
    fields: [
      { key: 'username', label: 'Username', required: true },
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'From (optional)', required: false },
    ],
    build(c, to, message) {
      const m = { to: plus(to), body: message };
      if (c.sender) m.from = c.sender;
      return {
        method: 'POST',
        url: 'https://rest.clicksend.com/v3/sms/send',
        headers: {
          Authorization: basic(c.username, c.api_key),
          'Content-Type': 'application/json',
        },
        bodyType: 'json',
        body: { messages: [m] },
        success: (data, status) =>
          ok2xx(data, status) && !!(data && data.response_code === 'SUCCESS'),
      };
    },
  },

  // ------------------------------- India --------------------------------
  // India providers are governed by DLT: promotional/transactional content must
  // reference a pre-approved template + registered sender, so `freeform` is false
  // and a `template_id` is required. The campaign text is passed as the template's
  // first variable (VAR1) - the shop's template should hold one content variable.
  msg91: {
    id: 'msg91',
    name: 'MSG91',
    scope: 'India',
    freeform: false,
    fields: [
      { key: 'authkey', label: 'Auth Key', required: true, secret: true },
      { key: 'sender', label: 'Sender ID (DLT approved, 6 char)', required: true },
      { key: 'template_id', label: 'DLT Template / Flow ID', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://control.msg91.com/api/v5/flow',
        headers: {
          authkey: c.authkey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        bodyType: 'json',
        body: {
          template_id: c.template_id,
          sender: c.sender,
          short_url: '0',
          recipients: [{ mobiles: digits(to), VAR1: message }],
        },
        success: (data, status) => ok2xx(data, status) && (data ? data.type !== 'error' : true),
      };
    },
  },

  textlocal: {
    id: 'textlocal',
    name: 'Textlocal (India)',
    scope: 'India',
    freeform: false,
    fields: [
      { key: 'apikey', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender ID (DLT approved)', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://api.textlocal.in/send/',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyType: 'form',
        body: { apikey: c.apikey, numbers: digits(to), sender: c.sender, message },
        success: (data, status) => ok2xx(data, status) && (data ? data.status === 'success' : true),
      };
    },
  },

  gupshup: {
    id: 'gupshup',
    name: 'Gupshup (Enterprise SMS)',
    scope: 'India',
    freeform: false,
    fields: [
      { key: 'userid', label: 'User ID', required: true },
      { key: 'password', label: 'Password', required: true, secret: true },
      { key: 'sender', label: 'Sender ID / mask', required: false },
    ],
    build(c, to, message) {
      const body = {
        method: 'SendMessage',
        send_to: digits(to),
        msg: message,
        msg_type: 'text',
        userid: c.userid,
        password: c.password,
        auth_scheme: 'plain',
        v: '1.1',
        format: 'json',
      };
      if (c.sender) body.mask = c.sender;
      return {
        method: 'POST',
        url: 'https://enterprise.smsgupshup.com/GatewayAPI/rest',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyType: 'form',
        body,
        success: (data, status) =>
          ok2xx(data, status) &&
          (data && data.response ? data.response.status === 'success' : true),
      };
    },
  },

  kaleyra: {
    id: 'kaleyra',
    name: 'Kaleyra',
    scope: 'India',
    freeform: false,
    fields: [
      { key: 'sid', label: 'SID (account id)', required: true },
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender ID (DLT approved)', required: true },
      { key: 'template_id', label: 'DLT Template ID', required: false },
    ],
    build(c, to, message) {
      const body = { to: digits(to), sender: c.sender, body: message, type: 'MKT' };
      if (c.template_id) body.template_id = c.template_id;
      return {
        method: 'POST',
        url: `https://api.in.kaleyra.io/v1/${encodeURIComponent(c.sid)}/messages`,
        headers: { 'api-key': c.api_key, 'Content-Type': 'application/json' },
        bodyType: 'json',
        body,
        success: (data, status) => ok2xx(data, status),
      };
    },
  },

  twofactor: {
    id: 'twofactor',
    name: '2Factor',
    scope: 'India',
    freeform: false,
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender ID (From)', required: true },
      { key: 'template_name', label: 'DLT Template Name', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: `https://2factor.in/API/V1/${encodeURIComponent(c.api_key)}/ADDON_SERVICES/SEND/TSMS`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyType: 'form',
        body: { From: c.sender, To: digits(to), TemplateName: c.template_name, VAR1: message },
        success: (data, status) => ok2xx(data, status) && (data ? data.Status === 'Success' : true),
      };
    },
  },

  fast2sms: {
    id: 'fast2sms',
    name: 'Fast2SMS',
    scope: 'India',
    freeform: true, // 'q' quick route is free-form (own number sender)
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'route', label: 'Route (q / dlt)', required: false },
      { key: 'sender', label: 'Sender ID (for DLT route)', required: false },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://www.fast2sms.com/dev/bulkV2',
        headers: { authorization: c.api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyType: 'form',
        body: {
          route: c.route || 'q',
          message,
          numbers: digits(to),
          language: 'english',
          flash: '0',
        },
        success: (data, status) => ok2xx(data, status) && !!(data && data.return === true),
      };
    },
  },

  // ------------------------------- Africa -------------------------------
  africastalking: {
    id: 'africastalking',
    name: "Africa's Talking",
    scope: 'Africa',
    freeform: true,
    fields: [
      { key: 'username', label: 'Username', required: true },
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'From / Short code (optional)', required: false },
    ],
    build(c, to, message) {
      const body = { username: c.username, to: plus(to), message };
      if (c.sender) body.from = c.sender;
      return {
        method: 'POST',
        url: 'https://api.africastalking.com/version1/messaging',
        headers: {
          apiKey: c.api_key,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        bodyType: 'form',
        body,
        success: (data, status) => ok2xx(data, status),
      };
    },
  },

  termii: {
    id: 'termii',
    name: 'Termii',
    scope: 'Africa',
    freeform: true,
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'sender', label: 'Sender ID', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://api.ng.termii.com/api/sms/send',
        headers: { 'Content-Type': 'application/json' },
        bodyType: 'json',
        body: {
          to: digits(to),
          from: c.sender,
          sms: message,
          type: 'plain',
          channel: 'generic',
          api_key: c.api_key,
        },
        success: (data, status) => ok2xx(data, status),
      };
    },
  },

  // --------------------------- Middle East / LATAM ----------------------
  unifonic: {
    id: 'unifonic',
    name: 'Unifonic',
    scope: 'Middle East',
    freeform: true,
    fields: [
      { key: 'app_sid', label: 'AppSid', required: true, secret: true },
      { key: 'sender', label: 'Sender ID', required: false },
    ],
    build(c, to, message) {
      const body = { AppSid: c.app_sid, Recipient: digits(to), Body: message };
      if (c.sender) body.SenderID = c.sender;
      return {
        method: 'POST',
        url: 'https://el.cloud.unifonic.com/rest/SMS/messages',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyType: 'form',
        body,
        success: (data, status) =>
          ok2xx(data, status) && (data ? String(data.success) === 'true' : true),
      };
    },
  },

  zenvia: {
    id: 'zenvia',
    name: 'Zenvia',
    scope: 'LATAM',
    freeform: true,
    fields: [
      { key: 'api_token', label: 'API Token', required: true, secret: true },
      { key: 'sender', label: 'From (sender identifier)', required: true },
    ],
    build(c, to, message) {
      return {
        method: 'POST',
        url: 'https://api.zenvia.com/v2/channels/sms/messages',
        headers: { 'X-API-TOKEN': c.api_token, 'Content-Type': 'application/json' },
        bodyType: 'json',
        body: { from: c.sender, to: digits(to), contents: [{ type: 'text', text: message }] },
        success: (data, status) => ok2xx(data, status) && !!(data && data.id),
      };
    },
  },

  // --------------------------- universal fallback -----------------------
  custom: {
    id: 'custom',
    name: 'Custom / Other (HTTP)',
    scope: 'any',
    freeform: true,
    fields: [
      { key: 'url', label: 'Send URL', required: true },
      { key: 'method', label: 'Method (GET/POST)', required: false },
      {
        key: 'auth_header',
        label: 'Authorization header value (optional)',
        required: false,
        secret: true,
      },
      { key: 'body_type', label: 'Body type (json/form)', required: false },
      {
        key: 'body_template',
        label: 'Body template - use {to} {from} {message}',
        required: false,
      },
      { key: 'sender', label: 'From / Sender', required: false },
    ],
    build(c, to, message) {
      const method = (c.method || 'POST').toUpperCase();
      const bodyType = (c.body_type || 'json').toLowerCase();
      const headers = {};
      if (c.auth_header) headers.Authorization = c.auth_header;
      let body;
      if (c.body_template) {
        const filled = String(c.body_template)
          .replace(/\{to\}/g, digits(to))
          .replace(/\{from\}/g, c.sender || '')
          .replace(/\{message\}/g, message);
        if (bodyType === 'json') {
          try {
            body = JSON.parse(filled);
          } catch (e) {
            body = { raw: filled };
          }
        } else {
          // form: key=value&key=value already, hand back as a string
          body = filled;
        }
      } else {
        body = { to: digits(to), from: c.sender || '', message };
      }
      return {
        method,
        url: c.url,
        headers,
        bodyType: typeof body === 'string' ? 'raw' : bodyType,
        body,
        success: (data, status) => ok2xx(data, status),
      };
    },
  },
};

/** Provider metadata for the settings dropdown (no build, no secrets). */
function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    scope: p.scope,
    freeform: p.freeform !== false,
    fields: p.fields.map((f) => ({ ...f })),
  }));
}

function getProvider(id) {
  return PROVIDERS[id] || null;
}

/** Which field keys are secret for a provider (used for masking). */
function secretKeys(id) {
  const p = PROVIDERS[id];
  return p ? p.fields.filter((f) => f.secret).map((f) => f.key) : [];
}

module.exports = { PROVIDERS, listProviders, getProvider, secretKeys };
