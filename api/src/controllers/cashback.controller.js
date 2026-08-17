'use strict';

const BaseController = require('./base.controller');
const CashbackService = require('../services/cashback.service');
const BaseModel = require('../models/base.model');

class CashbackController extends BaseController {
  constructor() {
    super();
    this.service = new CashbackService();
  }

  _ctx(req) {
    const u = req.user || {};
    const t = req.tenantContext || {};
    return {
      branchId: t.branchId || u.branch_id || u.branchId || BaseModel.currentBranch || null,
      branchName: t.branchName || u.branch_name || BaseModel.currentBranchName || '',
      userName: u.name || u.username || u.email || '',
      currency: t.currency || u.currency_type || '',
    };
  }

  _canWrite(req) {
    return req.user?.access?.branch?.write !== false;
  }

  /** GET /cashback/settings - this branch's cashback rule. */
  async getSettings(req, res) {
    try {
      const ctx = this._ctx(req);
      const data = await this.service.getSettings(ctx.branchId);
      return this.success(res, data, 'Cashback settings');
    } catch (e) {
      console.error('Error in cashback.getSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /cashback/settings - save the cashback rule. */
  async saveSettings(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const data = await this.service.saveSettings(ctx.branchId, req.body || {}, ctx);
      return this.success(res, data, 'Cashback settings saved');
    } catch (e) {
      console.error('Error in cashback.saveSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /cashback/recent - recently issued cashback coupons (for printing). */
  async recent(req, res) {
    try {
      const ctx = this._ctx(req);
      const r = await this.service.recent(ctx.branchId, { limit: req.query.limit });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in cashback.recent:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CashbackController();
