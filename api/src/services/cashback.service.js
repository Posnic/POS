'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const CouponService = require('./coupon.service');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DEFAULTS = {
  enabled: false,
  percent: 0,
  min_spend: 0,
  max_cashback: 0, // 0 = no cap
  validity_days: 30,
  min_redeem_spend: 0,
  bind_to_customer: false,
  deliver_channel: 'none', // 'none' | 'sms' | 'whatsapp'
  deliver_template:
    'Thank you {name}! You earned {currency}{amount} cashback (code {code}) at {shop}. Use it on your next purchase before {expiry}.',
  currency: '',
};

/*
 * Cashback: a qualifying sale mints a unique, single-use coupon worth a % of the
 * bill, redeemable on the next visit before it expires. It reuses the coupon
 * engine (type: fixed, usage_limit 1, an end_date, optionally bound to the
 * customer), so redemption, limits and reversal are already handled at the till.
 * The maths is a pure function; issuing is idempotent per sale.
 */
class CashbackService {
  /** The cashback amount a bill earns, capped and rounded. Pure. */
  static computeCashback(billTotal, cfg = {}) {
    const c = { ...DEFAULTS, ...cfg };
    if (!c.enabled) return 0;
    const bill = Number(billTotal) || 0;
    if (bill < (Number(c.min_spend) || 0)) return 0;
    const pct = Number(c.percent) || 0;
    if (pct <= 0) return 0;
    let amt = bill * (pct / 100);
    const cap = Number(c.max_cashback) || 0;
    if (cap > 0 && amt > cap) amt = cap;
    return round2(amt);
  }

