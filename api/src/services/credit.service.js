'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DEFAULTS = {
  default_credit_limit: 0, // 0 = unlimited
  credit_terms_days: 0, // 0 = no due date
  reminder_enabled: false,
  reminder_channel: 'sms',
  reminder_template:
    'Hi {name}, you have {currency}{due} due at {shop}. Please pay at your convenience. Thank you.',
  reminder_min_due: 0,
  currency: '',
};

/*
 * Customer credit ("khata") + payment reminders.
 *
 * The outstanding a customer owes is the sum of `pending` across their rows in
 * the `transaction` ledger (the same figure the outstanding report uses); this
 * service reads it, enforces an optional credit limit, and sends reminders
 * through the shop's own messaging providers. The message building is a pure
 * function so it is currency-agnostic and unit-tested on its own.
 */
class CreditService {
  // ============================ pure ============================

  /** Fill {name} {due} {currency} {shop} in a reminder template. */
  static renderReminder(template, data = {}) {
    const map = {
      name: data.name || 'Customer',
      due: data.due != null ? round2(data.due) : 0,
      currency: data.currency || '',
      shop: data.shop || '',
    };
    return String(template || DEFAULTS.reminder_template).replace(/\{(\w+)\}/g, (m, k) => {
      const key = String(k).toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, key) ? String(map[key]) : m;
    });
  }

  /**
   * Decide whether a new credit amount fits within a customer's limit.
   * limit 0 = unlimited. `outstanding` and `addAmount` are branch-currency
   * numbers. Pure so it is easy to test; the DB read is in checkCreditLimit.
   */
  static withinLimit(limit, outstanding, addAmount) {
    const lim = Number(limit) || 0;
    const out = Number(outstanding) || 0;
    const add = Number(addAmount) || 0;
    if (lim <= 0) return { allowed: true, limit: 0, outstanding: out, wouldBe: out + add };
    const wouldBe = out + add;
    return { allowed: wouldBe <= lim, limit: lim, outstanding: out, wouldBe };
  }

  // ============================ settings ============================

  async getSettings(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const row = await db.collection('credit_settings').findOne(q);
    return {
      ...DEFAULTS,
      ...(row || {}),
      branch_id: branchId ? oid(branchId) : row && row.branch_id,
    };
  }

  async saveSettings(branchId, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const now = new Date();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
    const set = {
      default_credit_limit: Math.max(
        0,
        num(data.default_credit_limit, DEFAULTS.default_credit_limit)
      ),
      credit_terms_days: Math.max(0, parseInt(num(data.credit_terms_days, 0), 10) || 0),
      reminder_enabled: data.reminder_enabled === true || data.reminder_enabled === 'true',
      reminder_channel: data.reminder_channel === 'whatsapp' ? 'whatsapp' : 'sms',
      reminder_template:
        data.reminder_template !== undefined
          ? String(data.reminder_template)
          : DEFAULTS.reminder_template,
      reminder_min_due: Math.max(0, num(data.reminder_min_due, 0)),
      currency: data.currency !== undefined ? String(data.currency) : ctx.currency || '',
      branch_id: oid(branchId),
      branch_name: ctx.branchName || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };
    await db
      .collection('credit_settings')
      .updateOne(
        { license: BaseModel.license, branch_id: oid(branchId) },
        { $set: set, $setOnInsert: { created_date: now, created_by: ctx.userName || '' } },
        { upsert: true }
      );
    return this.getSettings(branchId);
  }

  // ============================ outstanding ============================

  /** A customer's outstanding = sum of `pending` across their ledger rows. */
  async dueFor(customerId) {
    const db = await BaseModel.getDb();
    const rows = await db
      .collection('transaction')
      .aggregate([
        { $match: { customer_id: oid(customerId), license: BaseModel.license } },
        { $group: { _id: '$customer_id', due: { $sum: '$pending' } } },
      ])
      .toArray();
    return rows.length ? round2(rows[0].due) : 0;
  }

  /** Customers who owe money, most-owed first, with their phone for reminders. */
  async outstanding(branchId, { minDue = 0 } = {}) {
    const db = await BaseModel.getDb();
    const grouped = await db
      .collection('transaction')
      .aggregate([
        { $match: { license: BaseModel.license } },
        {
          $group: {
            _id: '$customer_id',
            name: { $first: '$customer_name' },
            due: { $sum: '$pending' },
          },
        },
        { $match: { due: { $gt: Math.max(0, Number(minDue) || 0) } } },
        { $sort: { due: -1 } },
      ])
      .toArray();

    const custCol = db.collection('customers');
    const list = [];
    for (const g of grouped) {
      const cust = await custCol.findOne({ _id: g._id, license: BaseModel.license });
      list.push({
        customer_id: g._id,
        name: g.name || (cust && cust.name) || '',
        phone: (cust && cust.phone) || '',
        due: round2(g.due),
        credit_limit: (cust && Number(cust.creditLimit)) || 0,
      });
    }
    return { status: true, data: list, message: 'Outstanding customers' };
  }

  /**
   * Enforce an optional credit limit before a credit sale. The effective limit
   * is the customer's own if set, else the branch default. 0 = unlimited.
   */
  async checkCreditLimit(customerId, addAmount, branchId) {
    if (!customerId) return { allowed: true, limit: 0, outstanding: 0 };
    const db = await BaseModel.getDb();
    const cust = await db
      .collection('customers')
      .findOne({ _id: oid(customerId), license: BaseModel.license });
    const settings = await this.getSettings(branchId);
    const custLimit = cust && Number(cust.creditLimit) > 0 ? Number(cust.creditLimit) : 0;
    const limit = custLimit > 0 ? custLimit : Number(settings.default_credit_limit) || 0;
    const outstanding = await this.dueFor(customerId);
    const r = CreditService.withinLimit(limit, outstanding, addAmount);
    return { ...r, error: r.allowed ? null : 'Credit limit exceeded' };
  }

  // ============================ reminders ============================

  async _send(branchId, channel, phone, message) {
    const MessagingService = require('./messaging.service');
    const messagingService = new MessagingService();
    return channel === 'whatsapp'
      ? messagingService.sendWhatsapp(branchId, phone, message)
      : messagingService.sendSms(branchId, phone, message);
  }

  async _logReminder(db, e) {
    await db.collection('reminder_sends').insertOne({
      customer_id: oid(e.customerId),
      customer_name: e.customerName || '',
      phone: e.phone || '',
      channel: e.channel,
      due: round2(e.due || 0),
      status: e.status,
      error: e.error || null,
      message: e.message || '',
      day_key: e.dayKey,
      branch_id: e.branchId ? oid(e.branchId) : null,
      date: new Date(),
      license: BaseModel.license,
    });
  }

  /** Send one customer their outstanding reminder now (used by the button). */
  async sendReminder(customerId, { branchId, ctx = {}, dryRun = false, now = null } = {}) {
    const db = await BaseModel.getDb();
    const cust = await db
      .collection('customers')
      .findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const due = await this.dueFor(customerId);
    if (due <= 0) return { status: true, data: { sent: 0 }, message: 'Nothing outstanding' };

    const settings = await this.getSettings(branchId);
    const channel = settings.reminder_channel || 'sms';
    const phone = (cust.phone || '').toString().trim();
    const message = CreditService.renderReminder(settings.reminder_template, {
      name: cust.name,
      due,
      currency: settings.currency || ctx.currency || '',
      shop: ctx.branchName || settings.branch_name || '',
    });
    const dayKey = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);

    let status = 'skipped_nophone';
    let error = null;
    if (phone) {
      if (dryRun) status = 'dry_run';
      else {
        const r = await this._send(branchId, channel, phone, message);
        status = r && r.ok ? 'sent' : 'failed';
        error = r && r.ok ? null : (r && r.error) || 'send failed';
      }
    }
    await this._logReminder(db, {
      customerId,
      customerName: cust.name,
      phone,
      channel,
      due,
      status,
      error,
      message,
      dayKey,
      branchId,
    });
    return {
      status: status === 'sent' || status === 'dry_run',
      data: { status, due, channel },
      message:
        status === 'sent'
          ? 'Reminder sent'
          : status === 'dry_run'
            ? 'Dry run'
            : 'Reminder ' + status,
    };
  }

  /**
   * Remind every outstanding customer over the minimum due. Idempotent per day
   * (a customer is not reminded twice in one day) and wrapped per recipient so
   * one bad number cannot stop the run. A cron tick calls this per tenant.
   */
  async runReminders(branchId, { ctx = {}, dryRun = false, now = null } = {}) {
    const settings = await this.getSettings(branchId);
    if (!settings.reminder_enabled) {
      return { status: true, data: { sent: 0, skipped: 0 }, message: 'Reminders are off' };
    }
    const db = await BaseModel.getDb();
    const remCol = db.collection('reminder_sends');
    const dayKey = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);
    const { data: customers } = await this.outstanding(branchId, {
      minDue: settings.reminder_min_due,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const c of customers) {
      // once per customer per day
      const already = await remCol.findOne({
        customer_id: oid(c.customer_id),
        day_key: dayKey,
        license: BaseModel.license,
        status: { $in: ['sent', 'dry_run'] },
      });
      if (already) {
        skipped += 1;
        continue;
      }
      const r = await this.sendReminder(c.customer_id, { branchId, ctx, dryRun, now });
      const st = r.data && r.data.status;
      if (st === 'sent' || st === 'dry_run') sent += 1;
      else if (st === 'failed') failed += 1;
      else skipped += 1;
    }
    return {
      status: true,
      data: { total: customers.length, sent, failed, skipped, dryRun: !!dryRun },
      message: dryRun ? 'Reminder dry run complete' : 'Reminders sent',
    };
  }
}

module.exports = CreditService;
