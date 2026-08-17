'use strict';

const BaseController = require('./base.controller');
const CouponService = require('../services/coupon.service');
const BaseModel = require('../models/base.model');

class CouponController extends BaseController {
  constructor() {
    super();
    this.service = new CouponService();
  }

  // Same minimal per-request context loyalty uses: branch, user and the branch
  // currency (a display label only - coupon maths never touches it).
  _ctx(req) {
    const u = req.user || {};
    const t = req.tenantContext || {};
    return {
      branchId: t.branchId || u.branch_id || u.branchId || BaseModel.currentBranch || null,
      branchName: t.branchName || u.branch_name || BaseModel.currentBranchName || '',
      userName: u.name || u.username || u.email || '',
      userId: u._id || u.id || null,
      currency: t.currency || u.currency_type || '',
    };
  }

  _canWrite(req) {
    return req.user?.access?.branch?.write !== false;
  }

  /** GET /coupons - list this branch's coupons (and any license-wide ones). */
  async list(req, res) {
    try {
      const ctx = this._ctx(req);
      const activeOnly = String(req.query.active || '') === 'true';
      const r = await this.service.list(ctx.branchId, { activeOnly });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in coupon.list:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /coupons - create a coupon. */
  async create(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const r = await this.service.save('', req.body || {}, ctx);
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in coupon.create:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /coupons/:id - update a coupon. */
  async update(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const r = await this.service.save(req.params.id, req.body || {}, ctx);
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in coupon.update:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** DELETE /coupons/:id - remove a coupon. */
  async remove(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.remove(req.params.id);
      if (!r.status) return this.error(res, r.message, 404);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in coupon.remove:', e);
      return this.error(res, e.message, 500);
    }
  }

  /**
   * POST /coupons/validate - the till checks a code against the live bill and
   * customer and gets back the discount, without redeeming anything.
   */
  async validate(req, res) {
    try {
      const ctx = this._ctx(req);
      const { code, billTotal, customerId } = req.body || {};
      const r = await this.service.validate(code, {
        billTotal,
        customerId,
        branchId: ctx.branchId,
      });
      // A failed validation is a normal answer (bad/expired code), not a 500.
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in coupon.validate:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CouponController();
