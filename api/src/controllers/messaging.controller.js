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

  _reportContext(req) {
    const ctx = this._ctx(req);
    return {
      branchId: ctx.branchId,
      licenseId: req.tenantContext?.licenseId || req.user?.license || req.user?.license_id,
      userId: req.user?._id,
      source: 'messaging',
    };
  }

  async testEmail(req, res) {
    if (!this._isSuperAdmin(req)) return this._denied(res);
    const to = String(req.body?.to || '').trim();
    if (to.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to))
      return this.error(res, 'Enter one valid test email address.', 400);
    try {
      const { ObjectId } = require('mongodb');
      const db = await BaseModel.getDb();
      const branch = await db.collection('branches').findOne({
        _id: new ObjectId(String(this._ctx(req).branchId)),
        license: { $eq: BaseModel.license },
      });
      if (!branch) return this.error(res, 'Branch not found.', 404);
      const { transporter, from } =
        await require('../utils/email').resolveConfiguredShopTransport(branch);
      if (transporter.options?.jsonTransport) throw new Error('Email sending is not configured.');
      const result = await transporter.sendMail({
        from,
        to,
        subject: 'Posnic email delivery test',
        text: 'This is a test from your Posnic email settings. No payment or action is required.',
      });
      if (
        !result.messageId ||
        result.rejected?.length ||
        !result.accepted?.some((a) => String(a.address || a).toLowerCase() === to.toLowerCase())
      )
        throw new Error('Submission not confirmed.');
      return this.success(
        res,
        { messageId: result.messageId },
        'Accepted by your email service. Check the inbox, spam folder and provider delivery logs.'
      );
    } catch (_) {
      return this.error(
        res,
        'Could not confirm email submission. Check saved credentials, sender verification, allowed server IPs and provider logs before retrying.',
        400
      );
    }
  }

  async emailSettings(req, res) {
    if (!this._isSuperAdmin(req)) return this._denied(res);
    try {
      const { ObjectId } = require('mongodb');
      const db = await BaseModel.getDb();
      const branch = await db.collection('branches').findOne({
        _id: new ObjectId(String(this._ctx(req).branchId)),
        license: { $eq: BaseModel.license },
      });
      if (!branch) return this.error(res, 'Branch not found.', 404);
      const service = require('../services/shop-email');
      const config =
        req.method === 'GET'
          ? service.publicConfig(await service.read(branch))
          : await service.save(branch, req.body || {});
      return this.success(res, config, 'Email settings saved.');
    } catch (error) {
      return this.error(res, error.message, 400);
    }
  }

  async reportSchedules(req, res) {
    if (!this._isSuperAdmin(req)) return this._denied(res);
    try {
      const rows = await require('../services/ask-posnic-schedule.service').list(
        this._reportContext(req)
      );
      return this.success(
        res,
        rows.filter((row) => row.source === 'messaging'),
        'Your report deliveries'
      );
    } catch (error) {
      return this.error(res, error.message, 400);
    }
  }

  async saveReportSchedule(req, res) {
    if (!this._isSuperAdmin(req)) return this._denied(res);
    try {
      const context = this._reportContext(req);
      const schedules = require('../services/ask-posnic-schedule.service');
      const input = req.body || {};
      if (input.id) {
        const row = (await schedules.list(context)).find(
          (row) => String(row._id) === String(input.id) && row.source === 'messaging'
        );
        if (!row) return this.error(res, 'Report delivery not found.', 404);
      }
      if (!['email', 'whatsapp', 'sms'].includes(input.channel))
        return this.error(res, 'Choose Email, WhatsApp or SMS.', 400);
      const moment = require('moment-timezone');
      if (!moment.tz.zone(input.timezone)) return this.error(res, 'Choose a valid time zone.', 400);
      const result = await schedules.save(context, { ...input, enabled: input.enabled === true });
      return this.success(
        res,
        result,
        input.enabled === true ? 'Report delivery enabled.' : 'Report delivery saved, switched off.'
      );
    } catch (error) {
      return this.error(res, error.message, 400);
    }
  }

  async testReport(req, res) {
    if (!this._isSuperAdmin(req)) return this._denied(res);
    try {
      const rows = await require('../services/ask-posnic-schedule.service').list(
        this._reportContext(req)
      );
      const row = rows.find(
        (r) => String(r._id) === String(req.params.id) && r.source === 'messaging'
      );
      if (!row) return this.error(res, 'Report delivery not found.', 404);
      const runner = require('../services/ask-posnic-runner.service');
      const report = await runner.buildReport(row, new Date(), await BaseModel.getDb());
      report.answer = 'POSNIC TEST - report delivery check.\n' + report.answer;
      const result = await runner.deliver({ ...row, test: true }, report);
      return this.success(
        res,
        result,
        'Test accepted by sender. Check the recipient before sending again.'
      );
    } catch (error) {
      return this.error(res, error.message, 400);
    }
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

  /** POST /messaging/test - send one real test message (sms|whatsapp) to confirm. */
  async history(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      return this.success(
        res,
        await this.service.history(this._ctx(req).branchId),
        'Message history'
      );
    } catch (e) {
      return this.error(res, e.message, 500);
    }
  }

  async test(req, res) {
    try {
      if (!this._isSuperAdmin(req)) return this._denied(res);
      const ctx = this._ctx(req);
      const body = req.body || {};
      const r = await this.service.test(ctx.branchId, body.phone, body.channel || 'sms', ctx);
      if (!r.status) return this.error(res, r.message, 400, r.data);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in messaging.test:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new MessagingController();
