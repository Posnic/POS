'use strict';

const axios = require('axios');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const providers = require('./sms-providers');
const whatsappProviders = require('./whatsapp-providers');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const digits = (p) => String(p || '').replace(/[^\d]/g, '');

/*
 * How a 'web' (QR-linked) WhatsApp message physically leaves the building.
 * 'inprocess' is today's whatsapp-web.js-inside-the-API; 'shadow' sends
 * in-process AND records the send in the connector outbox for parity;
 * 'connector' queues for the signed connector (I5/I6) and Chromium never
 * runs in this process. Per-branch, defaulting to no change at all.
 */
const TRANSPORTS = ['inprocess', 'shadow', 'connector'];

/*
 * Messaging settings + the SMS sender.
 *
 * SMS is the shop's own provider account. The shop picks a provider from the
 * registry and enters its credentials; we hold them only so the SERVER can send.
 * Two rules keep the secrets safe:
 *   1. getSettings() blanks every secret field and returns only which secrets
 *      are set - so a client (incl. a desktop copy) never receives a key.
 *   2. sending reads the raw secrets straight from the DB and calls the provider
 *      server-side; secrets never travel to the client to be used.
 * WhatsApp is not a credential here - it runs as a linked device on the shop's
 * own machine; we only record its id/host.
 */
class MessagingService {
  /** Provider list for the settings dropdown (metadata only, no secrets). */
  providers() {
    return providers.listProviders();
  }

  async _raw(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const row = await db.collection('messaging_settings').findOne(q);
    return (
      row || {
        sms_enabled: false,
        sms_provider: '',
        sms_config: {},
        sms_template: '',
        whatsapp_enabled: false,
        whatsapp_mode: 'web',
        whatsapp_device_id: '',
        whatsapp_host: '',
        whatsapp_cloud: {},
      }
    );
  }

  /** Settings for the screen, with every secret blanked and a "set" map instead. */
  async getSettings(branchId) {
    const raw = await this._raw(branchId);
    const secrets = providers.secretKeys(raw.sms_provider);
    const config = { ...(raw.sms_config || {}) };
    const secretsSet = {};
    for (const k of secrets) {
      secretsSet[k] = !!config[k];
      delete config[k]; // never leave the shop over the wire
    }
    // WhatsApp Cloud API access token is a secret too - blank it on read.
    const wa = whatsappProviders.publicConfig(raw.whatsapp_cloud || {});
    const cloud = wa.config, waSecretsSet = wa.secrets;

    return {
      branch_id: raw.branch_id || (branchId ? oid(branchId) : null),
      sms_enabled: !!raw.sms_enabled,
      sms_provider: raw.sms_provider || '',
      sms_config: config,
      sms_secrets_set: secretsSet,
      sms_template: raw.sms_template || '',
      whatsapp_enabled: !!raw.whatsapp_enabled,
      whatsapp_mode: raw.whatsapp_mode === 'cloud' ? 'cloud' : 'web',
      whatsapp_transport: TRANSPORTS.includes(raw.whatsapp_transport)
        ? raw.whatsapp_transport
        : 'inprocess',
      whatsapp_device_id: raw.whatsapp_device_id || '',
      whatsapp_host: raw.whatsapp_host || '',
      whatsapp_cloud: cloud,
      whatsapp_providers: whatsappProviders.list(),
      whatsapp_secrets_set: waSecretsSet,
    };
  }

  /**
   * Save settings. A blank secret means "keep the one already stored", so the UI
   * never has to echo a key back to change something else. Non-secret fields and
   * newly-typed secrets are written as given.
   */
  async saveSettings(branchId, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const now = new Date();
    const existing = await this._raw(branchId);

    const provider = String(data.sms_provider === undefined ? existing.sms_provider || '' : data.sms_provider || '').trim();
    const known = provider ? providers.getProvider(provider) : null;
    const incoming = data.sms_config || {};
    const merged = {};
    if (known) {
      const prevConfig = existing.sms_provider === provider ? existing.sms_config || {} : {};
      for (const f of known.fields) {
        const inVal = incoming[f.key];
        if (f.secret) {
          // keep the stored secret when the client sends nothing new
          merged[f.key] =
            inVal === undefined || inVal === null || inVal === ''
              ? prevConfig[f.key] || ''
              : String(inVal);
        } else {
          merged[f.key] =
            inVal !== undefined && inVal !== null ? String(inVal) : prevConfig[f.key] || '';
        }
      }
    }

    const set = {
      sms_enabled: data.sms_enabled === undefined ? !!existing.sms_enabled : data.sms_enabled === true || data.sms_enabled === 'true',
      sms_provider: provider,
      sms_config: merged,
      sms_template:
        data.sms_template !== undefined ? String(data.sms_template) : existing.sms_template || '',
      whatsapp_enabled: data.whatsapp_enabled === undefined ? !!existing.whatsapp_enabled : data.whatsapp_enabled === true || data.whatsapp_enabled === 'true',
      whatsapp_mode: (data.whatsapp_mode === undefined ? existing.whatsapp_mode : data.whatsapp_mode) === 'cloud' ? 'cloud' : 'web',
      whatsapp_transport: TRANSPORTS.includes(data.whatsapp_transport)
        ? data.whatsapp_transport
        : TRANSPORTS.includes(existing.whatsapp_transport)
          ? existing.whatsapp_transport
          : 'inprocess',
      whatsapp_device_id:
        data.whatsapp_device_id !== undefined
          ? String(data.whatsapp_device_id)
          : existing.whatsapp_device_id || '',
      whatsapp_host:
        data.whatsapp_host !== undefined
          ? String(data.whatsapp_host)
          : existing.whatsapp_host || '',
      whatsapp_cloud: this._mergeCloud(data.whatsapp_cloud || {}, existing.whatsapp_cloud || {}),
      branch_id: oid(branchId),
      branch_name: ctx.branchName || existing.branch_name || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };
    await db
      .collection('messaging_settings')
      .updateOne(
        { license: BaseModel.license, branch_id: oid(branchId) },
        { $set: set, $setOnInsert: { created_date: now, created_by: ctx.userName || '' } },
        { upsert: true }
      );
    return this.getSettings(branchId);
  }

