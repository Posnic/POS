'use strict';

const BaseController = require('./base.controller');
const CampaignService = require('../services/campaign.service');
const BaseModel = require('../models/base.model');
const acl = require('../utils/messaging-access');

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
      messagingAccess: acl.matrix(u),
      currency: t.currency || u.currency_type || '',
    };
  }

  _canWrite(req) {
    return acl.allowed(req.user, 'send_bulk');
  }

  async _campaign(req, res, sending = false) {
    const result = await this.service.get(req.params.id);
    const row = result.data;
    if (!result.status || !row || String(row.branch_id) !== String(this._ctx(req).branchId)) {
      this.error(res, 'Campaign not found', 404);
      return null;
    }
    if (
      !acl.allowed(req.user, sending ? 'send_bulk' : 'view_history') ||
      (sending && !acl.allowed(req.user, acl.channelAction(row.channel)))
    ) {
      this.error(res, 'Messaging permission required.', 403);
      return null;
    }
    return row;
  }

  /** GET /campaigns - list. */
  async audienceOptions(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
      const q = req.query || {};
      const r = await this.service.audienceOptions(
        q.kind,
        q.search,
        q.ids,
        this._ctx(req).branchId
      );
      if (!r.status) return this.error(res, r.message, 400);
      return this.success(res, r.data, r.message);
    } catch (e) {
      return this.error(res, e.message, 500);
    }
  }

  async list(req, res) {
    try {
      if (!acl.allowed(req.user, 'view_history'))
        return this.error(res, 'Messaging permission required.', 403);
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
      if (!(await this._campaign(req, res, false))) return;
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
      if (
        !this._canWrite(req) ||
        !acl.allowed(req.user, acl.channelAction(req.body?.channel || 'whatsapp'))
      )
        return this.error(res, 'Messaging permission required.', 403);
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
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
      if (!(await this._campaign(req, res, true))) return;
      if (req.body?.channel && !acl.channelAction(req.body.channel))
        return this.error(res, 'Choose a valid channel', 400);
      if (req.body?.channel && !acl.allowed(req.user, acl.channelAction(req.body.channel)))
        return this.error(res, 'Messaging permission required.', 403);
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
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
      if (!(await this._campaign(req, res, true))) return;
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
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
      if (
        !this._canWrite(req) ||
        !acl.allowed(req.user, acl.channelAction(req.body?.channel || 'whatsapp'))
      )
        return this.error(res, 'Messaging permission required.', 403);
      const { segment, channel } = req.body || {};
      const r = await this.service.preview(segment || {}, channel, this._ctx(req).branchId);
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
      if (!(await this._campaign(req, res, true))) return;
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      if (!dryRun && !this._canWrite(req))
        return this.error(res, 'Messaging permission required.', 403);
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
      if (!(await this._campaign(req, res, true))) return;
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
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
      if (!this._canWrite(req)) return this.error(res, 'Messaging permission required.', 403);
      const r = await this.service.runDue({ ctx: this._ctx(req) });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in campaign.runDue:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CampaignController();
