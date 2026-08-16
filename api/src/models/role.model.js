// src/models/role.model.js
//
// A reusable permission group (Phase 1). One document per role, per tenant.
// A role's `access` uses the same shape the app already enforces, so assigning a
// role resolves straight into the user's effective `access` (see access-resolver
// util). `pos` is reserved for the Phase 2 granular POS permissions.
//
// Native-driver data-access class extending BaseModel (not Mongoose).

const BaseModel = require('./base.model');

class RoleModel extends BaseModel {
  constructor() {
    super('roles');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      license: { type: 'ObjectId', select: false },
      name: { type: 'String', select: true },
      key: { type: 'String', select: true },
      is_system: { type: 'Boolean', select: true },
      description: { type: 'String', select: true },
      branch_scope: { type: 'Object', select: true }, // 'all' | [branch_id, ...]
      access: { type: 'Object', select: true },
      pos: { type: 'Object', select: true }, // reserved for Phase 2 (void/refund/…)
      created_date: { type: 'Date', select: true },
      updated_date: { type: 'Date', select: true },
    };
  }
}

module.exports = RoleModel;
