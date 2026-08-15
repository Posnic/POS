'use strict';

const axios = require('axios');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const providers = require('./sms-providers');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);

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
        whatsapp_device_id: '',
        whatsapp_host: '',
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
    return {
      branch_id: raw.branch_id || (branchId ? oid(branchId) : null),
      sms_enabled: !!raw.sms_enabled,
      sms_provider: raw.sms_provider || '',
      sms_config: config,
      sms_secrets_set: secretsSet,
      sms_template: raw.sms_template || '',
      whatsapp_enabled: !!raw.whatsapp_enabled,
      whatsapp_device_id: raw.whatsapp_device_id || '',
      whatsapp_host: raw.whatsapp_host || '',
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

    const provider = String(data.sms_provider || '').trim();
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
      sms_enabled: data.sms_enabled === true || data.sms_enabled === 'true',
      sms_provider: provider,
      sms_config: merged,
      sms_template:
        data.sms_template !== undefined ? String(data.sms_template) : existing.sms_template || '',
      whatsapp_enabled: data.whatsapp_enabled === true || data.whatsapp_enabled === 'true',
      whatsapp_device_id:
        data.whatsapp_device_id !== undefined
          ? String(data.whatsapp_device_id)
          : existing.whatsapp_device_id || '',
      whatsapp_host:
        data.whatsapp_host !== undefined
          ? String(data.whatsapp_host)
          : existing.whatsapp_host || '',
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

  /**
   * Send one SMS through the shop's configured provider. Reads the raw secrets
   * server-side and never returns them. Returns { ok, error } so the campaign
   * engine can log per recipient.
   */
  async sendSms(branchId, phone, message) {
    const raw = await this._raw(branchId);
    if (!raw.sms_enabled || !raw.sms_provider) {
      return { ok: false, error: 'SMS is not configured for this branch' };
    }
    const provider = providers.getProvider(raw.sms_provider);
    if (!provider) return { ok: false, error: `Unknown SMS provider: ${raw.sms_provider}` };
    if (!phone) return { ok: false, error: 'No phone number' };

    let spec;
    try {
      spec = provider.build(raw.sms_config || {}, phone, message);
    } catch (e) {
      return { ok: false, error: 'Provider config error: ' + e.message };
    }

    try {
      const req = {
        method: spec.method || 'POST',
        url: spec.url,
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
      return { ok, error: ok ? null : `Provider responded ${resp.status}`, status: resp.status };
    } catch (e) {
      return {
        ok: false,
        error: (e.response && e.response.status ? `HTTP ${e.response.status}: ` : '') + e.message,
      };
    }
  }

  /** Super-admin action: fire one real test message to check the credentials. */
  async testSms(branchId, phone, ctx = {}) {
    if (!phone) return { status: false, message: 'Enter a phone number to test' };
    const r = await this.sendSms(
      branchId,
      phone,
      'Test message from your POS — SMS is configured correctly.'
    );
    return {
      status: r.ok,
      data: { ok: r.ok, error: r.error || null },
      message: r.ok ? 'Test message sent' : 'Test failed: ' + (r.error || 'unknown error'),
    };
  }
}

module.exports = MessagingService;
