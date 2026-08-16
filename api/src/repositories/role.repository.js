// src/repositories/role.repository.js
//
// Data layer for reusable roles (Phase 1). All queries are tenant-scoped by
// license. System roles (is_system) are seeded from DEFAULT_ROLES and may be
// edited but not deleted; custom roles are freely managed.

const BaseModel = require('../models/base.model');
const { DEFAULT_ROLES } = require('../constants/roles.constants');

class RoleRepository {
  constructor(model) {
    this.model = model;
  }

  _license() {
    return (
      (this.model && this.model.toObjectId && this.model.toObjectId(this.model.licenseId)) ||
      BaseModel.license ||
      null
    );
  }

  async listRoles() {
    try {
      const collection = await this.model.getCollection('roles');
      const roles = await collection
        .find({ license: this._license() })
        .sort({ is_system: -1, name: 1 })
        .toArray();
      return { status: true, data: roles, message: 'success' };
    } catch (error) {
      return { status: false, data: [], message: error.message };
    }
  }

  async getRoleById(id) {
    try {
      const collection = await this.model.getCollection('roles');
      const role = await collection.findOne({
        _id: this.model.toObjectId(id),
        license: this._license(),
      });
      return { status: !!role, data: role || null, message: role ? 'success' : 'Role not found' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  async getRoleByKey(key) {
    try {
      const collection = await this.model.getCollection('roles');
      const role = await collection.findOne({ key, license: this._license() });
      return { status: !!role, data: role || null, message: role ? 'success' : 'Role not found' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  async createRole(data) {
    try {
      const collection = await this.model.getCollection('roles');
      const now = new Date();
      const doc = {
        license: this._license(),
        name: String(data.name || '').trim(),
        key: String(data.key || '').trim() || null,
        is_system: false,
        description: String(data.description || '').trim(),
        branch_scope: data.branch_scope || 'all',
        access: data.access && typeof data.access === 'object' ? data.access : {},
        pos: data.pos && typeof data.pos === 'object' ? data.pos : {},
        created_date: now,
        updated_date: now,
      };
      const result = await collection.insertOne(doc);
      return { status: true, data: { ...doc, _id: result.insertedId }, message: 'Role created' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  async updateRole(id, data) {
    try {
      const collection = await this.model.getCollection('roles');
      const set = { updated_date: new Date() };
      if (data.name !== undefined) set.name = String(data.name).trim();
      if (data.description !== undefined) set.description = String(data.description).trim();
      if (data.branch_scope !== undefined) set.branch_scope = data.branch_scope;
      if (data.access !== undefined) set.access = data.access;
      if (data.pos !== undefined) set.pos = data.pos;
      // Note: key + is_system are intentionally never updatable here.
      const result = await collection.updateOne(
        { _id: this.model.toObjectId(id), license: this._license() },
        { $set: set }
      );
      return {
        status: result.matchedCount > 0,
        data: null,
        message: result.matchedCount > 0 ? 'Role updated' : 'Role not found',
      };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  async deleteRole(id) {
    try {
      const collection = await this.model.getCollection('roles');
      const filter = { _id: this.model.toObjectId(id), license: this._license() };
      const role = await collection.findOne(filter);
      if (!role) return { status: false, data: null, message: 'Role not found' };
      if (role.is_system) {
        return { status: false, data: null, message: 'System roles cannot be deleted' };
      }
      await collection.deleteOne(filter);
      return { status: true, data: null, message: 'Role deleted' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Idempotently seed the DEFAULT_ROLES for this tenant. Safe to call repeatedly
   * (only inserts the system roles that are missing). Returns how many it added.
   */
  async seedDefaultRoles() {
    try {
      const collection = await this.model.getCollection('roles');
      const license = this._license();
      const existing = await collection
        .find({ license, is_system: true }, { projection: { key: 1 } })
        .toArray();
      const have = new Set(existing.map((r) => r.key));
      const now = new Date();
      const toInsert = DEFAULT_ROLES.filter((d) => !have.has(d.key)).map((d) => ({
        license,
        name: d.name,
        key: d.key,
        is_system: true,
        description: d.description,
        branch_scope: 'all',
        access: d.access,
        pos: {},
        created_date: now,
        updated_date: now,
      }));
      if (toInsert.length > 0) {
        await collection.insertMany(toInsert);
      }
      return { status: true, data: { created: toInsert.length }, message: 'success' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }
}

module.exports = RoleRepository;
