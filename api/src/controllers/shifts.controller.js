// src/controllers/shifts.controller.js
//
// HTTP layer for staff shifts (Phase 4). Any authenticated user may clock
// themselves in/out and see their current shift. Listing shifts (other people's
// attendance) needs the `user` read permission, like other staff data.

const BaseController = require('./base.controller');
const ShiftModel = require('../models/shift.model');
const BaseModel = require('../models/base.model');
const ShiftService = require('../services/shift.service');
const { getRequestDeviceId } = require('../utils/device-id.util');

class ShiftsController extends BaseController {
  constructor() {
    super();
    this.shiftModel = new ShiftModel();
    this.service = new ShiftService(this.shiftModel);
  }

  setRequestContext(req) {
    const user = req.user || {};
    this.shiftModel.licenseId =
      req.tenantContext?.licenseId || user.license || user.license_id || BaseModel.license || this.shiftModel.licenseId;
    this.shiftModel.branchId =
      req.tenantContext?.branchId || user.branch_id || BaseModel.currentBranch || this.shiftModel.branchId;
    this.shiftModel.user = user;
  }

  async current(req, res) {
    try {
      this.setRequestContext(req);
      const result = await this.service.getCurrentShift();
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async clockIn(req, res) {
    try {
      this.setRequestContext(req);
      const result = await this.service.clockIn({
        register_id: req.body.register_id,
        note: req.body.note,
        device_id: getRequestDeviceId(req),
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 400, result.data);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async clockOut(req, res) {
    try {
      this.setRequestContext(req);
      const result = await this.service.clockOut({
        note: req.body.note,
        device_id: getRequestDeviceId(req),
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Swipe-to-clock at a shared terminal: the card identifies the person, and
  // their shift toggles (in <-> out). The terminal must be authenticated, but
  // the action applies to the cardholder.
  async clockByCard(req, res) {
    try {
      this.setRequestContext(req);
      const result = await this.service.clockByCard({
        card_uid: req.body.card_uid || req.body.rfid_uid,
        register_id: req.body.register_id,
        device_id: getRequestDeviceId(req),
        license: (req.user && req.user.license) || undefined,
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async list(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'You do not have permission to view shifts', 403);
      }
      const result = await this.service.listShifts({
        user_id: req.query.user_id,
        status: req.query.status,
        limit: req.query.limit,
      });
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Labour / payout report over a date range (defaults to the last 30 days).
  async report(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'You do not have permission to view the labour report', 403);
      }
      const parseDate = (v) => {
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const to = parseDate(req.query.to) || new Date();
      const from = parseDate(req.query.from) || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await this.service.getReport({ from, to, user_id: req.query.user_id });
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Set a user's hourly wage (managing wages ~ managing staff).
  async setRate(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to set a wage', 403);
      }
      const result = await this.service.setRate({
        userId: req.body.user_id || req.body.userId,
        hourlyRate: req.body.hourly_rate,
        license: req.user && req.user.license,
      });
      if (result.status) return this.success(res, null, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new ShiftsController();
