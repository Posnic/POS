// src/controllers/roles.controller.js
//
// HTTP layer for reusable roles (Phase 1). Gated by the `user` permission
// (managing roles ≈ managing staff); super_admin/admin/manager bypass as usual.
// GET /roles lazily seeds the 8 default roles the first time a tenant looks.

const BaseController = require('./base.controller');
const RoleModel = require('../models/role.model');
const BaseModel = require('../models/base.model');
const RoleService = require('../services/role.service');

class RolesController extends BaseController {
  constructor() {
    super();
    this.roleModel = new RoleModel();
    this.service = new RoleService(this.roleModel);
  }

  setRequestContext(req) {
    const user = req.user || {};
    this.roleModel.licenseId =
      req.tenantContext?.licenseId ||
      user.license ||
      user.license_id ||
      BaseModel.license ||
      this.roleModel.licenseId;
    this.roleModel.branchId =
      req.tenantContext?.branchId || user.branch_id || this.roleModel.branchId;
    this.roleModel.user = user;
  }

  async list(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'You do not have permission to view roles', 403);
      }
      let result = await this.service.listRoles();
      // Lazily seed the default roles the first time a tenant has none.
      if (result.status && Array.isArray(result.data) && result.data.length === 0) {
        await this.service.seedDefaultRoles();
        result = await this.service.listRoles();
      }
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async getById(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'You do not have permission to view roles', 403);
      }
      const result = await this.service.getRoleById(req.params.id);
      if (result.status) return this.success(res, result.data, 'success');
      return this.error(res, result.message, 404);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async create(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to manage roles', 403);
      }
      const result = await this.service.createRole(req.body || {});
      if (result.status) return this.success(res, result.data, result.message, 201);
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async update(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to manage roles', 403);
      }
      const result = await this.service.updateRole(req.params.id, req.body || {});
      if (result.status) return this.success(res, result.data, result.message);
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async remove(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'delete', req.user)) {
        return this.error(res, 'You do not have permission to delete roles', 403);
      }
      const result = await this.service.deleteRole(req.params.id);
      if (result.status) return this.success(res, null, result.message);
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }

  async seed(req, res) {
    try {
      this.setRequestContext(req);
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'You do not have permission to manage roles', 403);
      }
      const result = await this.service.seedDefaultRoles();
      if (result.status) return this.success(res, result.data, 'Default roles ready');
      return this.error(res, result.message, 400);
    } catch (error) {
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new RolesController();