  // Merge WhatsApp Cloud creds, keeping the stored access token when the client
  // sends it blank (same rule as the SMS secrets).
  _mergeCloud(incoming, prev) {
    return whatsappProviders.merge(incoming, prev);
  }

  /**
   * Send one WhatsApp message the way the shop chose:
   *  - 'web'   : the QR-linked device running on the shop's own machine;
   *  - 'cloud' : Meta's WhatsApp Cloud API (their registered app + access token).
   * A template name (cloud) sends an approved template with the text as its first
   * body variable; otherwise a plain text message (valid inside the 24h window).
   */
  async sendWhatsapp(branchId, phone, message, delivery = {}) {
    const result = await this._sendWhatsapp(branchId, phone, message, delivery);
    // Observability must never turn an accepted send into a retryable failure.
    try {
      const db = await BaseModel.getDb();
      await db.collection('messaging_events').insertOne({
        license: BaseModel.license, branch_id: oid(branchId), created_date: new Date(),
        purpose: delivery.purpose || 'Message', recipient_last4: digits(phone).slice(-4),
        status: result.ok ? (result.queued ? 'queued' : 'accepted') : result.uncertain ? 'needs_review' : 'failed',
        provider: result.provider || '', provider_message_id: result.messageId || null,
      });
    } catch (e) {
      console.warn('[messaging] Could not record send status');
    }
    return result;
  }

  async history(branchId) {
    if (!branchId) return [];
    const db = await BaseModel.getDb();
    const rows = await db.collection('messaging_events').find({ license: BaseModel.license, branch_id: oid(branchId) })
      .sort({ created_date: -1 }).limit(100).toArray();
    const queued = rows.filter(r => r.status === 'queued' && r.provider === 'whatsapp_connector');
    if (queued.length) {
      const jobs = await db.collection('whatsapp_outbox').find({
        license: BaseModel.license, branch_id: oid(branchId),
        _id: { $in: queued.map(r => oid(r.provider_message_id)) },
      }).toArray();
      const states = new Map(jobs.map(job => [String(job._id), job.status]));
      const display = { sent: 'accepted', dead: 'failed', pending: 'queued', claimed: 'sending', needs_review: 'needs_review' };
      queued.forEach(row => { row.status = display[states.get(String(row.provider_message_id))] || 'needs_review'; });
    }
    return rows;
  }

  async _sendWhatsapp(branchId, phone, message, delivery = {}) {
    const raw = await this._raw(branchId);
    if (!raw.whatsapp_enabled)
      return { ok: false, error: 'WhatsApp is not enabled for this branch' };
    if (!phone) return { ok: false, error: 'No phone number' };

    if (raw.whatsapp_mode === 'cloud') {
      if (delivery.document && !delivery.document.url)
        return { ok: false, error: 'Bill links are not configured. Configure invoice sharing before sending API receipts.' };
      return whatsappProviders.send(raw.whatsapp_cloud || {}, phone, message);
    }

    const db = await BaseModel.getDb();
    const transport = TRANSPORTS.includes(raw.whatsapp_transport)
      ? raw.whatsapp_transport
      : 'inprocess';

    // The connector owns the session: queue and answer. The outbox's claim/
    // retry/dead discipline takes it from here - see whatsapp-outbox.js.
    if (transport === 'connector') {
      if (delivery.document && !delivery.document.url)
        return { ok: false, error: 'Bill links are not configured for this sender.' };
      const outbox = require('./whatsapp-outbox');
      try {
        const queued = await outbox.enqueue(db, BaseModel.license, {
          branch_id: branchId,
          phone,
          message,
          scheduled: delivery.scheduled,
        });
        return {
          ok: true,
          queued: true,
          provider: 'whatsapp_connector',
          messageId: String(queued.id),
          error: null,
        };
      } catch (e) {
        return { ok: false, error: 'Could not queue the message: ' + e.message };
      }
    }

    const whatsappService = require('./whatsapp.service');
    const branch = branchId
      ? await db.collection('branches').findOne({ _id: oid(branchId) })
      : null;
    const deviceId = raw.whatsapp_device_id || (branch && branch.whatsapp_device_id);
    if (!deviceId) return { ok: false, error: 'No WhatsApp device linked for this branch' };
    let result;
    try {
      const r = await whatsappService.sendMessage(deviceId, branchId, phone, message, delivery.document);
      result = {
        ok: r && r.status === true,
        error: r && r.message,
        provider: 'whatsapp_web',
        messageId: r && r.messageId,
        uncertain: !!r?.uncertain,
      };
    } catch (e) {
      result = { ok: false, error: e.message };
    }

    // Shadow: the in-process send above already happened and stands; the
    // same message is recorded in the outbox with that verdict, so a week
    // of these rows IS the parity report the cutover decision reads.
    if (transport === 'shadow') {
      try {
        const outbox = require('./whatsapp-outbox');
        await outbox.enqueue(db, BaseModel.license, {
          branch_id: branchId,
          phone,
          message,
          shadow: true,
          inprocess: result,
        });
      } catch (e) {
        /* parity recording must never fail the send */
      }
    }
    return result;
  }

