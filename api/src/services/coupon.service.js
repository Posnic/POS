'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { COUPON_TYPE, DEFAULT_COUPON, MESSAGES } = require('../constants/coupon.constants');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (code) =>
  String(code || '')
    .trim()
    .toUpperCase();

/*
 * The coupon engine.
 *
 * As with loyalty, the decision - is this code usable on this bill, and what is
 * it worth - is a static, pure function that takes the coupon, the bill and the
 * usage counts and returns a discount. No database, no currency of its own, so
 * it is unit-tested in isolation. The instance methods wrap it with the usage
 * counts, the redemption ledger and the coupon's running counter.
 */
class CouponService {
  // ============================ pure maths ============================

  /**
   * Decide whether `coupon` applies to `billTotal` and, if so, the discount it
   * gives. Everything time- and usage-related is passed in so this stays pure.
   * `billTotal` is already in the branch's currency; a percent coupon ignores it
   * for currency and a fixed coupon simply subtracts an amount of it.
   */
  static computeDiscount(coupon, billTotal, opts = {}) {
    const c = { ...DEFAULT_COUPON, ...(coupon || {}) };
    const bill = Number(billTotal) || 0;
    const { timesUsed = 0, customerUses = 0, customerId = null } = opts;
    const nowMs = opts.now != null ? new Date(opts.now).getTime() : Date.now();

    if (!c.active) return { valid: false, discount: 0, error: MESSAGES.INACTIVE };

    if (c.start_date) {
      const start = new Date(c.start_date).getTime();
      if (Number.isFinite(start) && nowMs < start) {
        return { valid: false, discount: 0, error: MESSAGES.NOT_STARTED };
      }
    }
    if (c.end_date) {
      const end = new Date(c.end_date);
      end.setHours(23, 59, 59, 999); // the end day is inclusive
      if (Number.isFinite(end.getTime()) && nowMs > end.getTime()) {
        return { valid: false, discount: 0, error: MESSAGES.EXPIRED };
      }
    }

    // A code bound to a customer, or one that limits uses per customer, needs to
    // know who is buying.
    const boundTo = c.customer_id ? String(c.customer_id) : null;
    if (boundTo || Number(c.per_customer_limit) > 0) {
      if (!customerId) return { valid: false, discount: 0, error: MESSAGES.NO_CUSTOMER };
      if (boundTo && String(customerId) !== boundTo) {
        return { valid: false, discount: 0, error: MESSAGES.WRONG_CUSTOMER };
      }
    }

    if (Number(c.usage_limit) > 0 && timesUsed >= Number(c.usage_limit)) {
      return { valid: false, discount: 0, error: MESSAGES.USAGE_LIMIT };
    }
    if (Number(c.per_customer_limit) > 0 && customerUses >= Number(c.per_customer_limit)) {
      return { valid: false, discount: 0, error: MESSAGES.PER_CUSTOMER_LIMIT };
    }

    if (bill < (Number(c.min_spend) || 0)) {
      return { valid: false, discount: 0, error: MESSAGES.MIN_SPEND };
    }

    let discount;
    let capped = false;
    if (c.type === COUPON_TYPE.FIXED) {
      discount = Math.min(Math.abs(Number(c.value) || 0), bill); // never exceed the bill
    } else {
      discount = bill * ((Number(c.value) || 0) / 100);
      const cap = Number(c.max_discount) || 0;
      if (cap > 0 && discount > cap) {
        discount = cap;
        capped = true;
      }
    }
    discount = round2(discount);
    if (discount <= 0) return { valid: false, discount: 0, error: MESSAGES.ZERO_DISCOUNT };
    return { valid: true, discount, capped };
  }

  // ============================ reads / CRUD ============================

  async getByCode(code) {
    const db = await BaseModel.getDb();
    return db.collection('coupons').findOne({ license: BaseModel.license, code: norm(code) });
  }

