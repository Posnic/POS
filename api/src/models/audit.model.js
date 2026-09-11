// src/models/audit.model.js
//
// Append-only accountability audit trail. One document per sensitive / money /
// security EVENT (login, void, refund, cash movement, clock in/out, manager
// approval, role/permission change). Multi-tenant scoped by license + branch.
//
// Complements `data_change_log` (field-level CRUD diffs, written by
// BaseModel.changeLog) - this records the ACTION, not the row diff.
//
// Native-driver data-access class extending BaseModel (not Mongoose). All DB
// operations are inherited; this class only declares the collection + fields.

const BaseModel = require('./base.model');

class AuditModel extends BaseModel {
  constructor() {
    super('audit_log');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      license: { type: 'ObjectId', select: false },
      branch_id: { type: 'ObjectId', select: false },
      at: { type: 'Date', select: true },
      event: { type: 'String', select: true },
      actor_user_id: { type: 'ObjectId', select: true },
      actor_name: { type: 'String', select: true },
      approved_by_user_id: { type: 'ObjectId', select: true },
      approved_by_name: { type: 'String', select: true },
      entity: { type: 'String', select: true },
      entity_id: { type: 'String', select: true },
      device_id: { type: 'String', select: true },
      amount: { type: 'Double', select: true },
      reason: { type: 'String', select: true },
      details: { type: 'Object', select: true },
    };
  }
}

module.exports = AuditModel;
