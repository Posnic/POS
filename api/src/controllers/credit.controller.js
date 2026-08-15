'use strict';

const BaseController = require('./base.controller');
const CreditService = require('../services/credit.service');
const BaseModel = require('../models/base.model');

class CreditController extends BaseController {
  constructor() {
    super();
    this.service = new CreditService();
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

  /** GET /credit/settings - this branch's credit + reminder rules. */
  async getSettings(req, res) {
    try {
      const ctx = this._ctx(req);
      const data = await this.service.getSettings(ctx.branchId);
      return this.success(res, data, 'Credit settings');
    } catch (e) {
      console.error('Error in credit.getSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /credit/settings - save the credit + reminder rules. */
  async saveSettings(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 401);
      const ctx = this._ctx(req);
      const data = await this.service.saveSettings(ctx.branchId, req.body || {}, ctx);
      return this.success(res, data, 'Credit settings saved');
    } catch (e) {
      console.error('Error in credit.saveSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /credit/outstanding - customers who owe money (khata), most first. */
  async outstanding(req, res) {
    try {
      const ctx = this._ctx(req);
      const minDue = Number(req.query.minDue) || 0;
      const r = await this.service.outstanding(ctx.branchId, { minDue });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.outstanding:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /credit/check-limit?customerId=&amount= - would this credit sale fit? */
  async checkLimit(req, res) {
    try {
      const ctx = this._ctx(req);
      const { customerId, amount } = req.query || {};
      const r = await this.service.checkCreditLimit(customerId, Number(amount) || 0, ctx.branchId);
      return this.success(res, r, 'Credit limit check');
    } catch (e) {
      console.error('Error in credit.checkLimit:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /credit/reminder/:customerId - send one customer their reminder now. */
  async sendReminder(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 401);
      const ctx = this._ctx(req);
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      const r = await this.service.sendReminder(req.params.customerId, {
        branchId: ctx.branchId,
        ctx,
        dryRun,
      });
      if (!r.status) return this.error(res, r.message, 400, r.data);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.sendReminder:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /credit/run-reminders - remind every outstanding customer (cron/manual). */
  async runReminders(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 401);
      const ctx = this._ctx(req);
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      const r = await this.service.runReminders(ctx.branchId, { ctx, dryRun });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.runReminders:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CreditController();
