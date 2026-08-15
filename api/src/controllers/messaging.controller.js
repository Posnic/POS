'use strict';

const BaseController = require('./base.controller');
const MessagingService = require('../services/messaging.service');
const BaseModel = require('../models/base.model');

class MessagingController extends BaseController {
  constructor() {
    super();
    this.service = new MessagingService();
  }

  _ctx(req) {
    const u = req.user || {};
    const t = req.tenantContext || {};
    return {
      branchId: t.branchId || u.branch_id || u.branchId || BaseModel.currentBranch || null,
      branchName: t.branchName || u.branch_name || BaseModel.currentBranchName || '',
      userName: u.name || u.username || u.email || '',
    };
  }

  // These settings hold the shop's SMS provider secrets, so only a super admin
  // may see or change them - not a branch manager or cashier.
  _isSuperAdmin(req) {
    const u = req.user || {};
    return u.usertype === 'super_admin' || u.role === 'super_admin';
  }

  _denied(res) {
    return this.error(res, 'Only a super admin can manage messaging settings', 403);
  }

  /** GET /messaging/providers - the provider dropdown (metadata, no secrets). */
  async providers(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      return this.success(res, this.service.providers(), 'SMS providers');
    } catch (e) {
      console.error('Error in messaging.providers:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /messaging/settings - the branch's messaging config (secrets blanked). */
  async getSettings(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      const ctx = this._ctx(req);
      const data = await this.service.getSettings(ctx.branchId);
      return this.success(res, data, 'Messaging settings');
    } catch (e) {
      console.error('Error in messaging.getSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /messaging/settings - save the branch's messaging config. */
  async saveSettings(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      const ctx = this._ctx(req);
      const data = await this.service.saveSettings(ctx.branchId, req.body || {}, ctx);
      return this.success(res, data, 'Messaging settings saved');
    } catch (e) {
      console.error('Error in messaging.saveSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /messaging/test - send one real test SMS to confirm the credentials. */
  async test(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      const ctx = this._ctx(req);
      const r = await this.service.testSms(ctx.branchId, (req.body || {}).phone, ctx);
      if (!r.status) return this.error(res, r.message, 400, r.data);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in messaging.test:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new MessagingController();
