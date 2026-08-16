// src/services/authorization.service.js
//
// Manager-approval elevation (Phase 2). A cashier's restricted till action
// (void, refund, over-limit discount, no-sale drawer, register close ...) can be
// authorised on the spot by a manager entering their PIN. This module:
//   - setManagerPin: store a bcrypt hash of a user's manager PIN (or clear it).
//   - verifyManagerPin: check a PIN against a manager who is ALLOWED to perform
//     the action, and record the approval to the append-only audit trail.
//
// Users are queried via the Mongoose model scoped by license (the same
// tenant-isolation pattern the rest of the users controller uses).

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const BaseModel = require('../models/base.model');
const { AuditService, AUDIT_EVENTS } = require('./audit.service');

const PIN_RE = /^\d{4,8}$/;
// Legacy account types that may authorise regardless of a resolved pos matrix.
const MANAGER_TYPES = ['owner', 'admin', 'super_admin', 'manager', 'store_manager'];

class AuthorizationService {
  /**
   * Set (or clear) a user's manager PIN. A non-empty pin is validated (4-8
   * digits) and stored as a bcrypt hash; an empty/null pin clears it.
   */
  async setManagerPin({ userId, pin, license }) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return { status: false, statusCode: 400, message: 'A valid user_id is required' };
    }
    let hash = null;
    const raw = pin === null || pin === undefined ? '' : String(pin).trim();
    if (raw.length > 0) {
      if (!PIN_RE.test(raw)) {
        return { status: false, statusCode: 400, message: 'PIN must be 4 to 8 digits' };
      }
      hash = await bcrypt.hash(raw, 10);
    }
    const filter = { _id: new mongoose.Types.ObjectId(String(userId)) };
    if (license) filter.license = license;
    const result = await User.updateOne(filter, { $set: { manager_pin: hash } });
    if (!result.matchedCount) {
      return { status: false, statusCode: 404, message: 'User not found' };
    }
    return { status: true, message: hash ? 'Manager PIN set' : 'Manager PIN cleared' };
  }

  /**
   * Verify a PIN belongs to a manager allowed to perform `action`; on success
   * record a MANAGER_APPROVAL audit event and return the approver. Fails closed
   * (403) if no allowed manager's PIN matches.
   */
  async verifyManagerPin({ pin, action, license, actor, entityId }) {
    const raw = String(pin || '').trim();
    if (!raw) return { status: false, statusCode: 400, message: 'PIN is required' };
    if (!action) return { status: false, statusCode: 400, message: 'action is required' };

    const filter = { manager_pin: { $ne: null } };
    if (license) filter.license = license;
    const candidates = await User.find(filter)
      .select('+manager_pin +access +usertype +firstname +lastname +username +email')
      .lean();

    for (const m of candidates) {
      if (!this._canAuthorise(m, action)) continue;
      // eslint-disable-next-line no-await-in-loop
      const ok = await bcrypt.compare(raw, m.manager_pin || '');
      if (!ok) continue;
      const approverName =
        [m.firstname, m.lastname].filter(Boolean).join(' ') || m.username || m.email || 'Manager';
      await new AuditService().record(AUDIT_EVENTS.MANAGER_APPROVAL, {
        actor_user_id: (actor && actor.id) || BaseModel.loggedUser,
        actor_name: (actor && actor.name) || BaseModel.loggedUserName,
        approved_by_user_id: m._id,
        approved_by_name: approverName,
        entity: 'sale',
        entity_id: entityId || null,
        reason: `Approved ${action}`,
        details: { action },
      });
      return {
        status: true,
        message: 'Approved',
        data: { approved_by_user_id: String(m._id), approved_by_name: approverName, action },
      };
    }
    return {
      status: false,
      statusCode: 403,
      message: 'Invalid PIN or not authorised for this action',
    };
  }

  // A user may authorise an action if a legacy manager type, or their resolved
  // POS matrix grants it.
  _canAuthorise(user, action) {
    const type = String(user.usertype || '').toLowerCase();
    if (MANAGER_TYPES.includes(type)) return true;
    const pos = (user.access && user.access.pos) || {};
    return pos[action] === true;
  }
}

module.exports = new AuthorizationService();