  /**
   * Send one SMS through the shop's configured provider. Reads the raw secrets
   * server-side and never returns them. Returns { ok, error } so the campaign
   * engine can log per recipient.
   */
  async sendSms(branchId, phone, message, context = {}) {
    const result = await this._sendSms(branchId, phone, message, context);
    try {
      const db = await BaseModel.getDb();
      await db.collection('messaging_events').insertOne({
        license: BaseModel.license, branch_id: oid(branchId), created_date: new Date(),
        channel: 'sms', purpose: context.purpose || 'Message',
        recipient_last4: digits(phone).slice(-4), status: result.ok ? 'accepted' : 'failed',
        provider: result.provider || 'sms', provider_message_id: result.messageId || null,
      });
    } catch (_) { console.warn('[messaging] Could not record SMS status'); }
    return result;
  }

  async _sendSms(branchId, phone, message, context = {}) {
    const raw = await this._raw(branchId);
    if (!raw.sms_enabled || !raw.sms_provider) {
      return { ok: false, error: 'SMS is not configured for this branch' };
    }
    const provider = providers.getProvider(raw.sms_provider);
    if (!provider) return { ok: false, error: `Unknown SMS provider: ${raw.sms_provider}` };
    if (!phone) return { ok: false, error: 'No phone number' };

    let spec;
    try {
      spec = provider.build(raw.sms_config || {}, phone, message, context);
    } catch (e) {
      return { ok: false, error: 'Provider config error: ' + e.message };
    }

    try {
      const req = {
        method: spec.method || 'POST',
        url: spec.url,
        ...(spec.family ? { family: spec.family } : {}),
        headers: { ...(spec.headers || {}) },
        timeout: 30000,
        validateStatus: () => true, // some providers signal failure with a 200 body
      };
      if (spec.bodyType === 'form') {
        req.headers['Content-Type'] =
          req.headers['Content-Type'] || 'application/x-www-form-urlencoded';
        req.data = new URLSearchParams(spec.body).toString();
      } else if (spec.bodyType === 'json') {
        req.data = spec.body;
      } else if (spec.bodyType === 'raw') {
        req.data = spec.body;
      }
      const resp = await axios(req);
      const ok = !!spec.success(resp.data, resp.status);
      return { ok, error: ok ? null : `Provider responded ${resp.status}`, status: resp.status,
        provider: raw.sms_provider, messageId: raw.sms_provider === 'msg91' && ok && typeof resp.data?.message === 'string'
          ? resp.data.message
          : raw.sms_provider === 'vonage_messages' && ok ? resp.data.message_uuid : null };
    } catch (e) {
      return {
        ok: false,
        error: (e.response && e.response.status ? `HTTP ${e.response.status}: ` : '') + e.message,
      };
    }
  }

  /**
   * Super-admin action: fire one real test message to check the credentials, on
   * whichever channel was asked for (defaults to SMS).
   */
  async test(branchId, phone, channel = 'sms', ctx = {}) {
    if (!phone) return { status: false, message: 'Enter a phone number to test' };
    const text = 'Test message from your POS. Messaging is configured correctly.';
    const raw = channel === 'sms' ? await this._raw(branchId) : {};
    const smsContext = raw.sms_provider === 'msg91' && raw.sms_config?.receipt_template_id
      ? { purpose: 'receipt', name: 'Posnic TEST', url: 'https://www.posnic.com/' } : {};
    const r =
      channel === 'whatsapp'
        ? await this.sendWhatsapp(branchId, phone, text, { purpose: 'Connection test' })
        : await this.sendSms(branchId, phone, text, smsContext);
    return {
      status: r.ok,
      data: { ok: r.ok, queued: !!r.queued, messageId: r.messageId || null, error: r.error || null },
      message: r.ok ? (r.queued ? 'Test message waiting to send' : 'Test message accepted by sender') : 'Test failed: ' + (r.error || 'unknown error'),
    };
  }
}

module.exports = MessagingService;
