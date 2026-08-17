// src/repositories/role.repository.js
//
// Data layer for reusable roles (Phase 1). All queries are tenant-scoped by
// license. System roles (is_system) are seeded from DEFAULT_ROLES and may be
// edited but not deleted; custom roles are freely managed.

const BaseModel = require('../models/base.model');
const { DEFAULT_ROLES } = require('../constants/roles.constants');
const { mergeAccess } = require('../utils/access-resolver');

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
        requires_manager_approval: Array.isArray(data.requires_manager_approval)
          ? data.requires_manager_approval
          : [],
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
      if (data.requires_manager_approval !== undefined) {
        set.requires_manager_approval = data.requires_manager_approval;
      }
      // Note: key + is_system are intentionally never updatable here.
      const result = await collection.updateOne(
        { _id: this.model.toObjectId(id), license: this._license() },
        { $set: set }
      );
      if (result.matchedCount > 0) {
        await this.recomputeUsersForRole(id);
      }
      return {
        status: result.matchedCount > 0,
        data: null,
        message: result.matchedCount > 0 ? 'Role updated' : 'Role not found',
      };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Re-resolve the stored access of every user assigned to this role, so a role
   * edit takes effect immediately - not only the next time each user is saved.
   * The role-derived parts are recomputed (module matrix merged with the user's
   * own overrides, POS matrix, manager-approval list); the user's `plan` access
   * is preserved as-is, since it is an entitlement, not a role grant. Failures
   * are reported but never fail the role update itself.
   */
  async recomputeUsersForRole(roleId) {
    try {
      const collection = await this.model.getCollection('roles');
      const role = await collection.findOne({
        _id: this.model.toObjectId(roleId),
        license: this._license(),
      });
      if (!role) return;
      const users = await this.model.getCollection('users');
      const assigned = await users
        .find(
          { role_id: this.model.toObjectId(roleId), license: this._license() },
          { projection: { access: 1, access_overrides: 1 } }
        )
        .toArray();
      for (const u of assigned) {
        const access = mergeAccess(role.access || {}, u.access_overrides || {});
        access.plan = (u.access && u.access.plan) || { read: false };
        access.pos = role.pos && typeof role.pos === 'object' ? role.pos : {};
        access.pos_manager_approval = Array.isArray(role.requires_manager_approval)
          ? role.requires_manager_approval
          : [];
        await users.updateOne({ _id: u._id }, { $set: { access, updated_date: new Date() } });
      }
    } catch (error) {
      console.error('recomputeUsersForRole failed:', error.message);
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
      // A role still assigned to users cannot be deleted - the users' resolved
      // access would keep working but their role would silently dangle.
      const users = await this.model.getCollection('users');
      const assignedCount = await users.countDocuments({
        role_id: this.model.toObjectId(id),
        license: this._license(),
      });
      if (assignedCount > 0) {
        return {
          status: false,
          data: { assigned: assignedCount },
          message: `Role is assigned to ${assignedCount} user(s). Reassign them first.`,
        };
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
        pos: d.pos || {},
        requires_manager_approval: d.requires_manager_approval || [],
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
