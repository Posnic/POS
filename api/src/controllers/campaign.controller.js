'use strict';

const BaseController = require('./base.controller');
const CampaignService = require('../services/campaign.service');
const BaseModel = require('../models/base.model');

class CampaignController extends BaseController {
  constructor() {
    super();
    this.service = new CampaignService();
  }

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

  /** GET /campaigns - list. */
  async list(req, res) {
    try {
      const ctx = this._ctx(req);
      const r = await this.service.list(ctx.branchId);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.list:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /campaigns/:id */
  async get(req, res) {
    try {
      const r = await this.service.get(req.params.id);
      if (!r.status) return this.error(res, r.message, 404);
      return this.success(res, r.data, 'Campaign');
    } catch (e) {
      console.error('Error in campaign.get:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /campaigns - create. */
  async create(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.save('', req.body || {}, this._ctx(req));
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.create:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /campaigns/:id - update. */
  async update(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.save(req.params.id, req.body || {}, this._ctx(req));
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.update:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** DELETE /campaigns/:id */
  async remove(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.remove(req.params.id);
      if (!r.status) return this.error(res, r.message, 404);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.remove:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /campaigns/preview - audience reach for a segment (no send). */
  async preview(req, res) {
    try {
      const { segment, channel } = req.body || {};
      const r = await this.service.preview(segment || {}, channel);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.preview:', e);
      return this.error(res, e.message, 500);
    }
  }

  /**
   * POST /campaigns/:id/send - send now. A dry run (body.dryRun === true) renders
   * and logs the audience without dispatching anything; a real send requires
   * write access.
   */
  async send(req, res) {
    try {
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      if (!dryRun && !this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.send(req.params.id, { dryRun, ctx: this._ctx(req) });
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.send:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /campaigns/:id/schedule - set a future send time. */
  async schedule(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.schedule(
        req.params.id,
        (req.body || {}).schedule_at,
        this._ctx(req)
      );
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.schedule:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /campaigns/run-due - send any scheduled campaigns now due (cron tick). */
  async runDue(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const r = await this.service.runDue({ ctx: this._ctx(req) });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.runDue:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CampaignController();