  async list(branchId, { activeOnly = false } = {}) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (activeOnly) q.active = true;
    // Coupons with no branch are license-wide; branch-scoped ones show for their branch.
    if (branchId)
      q.$or = [
        { branch_id: oid(branchId) },
        { branch_id: null },
        { branch_id: { $exists: false } },
      ];
    const rows = await db.collection('coupons').find(q).sort({ created_date: -1 }).toArray();
    return { status: true, data: rows, message: 'Coupons' };
  }

  async save(id, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const col = db.collection('coupons');
    const now = new Date();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
    const code = norm(data.code);
    if (!code) return { status: false, message: MESSAGES.CODE_REQUIRED };

    // Code is unique per license (case-insensitive, since we store upper-case).
    const clash = await col.findOne({ license: BaseModel.license, code });
    if (clash && String(clash._id) !== String(id || '')) {
      return { status: false, message: MESSAGES.DUPLICATE_CODE };
    }

    const set = {
      code,
      description: String(data.description || '').trim(),
      type: data.type === COUPON_TYPE.FIXED ? COUPON_TYPE.FIXED : COUPON_TYPE.PERCENT,
      value: Math.max(0, num(data.value, 0)),
      min_spend: Math.max(0, num(data.min_spend, 0)),
      max_discount: Math.max(0, num(data.max_discount, 0)),
      start_date: data.start_date ? new Date(data.start_date) : null,
      end_date: data.end_date ? new Date(data.end_date) : null,
      usage_limit: Math.max(0, parseInt(num(data.usage_limit, 0), 10) || 0),
      per_customer_limit: Math.max(0, parseInt(num(data.per_customer_limit, 0), 10) || 0),
      customer_id: data.customer_id ? oid(data.customer_id) : null,
      active: data.active === undefined ? true : data.active === true || data.active === 'true',
      currency: data.currency !== undefined ? String(data.currency) : ctx.currency || '',
      branch_id: data.branch_id ? oid(data.branch_id) : ctx.branchId ? oid(ctx.branchId) : null,
      branch_name: ctx.branchName || data.branch_name || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };
    // A percentage cannot exceed 100.
    if (set.type === COUPON_TYPE.PERCENT) set.value = Math.min(100, set.value);

    if (id) {
      await col.updateOne({ _id: oid(id), license: BaseModel.license }, { $set: set });
      const row = await col.findOne({ _id: oid(id), license: BaseModel.license });
      return { status: true, data: row, message: MESSAGES.SAVED };
    }
    const doc = {
      ...set,
      times_used: 0,
      created_date: now,
      created_by: ctx.userName || '',
    };
    const r = await col.insertOne(doc);
    return { status: true, data: { ...doc, _id: r.insertedId }, message: MESSAGES.SAVED };
  }

  async remove(id) {
    const db = await BaseModel.getDb();
    const r = await db
      .collection('coupons')
      .deleteOne({ _id: oid(id), license: BaseModel.license });
    if (!r.deletedCount) return { status: false, message: MESSAGES.NOT_FOUND };
    return { status: true, data: { deleted: 1 }, message: MESSAGES.DELETED };
  }

  // ====================== validate / apply / reverse ======================

  /**
   * Validate a code against a live bill and customer, returning the coupon and
   * the discount it would give without writing anything. The till calls this.
   */
  async validate(code, { billTotal, customerId, branchId } = {}) {
    const coupon = await this.getByCode(code);
    if (!coupon) return { status: false, valid: false, message: MESSAGES.INVALID_CODE };
    const db = await BaseModel.getDb();
    const redemptions = db.collection('coupon_redemptions');
    const timesUsed = await redemptions.countDocuments({
      coupon_id: coupon._id,
      license: BaseModel.license,
      voided: { $ne: true },
    });
    let customerUses = 0;
    if (customerId && Number(coupon.per_customer_limit) > 0) {
      customerUses = await redemptions.countDocuments({
        coupon_id: coupon._id,
        customer_id: oid(customerId),
        license: BaseModel.license,
        voided: { $ne: true },
      });
    }
    const r = CouponService.computeDiscount(coupon, billTotal, {
      timesUsed,
      customerUses,
      customerId,
    });
    return {
      status: r.valid,
      valid: r.valid,
      data: r.valid
        ? {
            code: coupon.code,
            couponId: coupon._id,
            type: coupon.type,
            discount: r.discount,
            capped: !!r.capped,
            currency: coupon.currency || '',
          }
        : null,
      message: r.valid ? MESSAGES.APPLIED : r.error,
    };
  }

  /**
   * Record a coupon redemption against a committed sale and bump the coupon's
   * usage counter. Idempotent per sale, so a retry cannot count a coupon twice.
   */
  async apply(
    code,
    { saleId, customerId, customerName, billTotal, discount, reference, ctx = {} } = {}
  ) {
    const disc = round2(discount);
    if (!(disc > 0)) return { status: true, data: { discount: 0 }, message: 'Nothing to apply' };
    const db = await BaseModel.getDb();
    const redemptions = db.collection('coupon_redemptions');
    if (saleId) {
      const existing = await redemptions.findOne({
        sale_id: oid(saleId),
        license: BaseModel.license,
        voided: { $ne: true },
      });
      if (existing) {
        return { status: true, data: { discount: 0, duplicate: true }, message: 'Already applied' };
      }
    }
    const coupon = await this.getByCode(code);
    if (!coupon) return { status: false, message: MESSAGES.INVALID_CODE };
    const now = new Date();
    await redemptions.insertOne({
      coupon_id: coupon._id,
      code: coupon.code,
      customer_id: customerId ? oid(customerId) : null,
      customer_name: customerName || '',
      sale_id: saleId ? oid(saleId) : null,
      reference: reference || '',
      discount: disc,
      bill_total: round2(billTotal || 0),
      currency: coupon.currency || ctx.currency || '',
      voided: false,
      branch_id: ctx.branchId ? oid(ctx.branchId) : coupon.branch_id || null,
      date: now,
      created_date: now,
      changed_by: ctx.userName || '',
      changed_by_id: ctx.userId ? oid(ctx.userId) : null,
      license: BaseModel.license,
    });
    await db
      .collection('coupons')
      .updateOne({ _id: coupon._id }, { $inc: { times_used: 1 }, $set: { updated_date: now } });
    return { status: true, data: { discount: disc, code: coupon.code }, message: MESSAGES.APPLIED };
  }

  /** Void a sale's coupon redemptions and free the uses back up (on cancel/return). */
  async reverse(saleId) {
    const db = await BaseModel.getDb();
    const redemptions = db.collection('coupon_redemptions');
    const rows = await redemptions
      .find({ sale_id: oid(saleId), license: BaseModel.license, voided: { $ne: true } })
      .toArray();
    if (!rows.length) return { status: true, data: { reversed: 0 }, message: 'Nothing to reverse' };
    const now = new Date();
    let reversed = 0;
    for (const row of rows) {
      await redemptions.updateOne({ _id: row._id }, { $set: { voided: true, voided_date: now } });
      if (row.coupon_id) {
        await db
          .collection('coupons')
          .updateOne({ _id: row.coupon_id }, { $inc: { times_used: -1 } });
      }
      reversed += 1;
    }
    return { status: true, data: { reversed }, message: 'Coupon redemptions reversed' };
  }
}

module.exports = CouponService;
