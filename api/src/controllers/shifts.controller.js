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

// Parse a query date. A date-only "to" value (YYYY-MM-DD) is made inclusive of
// that whole day, so a report/export "to today" includes today's shifts.
const parseDate = (v, { endOfDay = false } = {}) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
};

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
        tips: req.body.tips,
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
        from: parseDate(req.query.from),
        to: parseDate(req.query.to, { endOfDay: true }),
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
      const to = parseDate(req.query.to, { endOfDay: true }) || new Date();
      const from = parseDate(req.query.from) || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await this.service.getReport({ from, to, user_id: req.query.user_id });
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Manager correction of a shift's times/breaks (timecard).
  async editShift(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to edit shifts', 403);
      }
      const result = await this.service.editShift(req.params.id, {
        clock_in: req.body.clock_in,
        clock_out: req.body.clock_out,
        break_minutes: req.body.break_minutes,
        tips: req.body.tips,
        note: req.body.note,
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Roster: list the planned schedule over a date range (viewing other
  // people's roster ~ viewing staff data).
  async listSchedule(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'You do not have permission to view the roster', 403);
      }
      const result = await this.service.listSchedules({
        from: req.query.from,
        to: req.query.to,
        user_id: req.query.user_id,
      });
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Roster: plan a stretch for a person on a day (managing the roster ~
  // managing staff).
  async addSchedule(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to manage the roster', 403);
      }
      const result = await this.service.addSchedule({
        user_id: req.body.user_id,
        user_name: req.body.user_name,
        date: req.body.date,
        start: req.body.start,
        end: req.body.end,
        note: req.body.note,
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async deleteSchedule(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to manage the roster', 403);
      }
      const result = await this.service.deleteSchedule(req.params.id);
      if (result.status) return this.success(res, null, result.message);
      return this.error(res, result.message, result.statusCode || 400);
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