  /** Fill {name}{amount}{code}{currency}{shop}{expiry} in a delivery message. */
  static renderMessage(template, data = {}) {
    const map = {
      name: data.name || 'Customer',
      amount: data.amount != null ? round2(data.amount) : 0,
      code: data.code || '',
      currency: data.currency || '',
      shop: data.shop || '',
      expiry: data.expiry || '',
    };
    return String(template || DEFAULTS.deliver_template).replace(/\{(\w+)\}/g, (m, k) => {
      const key = String(k).toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, key) ? String(map[key]) : m;
    });
  }

  // ============================ settings ============================

  async getSettings(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const row = await db.collection('cashback_settings').findOne(q);
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
      enabled: data.enabled === true || data.enabled === 'true',
      percent: Math.min(100, Math.max(0, num(data.percent, 0))),
      min_spend: Math.max(0, num(data.min_spend, 0)),
      max_cashback: Math.max(0, num(data.max_cashback, 0)),
      validity_days: Math.max(
        1,
        parseInt(num(data.validity_days, DEFAULTS.validity_days), 10) || DEFAULTS.validity_days
      ),
      min_redeem_spend: Math.max(0, num(data.min_redeem_spend, 0)),
      bind_to_customer: data.bind_to_customer === true || data.bind_to_customer === 'true',
      deliver_channel: ['sms', 'whatsapp'].includes(data.deliver_channel)
        ? data.deliver_channel
        : 'none',
      deliver_template:
        data.deliver_template !== undefined
          ? String(data.deliver_template)
          : DEFAULTS.deliver_template,
      currency: data.currency !== undefined ? String(data.currency) : ctx.currency || '',
      branch_id: oid(branchId),
      branch_name: ctx.branchName || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };
    await db
      .collection('cashback_settings')
      .updateOne(
        { license: BaseModel.license, branch_id: oid(branchId) },
        { $set: set, $setOnInsert: { created_date: now, created_by: ctx.userName || '' } },
        { upsert: true }
      );
    return this.getSettings(branchId);
  }

  // ============================ issuing ============================

  // A short, human-typable, unique code (CB + 6 chars). Retries on the rare clash.
  async _uniqueCode(db) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    for (let attempt = 0; attempt < 8; attempt++) {
      let s = 'CB';
      for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
      const clash = await db.collection('coupons').findOne({ license: BaseModel.license, code: s });
      if (!clash) return s;
    }
    return 'CB' + Date.now().toString(36).toUpperCase();
  }

  /**
   * Mint a cashback coupon for a committed sale and (optionally) send it to the
   * customer. Idempotent per sale, so a retry does not issue twice. Never throws
   * to the caller's flow beyond returning a status - the caller wraps it so a
   * cashback hiccup can never fail a sale.
   */
  async issueForSale(sale, { ctx = {} } = {}) {
    const cfg = await this.getSettings(ctx.branchId);
    if (!cfg.enabled) return { status: true, data: { issued: 0 }, message: 'Cashback off' };
    const bill = Number(sale.sales_total || sale.total || 0);
    const amount = CashbackService.computeCashback(bill, cfg);
    if (amount <= 0)
      return { status: true, data: { issued: 0 }, message: 'No cashback for this bill' };

    const db = await BaseModel.getDb();
    const issues = db.collection('cashback_issues');
    const saleId = sale._id || sale.sales_id;
    const existing = await issues.findOne({ sale_id: oid(saleId), license: BaseModel.license });
    if (existing)
      return { status: true, data: { issued: 0, duplicate: true }, message: 'Already issued' };

    const code = await this._uniqueCode(db);
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, parseInt(cfg.validity_days, 10) || 30));
    const expiryKey = end.toISOString().slice(0, 10);

    const couponService = new CouponService();
    const r = await couponService.save(
      '',
      {
        code,
        description: `Cashback from sale ${sale.sales_id || ''}`.trim(),
        type: 'fixed',
        value: amount,
        min_spend: Number(cfg.min_redeem_spend) || 0,
        usage_limit: 1,
        per_customer_limit: 0,
        customer_id: cfg.bind_to_customer && sale.customer_id ? sale.customer_id : null,
        end_date: end,
        active: true,
        currency: cfg.currency || ctx.currency || '',
      },
      ctx
    );
    if (!r.status) return { status: false, message: r.message };
    const coupon = r.data;

    const phone = (sale.customer_phone || '').toString().trim();
    await issues.insertOne({
      sale_id: oid(saleId),
      sales_ref: sale.sales_id || '',
      coupon_id: coupon._id,
      code: coupon.code,
      amount,
      customer_id: sale.customer_id ? oid(sale.customer_id) : null,
      customer_name: sale.customer_name || '',
      phone,
      end_date: end,
      expiry_key: expiryKey,
      delivered: false,
      branch_id: ctx.branchId ? oid(ctx.branchId) : null,
      date: new Date(),
      license: BaseModel.license,
    });

    // Deliver it, if configured and we have a phone. Never blocks issuing.
    let delivered = false;
    if (cfg.deliver_channel !== 'none' && phone) {
      const message = CashbackService.renderMessage(cfg.deliver_template, {
        name: sale.customer_name,
        amount,
        code: coupon.code,
        currency: cfg.currency || ctx.currency || '',
        shop: ctx.branchName || cfg.branch_name || '',
        expiry: expiryKey,
      });
      try {
        const MessagingService = require('./messaging.service');
        const ms = new MessagingService();
        const res =
          cfg.deliver_channel === 'whatsapp'
            ? await ms.sendWhatsapp(ctx.branchId, phone, message)
            : await ms.sendSms(ctx.branchId, phone, message);
        delivered = !!(res && res.ok);
        if (delivered)
          await issues.updateOne({ coupon_id: coupon._id }, { $set: { delivered: true } });
      } catch (e) {
        console.error('[cashback] delivery skipped:', e && e.message);
      }
    }

    return {
      status: true,
      data: { issued: 1, code: coupon.code, amount, expiry: expiryKey, delivered },
      message: 'Cashback issued',
    };
  }

  /**
   * Void the cashback a sale minted, if that sale is cancelled - the customer no
   * longer earned it, so its coupon must not be redeemable. Deactivates the
   * coupon and marks the issue voided.
   */
  async reverseForSale(saleId) {
    const db = await BaseModel.getDb();
    const issue = await db
      .collection('cashback_issues')
      .findOne({ sale_id: oid(saleId), license: BaseModel.license, voided: { $ne: true } });
    if (!issue) return { status: true, data: { reversed: 0 }, message: 'No cashback to reverse' };
    if (issue.coupon_id) {
      await db
        .collection('coupons')
        .updateOne({ _id: issue.coupon_id }, { $set: { active: false } });
    }
    await db
      .collection('cashback_issues')
      .updateOne({ _id: issue._id }, { $set: { voided: true, voided_date: new Date() } });
    return { status: true, data: { reversed: 1 }, message: 'Cashback voided' };
  }

  /** Recent cashback coupons issued (for the settings screen). */
  async recent(branchId, { limit = 20 } = {}) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const rows = await db
      .collection('cashback_issues')
      .find(q)
      .sort({ date: -1 })
      .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
      .toArray();
    return { status: true, data: rows, message: 'Recent cashback' };
  }
}

module.exports = CashbackService;
