// src/services/role.service.js
// Thin service layer for the Role (permission-group) module. Delegates to
// RoleRepository so controllers do not touch the DB layer directly. Accepts an
// injected model so controller-set tenant context (licenseId) is reused.

const RoleModel = require('../models/role.model');
const RoleRepository = require('../repositories/role.repository');

class RoleService {
  constructor(model) {
    const roleModel = model || new RoleModel();
    this.model = roleModel;
    this.repository = new RoleRepository(roleModel);
  }

  listRoles() {
    return this.repository.listRoles();
  }

  getRoleById(id) {
    return this.repository.getRoleById(id);
  }

  getRoleByKey(key) {
    return this.repository.getRoleByKey(key);
  }

  createRole(data) {
    return this.repository.createRole(data);
  }

  updateRole(id, data) {
    return this.repository.updateRole(id, data);
  }

  deleteRole(id) {
    return this.repository.deleteRole(id);
  }

  seedDefaultRoles() {
    return this.repository.seedDefaultRoles();
  }
}

module.exports = RoleService;
