'use strict';

const BaseController = require('./base.controller');
const LoyaltyService = require('../services/loyalty.service');
const BaseModel = require('../models/base.model');

class LoyaltyController extends BaseController {
  constructor() {
    super();
    this.service = new LoyaltyService();
  }

  // Minimal per-request context. license is already on BaseModel (tenant
  // middleware); branch/user/currency come off the request. Currency is
  // display-only - the maths never touches it.
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

  /** GET /loyalty/config - the branch's loyalty rules (or defaults). */
  async getConfig(req, res) {
    try {
      const ctx = this._ctx(req);
      const cfg = await this.service.getConfig(ctx.branchId);
      return this.success(res, cfg, 'Loyalty settings');
    } catch (e) {
      console.error('Error in loyalty.getConfig:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /loyalty/config - save the branch's loyalty rules. */
  async saveConfig(req, res) {
    try {
      if (req.user?.access?.customer?.write === false) {
        return this.error(res, 'Unauthorized', 403);
      }
      const ctx = this._ctx(req);
      const cfg = await this.service.saveConfig(ctx.branchId, req.body || {}, ctx);
      return this.success(res, cfg, 'Loyalty settings saved');
    } catch (e) {
      console.error('Error in loyalty.saveConfig:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /loyalty/customer/:id - balance, tier, progress + ledger. */
  async summary(req, res) {
    try {
      const ctx = this._ctx(req);
      const r = await this.service.summary(req.params.id, ctx.branchId, { limit: req.query.limit });
      if (r.status) return this.success(res, r.data, r.message);
      return this.error(res, r.message, 404);
    } catch (e) {
      console.error('Error in loyalty.summary:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /loyalty/report/liability - outstanding points and what they are worth. */
  async liability(req, res) {
    try {
      if (req.user?.access?.customer?.read === false) {
        return this.error(res, 'Unauthorized', 403);
      }
      const ctx = this._ctx(req);
      const r = await this.service.liability(ctx.branchId);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in loyalty.liability:', e);
      return this.error(res, e.message, 500);
    }
  }

  /**
   * POST /loyalty/preview - dry-run for the till. Given a bill and a customer's
   * points, return what they'd earn and/or what a redemption is worth, WITHOUT
   * writing anything. The till calls this as the cashier types.
   */
  async preview(req, res) {
    try {
      if (req.user?.access?.customer?.read === false) {
        return this.error(res, 'Unauthorized', 403);
      }
      const ctx = this._ctx(req);
      const cfg = await this.service.getConfig(ctx.branchId);
      const { amount, redeemPoints, billTotal, availablePoints, lifetimePoints } = req.body || {};

      const earn = LoyaltyService.computeEarn(
        Number(amount) || 0,
        cfg,
        Number(lifetimePoints) || 0
      );
      let redeem = null;
      if (redeemPoints !== undefined && redeemPoints !== null && redeemPoints !== '') {
        redeem = LoyaltyService.computeRedeem(redeemPoints, billTotal, availablePoints, cfg);
      }
      return this.success(
        res,
        {
          earn: { points: earn.points, tier: earn.tier && earn.tier.name },
          redeem,
          currency: cfg.currency || ctx.currency || '',
          enabled: !!cfg.enabled,
        },
        'Loyalty preview'
      );
    } catch (e) {
      console.error('Error in loyalty.preview:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new LoyaltyController();
