// src/controllers/authorizations.controller.js
//
// HTTP layer for manager-approval elevation (Phase 2).
//   POST /authorizations/set-manager-pin  { user_id, pin }  (user-write gated)
//   POST /authorizations/verify-pin        { pin, action, sale_id? }
//
// verify-pin is callable by any authenticated user (the cashier at the till);
// the service decides whether the supplied PIN belongs to a manager allowed to
// authorise the action.

const BaseController = require('./base.controller');
const authorizationService = require('../services/authorization.service');

class AuthorizationsController extends BaseController {
  // Set/clear a user's manager PIN. Managing PINs ~ managing staff.
  async setManagerPin(req, res) {
    try {
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to set a manager PIN', 403);
      }
      const result = await authorizationService.setManagerPin({
        userId: req.body.user_id || req.body.userId,
        pin: req.body.pin,
        license: req.user && req.user.license,
      });
      if (result.status) return this.success(res, null, result.message);
      return this.error(res, result.message, result.statusCode || 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  // Verify a manager PIN authorises a restricted action (records the approval).
  async verifyPin(req, res) {
    try {
      const user = req.user || {};
      const result = await authorizationService.verifyManagerPin({
        pin: req.body.pin,
        action: req.body.action,
        license: user.license,
        actor: { id: user._id, name: user.username || user.name || user.email },
        entityId: req.body.sale_id || req.body.entity_id || null,
      });
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, result.statusCode || 403);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new AuthorizationsController();
