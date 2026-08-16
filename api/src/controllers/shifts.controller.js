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
}

module.exports = new ShiftsController();
