'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const {
  LEDGER_TYPE,
  ROUNDING,
  DEFAULT_CONFIG,
  MESSAGES,
} = require('../constants/loyalty.constants');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/*
 * The loyalty engine.
 *
 * The maths is static and pure - it takes an amount, a config and a points
 * total and returns points or a discount, with no database and no currency of
 * its own. That is where the correctness lives, so it is unit-tested in
 * isolation. The instance methods wrap it with the ledger and the customer
 * wallet, keeping the ledger the source of truth.
 */
class LoyaltyService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  // ============================ pure maths ============================

  static _round(n, mode) {
    if (mode === ROUNDING.CEIL) return Math.ceil(n);
    if (mode === ROUNDING.ROUND) return Math.round(n);
    return Math.floor(n); // FLOOR is the default: never over-credit.
  }

  /** The tier a lifetime-points total sits in, per the branch's tier ladder. */
  static tierFor(lifetimePoints, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const tiers = Array.isArray(cfg.tiers) && cfg.tiers.length ? cfg.tiers : DEFAULT_CONFIG.tiers;
    const sorted = [...tiers].sort(
      (a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0)
    );
    let current = sorted[0];
    for (const t of sorted) {
      if ((Number(lifetimePoints) || 0) >= (Number(t.threshold) || 0)) current = t;
      else break;
    }
    return current || DEFAULT_CONFIG.tiers[0];
  }

  /**
   * Points earned by spending `amount` (already in the branch's currency).
   * Honours min-spend, the earn ratio, the current tier multiplier and rounding.
   */
  static computeEarn(amount, config = {}, lifetimePoints = 0) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const tier = LoyaltyService.tierFor(lifetimePoints, cfg);
    if (!cfg.enabled) return { points: 0, tier };
    const spend = Number(amount) || 0;
    if (spend < (Number(cfg.min_spend) || 0)) return { points: 0, tier };
    const per = Number(cfg.earn_amount) || 0;
    const pts = Number(cfg.earn_points) || 0;
    if (per <= 0 || pts <= 0) return { points: 0, tier };
    const multiplier = Number(tier && tier.multiplier) || 1;
    const raw = (spend / per) * pts * multiplier;
    return { points: Math.max(0, LoyaltyService._round(raw, cfg.earn_rounding)), tier };
  }

  /**
   * Validate and size a redemption. Returns the points actually spent and the
   * currency discount they buy, capping the discount at max_redeem_percent of
   * the bill and refunding the points that would not have fit.
   */
  static computeRedeem(pointsRequested, billTotal, availablePoints, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (!cfg.enabled) return { valid: false, points: 0, value: 0, error: MESSAGES.NOT_ENABLED };

    const want = Math.floor(Number(pointsRequested) || 0);
    const have = Math.floor(Number(availablePoints) || 0);
    if (want <= 0) return { valid: false, points: 0, value: 0, error: MESSAGES.INVALID_POINTS };
    if (want > have)
      return { valid: false, points: 0, value: 0, error: MESSAGES.INSUFFICIENT_POINTS };
    if (want < (Number(cfg.min_redeem) || 0)) {
      return { valid: false, points: 0, value: 0, error: MESSAGES.BELOW_MIN_REDEEM };
    }

    const rPts = Number(cfg.redeem_points) || 1;
    const rVal = Number(cfg.redeem_value) || 0;
    const perPoint = rPts > 0 ? rVal / rPts : 0; // currency each point is worth
    let points = want;
    let value = points * perPoint;

    const bill = Number(billTotal) || 0;
    const maxPct = Number(cfg.max_redeem_percent);
    if (bill > 0 && Number.isFinite(maxPct) && maxPct < 100) {
      const cap = bill * (maxPct / 100);
      if (value > cap) {
        points = perPoint > 0 ? Math.floor(cap / perPoint) : points;
        value = points * perPoint;
        return {
          valid: points > 0,
          points,
          value: round2(value),
          capped: true,
          error: points > 0 ? null : MESSAGES.BELOW_MIN_REDEEM,
        };
      }
    }
    return { valid: true, points, value: round2(value), capped: false, error: null };
  }

  // ============================ config ============================

  async getConfig(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const row = await db.collection('loyalty_config').findOne(q);
    return {
      ...DEFAULT_CONFIG,
      ...(row || {}),
      branch_id: branchId ? oid(branchId) : row && row.branch_id,
    };
  }

  async saveConfig(branchId, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const now = new Date();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
    const set = {
      enabled: data.enabled === true || data.enabled === 'true',
      earn_points: num(data.earn_points, DEFAULT_CONFIG.earn_points),
      earn_amount: num(data.earn_amount, DEFAULT_CONFIG.earn_amount),
      min_spend: num(data.min_spend, DEFAULT_CONFIG.min_spend),
      earn_rounding: Object.values(ROUNDING).includes(data.earn_rounding)
        ? data.earn_rounding
        : DEFAULT_CONFIG.earn_rounding,
      redeem_points: num(data.redeem_points, DEFAULT_CONFIG.redeem_points),
      redeem_value: num(data.redeem_value, DEFAULT_CONFIG.redeem_value),
      min_redeem: num(data.min_redeem, DEFAULT_CONFIG.min_redeem),
      max_redeem_percent: Math.min(
        100,
        Math.max(0, num(data.max_redeem_percent, DEFAULT_CONFIG.max_redeem_percent))
      ),
      expiry_months: Math.max(0, num(data.expiry_months, DEFAULT_CONFIG.expiry_months)),
      referral_enabled: data.referral_enabled === true || data.referral_enabled === 'true',
      referral_referrer_points: Math.max(
        0,
        num(data.referral_referrer_points, DEFAULT_CONFIG.referral_referrer_points)
      ),
      referral_referee_points: Math.max(
        0,
        num(data.referral_referee_points, DEFAULT_CONFIG.referral_referee_points)
      ),
      referral_min_spend: Math.max(
        0,
        num(data.referral_min_spend, DEFAULT_CONFIG.referral_min_spend)
      ),
      tiers:
        Array.isArray(data.tiers) && data.tiers.length
          ? data.tiers.map((t) => ({
              name: String(t.name || '').trim() || 'Tier',
              threshold: Math.max(0, Number(t.threshold) || 0),
              multiplier: Number(t.multiplier) > 0 ? Number(t.multiplier) : 1,
            }))
          : DEFAULT_CONFIG.tiers,
      currency: data.currency !== undefined ? String(data.currency) : ctx.currency || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      branch_id: oid(branchId),
      branch_name: ctx.branchName || '',
      license: BaseModel.license,
    };
    await db
      .collection('loyalty_config')
      .updateOne(
        { license: BaseModel.license, branch_id: oid(branchId) },
        { $set: set, $setOnInsert: { created_date: now, created_by: ctx.userName || '' } },
        { upsert: true }
      );
    return this.getConfig(branchId);
  }

  // ==================== earn / redeem / reverse ====================

  async _entry(db, e) {
    const now = new Date();
    await db.collection('loyalty_ledger').insertOne({
      customer_id: oid(e.customerId),
      customer_name: e.customerName || '',
      branch_id: e.branchId ? oid(e.branchId) : null,
      type: e.type,
      points: e.points,
      balance_after: e.balanceAfter,
      value: round2(e.value || 0),
      currency: e.currency || '',
      sale_id: e.saleId ? oid(e.saleId) : null,
      reference: e.reference || '',
      reason: e.reason || '',
      tier_at: e.tierAt || '',
      date: now,
      created_date: now,
      changed_by: (e.ctx && e.ctx.userName) || '',
      changed_by_id: e.ctx && e.ctx.userId ? oid(e.ctx.userId) : null,
      license: BaseModel.license,
    });
  }

  /**
   * Award points for a completed sale. Idempotent per sale: a retry, or an Edit
   * that re-runs the earn hook, must never credit the same sale twice, so we
   * refuse if an EARN row already exists for this sale.
   */
  async earn(customerId, { amount, saleId, reference, config, ctx = {} } = {}) {
    const db = await BaseModel.getDb();
    if (saleId) {
      const existing = await db.collection('loyalty_ledger').findOne({
        sale_id: oid(saleId),
        type: LEDGER_TYPE.EARN,
        license: BaseModel.license,
      });
      if (existing) {
        return { status: true, data: { points: 0, duplicate: true }, message: 'Already earned' };
      }
    }
    const custCol = db.collection('customers');
    const cust = await custCol.findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const cfg = config || (await this.getConfig(ctx.branchId || cust.branch_id));
    const lifetime = Number(cust.loyalty && cust.loyalty.pointsEarned) || 0;
    const { points } = LoyaltyService.computeEarn(amount, cfg, lifetime);
    if (points <= 0) return { status: true, data: { points: 0 }, message: 'No points earned' };

    const balanceAfter = (Number(cust.loyalty && cust.loyalty.points) || 0) + points;
    const newTier = LoyaltyService.tierFor(lifetime + points, cfg).name;
    await this._entry(db, {
      customerId,
      customerName: cust.name,
      branchId: ctx.branchId || cust.branch_id,
      type: LEDGER_TYPE.EARN,
      points,
      balanceAfter,
      value: amount,
      currency: cfg.currency || ctx.currency || '',
      saleId,
      reference,
      reason: 'Sale',
      tierAt: newTier,
      ctx,
    });
    await custCol.updateOne(
      { _id: oid(customerId) },
      {
        $inc: { 'loyalty.points': points, 'loyalty.pointsEarned': points },
        $set: { 'loyalty.tier': newTier, 'loyalty.lastUpdated': new Date() },
      }
    );
    return {
      status: true,
      data: { points, balance: balanceAfter, tier: newTier },
      message: MESSAGES.POINTS_EARNED,
    };
  }

  /**
   * Book a fixed points grant (a referral bonus) to one customer, moving the
   * ledger and the wallet together, and progressing the tier. Referral points
   * count towards lifetime, so they help a customer climb tiers.
   */
  async _grantAdjust(db, cust, points, reason, cfg, saleId, ctx) {
    const lifetime = Number(cust.loyalty && cust.loyalty.pointsEarned) || 0;
    const balanceAfter = (Number(cust.loyalty && cust.loyalty.points) || 0) + points;
    const newTier = LoyaltyService.tierFor(lifetime + points, cfg).name;
    await this._entry(db, {
      customerId: cust._id,
      customerName: cust.name,
      branchId: ctx.branchId || cust.branch_id,
      type: LEDGER_TYPE.ADJUST,
      points,
      balanceAfter,
      value: 0,
      currency: cfg.currency || ctx.currency || '',
      saleId,
      reason,
      tierAt: newTier,
      ctx,
    });
    await db.collection('customers').updateOne(
      { _id: cust._id },
      {
        $inc: { 'loyalty.points': points, 'loyalty.pointsEarned': points },
        $set: { 'loyalty.tier': newTier, 'loyalty.lastUpdated': new Date() },
      }
    );
  }

  /**
   * When a referred customer makes their first qualifying purchase, reward both
   * them and the customer who referred them. Once-only per referee (guarded by a
   * flag on the referee, set before granting so a concurrent sale cannot
   * double-reward). Referral bonuses are ADJUST rows, so cancelling the sale does
   * not claw them back - onboarding rewards are not returned.
   */
  async grantReferralIfEligible(refereeId, { amount, saleId, config, ctx = {} } = {}) {
    const db = await BaseModel.getDb();
    const custCol = db.collection('customers');
    const referee = await custCol.findOne({ _id: oid(refereeId), license: BaseModel.license });
    if (!referee) return { status: false, message: 'Customer not found' };
    if (!referee.referrer_id) return { status: true, data: { granted: 0 }, message: 'No referrer' };
    if (referee.loyalty && referee.loyalty.referral_rewarded) {
      return { status: true, data: { granted: 0, duplicate: true }, message: 'Already rewarded' };
    }
    const cfg = config || (await this.getConfig(ctx.branchId || referee.branch_id));
    if (!cfg.referral_enabled)
      return { status: true, data: { granted: 0 }, message: 'Referrals off' };
    if ((Number(amount) || 0) < (Number(cfg.referral_min_spend) || 0)) {
      return { status: true, data: { granted: 0 }, message: 'Below referral minimum spend' };
    }
    const refereePts = Math.max(0, parseInt(cfg.referral_referee_points, 10) || 0);
    const referrerPts = Math.max(0, parseInt(cfg.referral_referrer_points, 10) || 0);
    if (refereePts <= 0 && referrerPts <= 0) {
      return { status: true, data: { granted: 0 }, message: 'No referral points configured' };
    }

    // Claim the reward first so a second concurrent sale finds it already taken.
    await custCol.updateOne(
      { _id: oid(refereeId) },
      { $set: { 'loyalty.referral_rewarded': true } }
    );

    if (refereePts > 0) {
      await this._grantAdjust(db, referee, refereePts, 'Referral: welcome bonus', cfg, saleId, ctx);
    }
    if (referrerPts > 0) {
      const referrer = await custCol.findOne({
        _id: oid(referee.referrer_id),
        license: BaseModel.license,
      });
      if (referrer) {
        await this._grantAdjust(
          db,
          referrer,
          referrerPts,
          'Referral: your friend shopped',
          cfg,
          saleId,
          ctx
        );
      }
    }
    return {
      status: true,
      data: { granted: refereePts + referrerPts, refereePts, referrerPts },
      message: 'Referral rewarded',
    };
  }

  /** Spend points as a discount on a sale. Returns the currency value applied. */
  async redeem(customerId, { points, billTotal, saleId, reference, config, ctx = {} } = {}) {
    const db = await BaseModel.getDb();
    const custCol = db.collection('customers');
    const cust = await custCol.findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const cfg = config || (await this.getConfig(ctx.branchId || cust.branch_id));
    const available = Number(cust.loyalty && cust.loyalty.points) || 0;
    const r = LoyaltyService.computeRedeem(points, billTotal, available, cfg);
    if (!r.valid) return { status: false, message: r.error };

    const balanceAfter = available - r.points;
    await this._entry(db, {
      customerId,
      customerName: cust.name,
      branchId: ctx.branchId || cust.branch_id,
      type: LEDGER_TYPE.REDEEM,
      points: -r.points,
      balanceAfter,
      value: r.value,
      currency: cfg.currency || ctx.currency || '',
      saleId,
      reference,
      reason: 'Redeemed on sale',
      tierAt: (cust.loyalty && cust.loyalty.tier) || '',
      ctx,
    });
    await custCol.updateOne(
      { _id: oid(customerId) },
      {
        $inc: { 'loyalty.points': -r.points, 'loyalty.pointsRedeemed': r.points },
        $set: { 'loyalty.lastUpdated': new Date() },
      }
    );
    return {
      status: true,
      data: { points: r.points, value: r.value, balance: balanceAfter, capped: r.capped },
      message: MESSAGES.POINTS_REDEEMED,
    };
  }

  /**
   * Record a redemption that was already validated and discounted onto a sale
   * at checkout. Unlike redeem(), this does not re-price anything - the points
   * and value were decided when the bill was built, so re-computing here could
   * disagree with the discount the customer already saw. Idempotent per sale, so
   * a retry cannot spend the points twice.
   */
  async applyRedeemPoints(customerId, { points, value, saleId, reference, ctx = {} } = {}) {
    const pts = Math.max(0, parseInt(points, 10) || 0);
    if (pts <= 0) return { status: true, data: { points: 0 }, message: 'Nothing to redeem' };
    const db = await BaseModel.getDb();
    if (saleId) {
      const existing = await db.collection('loyalty_ledger').findOne({
        sale_id: oid(saleId),
        type: LEDGER_TYPE.REDEEM,
        license: BaseModel.license,
      });
      if (existing) {
        return { status: true, data: { points: 0, duplicate: true }, message: 'Already redeemed' };
      }
    }
    const custCol = db.collection('customers');
    const cust = await custCol.findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const cfg = await this.getConfig(ctx.branchId || cust.branch_id);
    const available = Number(cust.loyalty && cust.loyalty.points) || 0;
    const balanceAfter = available - pts;
    await this._entry(db, {
      customerId,
      customerName: cust.name,
      branchId: ctx.branchId || cust.branch_id,
      type: LEDGER_TYPE.REDEEM,
      points: -pts,
      balanceAfter,
      value: Number(value) || 0,
      currency: cfg.currency || ctx.currency || '',
      saleId,
      reference,
      reason: 'Redeemed on sale',
      tierAt: (cust.loyalty && cust.loyalty.tier) || '',
      ctx,
    });
    await custCol.updateOne(
      { _id: oid(customerId) },
      {
        $inc: { 'loyalty.points': -pts, 'loyalty.pointsRedeemed': pts },
        $set: { 'loyalty.lastUpdated': new Date() },
      }
    );
    return {
      status: true,
      data: { points: pts, balance: balanceAfter },
      message: MESSAGES.POINTS_REDEEMED,
    };
  }

  /**
   * Undo the loyalty of a returned or voided sale: put spent points back, take
   * earned points away, as fresh reversing rows. The wallet follows the ledger.
   */
  async reverse(saleId, ctx = {}) {
    const db = await BaseModel.getDb();
    const rows = await db
      .collection('loyalty_ledger')
      .find({
        sale_id: oid(saleId),
        license: BaseModel.license,
        type: { $in: [LEDGER_TYPE.EARN, LEDGER_TYPE.REDEEM] },
      })
      .toArray();
    if (!rows.length) return { status: true, data: { reversed: 0 }, message: 'Nothing to reverse' };

    const custCol = db.collection('customers');
    let reversed = 0;
    for (const row of rows) {
      const cust = await custCol.findOne({ _id: row.customer_id });
      const delta = -Number(row.points || 0); // opposite of what happened
      const balanceAfter = (Number(cust && cust.loyalty && cust.loyalty.points) || 0) + delta;
      await this._entry(db, {
        customerId: row.customer_id,
        customerName: row.customer_name,
        branchId: row.branch_id,
        type: LEDGER_TYPE.REVERSE,
        points: delta,
        balanceAfter,
        value: row.value,
        currency: row.currency,
        saleId,
        reference: row.reference,
        reason: 'Sale returned/voided',
        tierAt: (cust && cust.loyalty && cust.loyalty.tier) || '',
        ctx,
      });
      const inc = { 'loyalty.points': delta };
      if (row.type === LEDGER_TYPE.EARN) inc['loyalty.pointsEarned'] = delta;
      else inc['loyalty.pointsRedeemed'] = delta; // giving back a redemption
      await custCol.updateOne(
        { _id: row.customer_id },
        { $inc: inc, $set: { 'loyalty.lastUpdated': new Date() } }
      );
      reversed += 1;
    }
    return { status: true, data: { reversed }, message: 'Loyalty reversed' };
  }

  /** Balance, tier, progress to next tier, and recent ledger for a customer. */
  async summary(customerId, branchId, { limit = 20 } = {}) {
    const db = await BaseModel.getDb();
    const cust = await db
      .collection('customers')
      .findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const cfg = await this.getConfig(branchId || cust.branch_id);
    const lifetime = Number(cust.loyalty && cust.loyalty.pointsEarned) || 0;
    const balance = Number(cust.loyalty && cust.loyalty.points) || 0;
    const tier = LoyaltyService.tierFor(lifetime, cfg);

    const ladder = [...(cfg.tiers || DEFAULT_CONFIG.tiers)].sort(
      (a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0)
    );
    const next = ladder.find((t) => (Number(t.threshold) || 0) > lifetime) || null;

    const ledger = await db
      .collection('loyalty_ledger')
      .find({ customer_id: oid(customerId), license: BaseModel.license })
      .sort({ date: -1 })
      .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
      .toArray();

    return {
      status: true,
      data: {
        enabled: !!cfg.enabled,
        balance,
        lifetime,
        tier: tier.name,
        multiplier: Number(tier.multiplier) || 1,
        nextTier: next
          ? { name: next.name, needs: Math.max(0, (Number(next.threshold) || 0) - lifetime) }
          : null,
        redeemValuePerPoint: (Number(cfg.redeem_value) || 0) / (Number(cfg.redeem_points) || 1),
        currency: cfg.currency || '',
        ledger,
      },
      message: 'Loyalty summary',
    };
  }

  /*
   * Outstanding loyalty liability.
   *
   * Every unspent point is a promise the shop still owes, so at the till it is a
   * discount waiting to happen and on the books it is a liability. We value it
   * at this branch's own redeem rate - points x (redeem_value / redeem_points) -
   * which keeps the figure in the branch's currency without the maths ever
   * assuming one. Points live on the customer (shared across branches), so the
   * outstanding balance is counted license-wide and only valued with this
   * branch's rate.
   */
  async liability(branchId) {
    const db = await BaseModel.getDb();
    const cfg = await this.getConfig(branchId);
    const per = (Number(cfg.redeem_value) || 0) / (Number(cfg.redeem_points) || 1);
    const rows = await db
      .collection('customers')
      .aggregate([
        { $match: { license: BaseModel.license, 'loyalty.points': { $gt: 0 } } },
        {
          $group: {
            _id: { $ifNull: ['$loyalty.tier', 'Member'] },
            members: { $sum: 1 },
            points: { $sum: { $ifNull: ['$loyalty.points', 0] } },
          },
        },
        { $sort: { points: -1 } },
      ])
      .toArray();

    let totalPoints = 0;
    let members = 0;
    const byTier = rows.map((r) => {
      totalPoints += Number(r.points) || 0;
      members += Number(r.members) || 0;
      return {
        tier: r._id || 'Member',
        members: Number(r.members) || 0,
        points: Number(r.points) || 0,
        value: round2((Number(r.points) || 0) * per),
      };
    });

    return {
      status: true,
      data: {
        enabled: !!cfg.enabled,
        currency: cfg.currency || '',
        members,
        totalPoints,
        valuePerPoint: per,
        totalValue: round2(totalPoints * per),
        byTier,
      },
      message: 'Loyalty liability',
    };
  }
}

module.exports = LoyaltyService;
