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
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const BaseModel = require('../models/base.model');
const { AuditService, AUDIT_EVENTS } = require('./audit.service');
const { signApproval } = require('../utils/approval-token.util');

const PIN_RE = /^\d{4,8}$/;
// Legacy account types that may authorise regardless of a resolved pos matrix.
const MANAGER_TYPES = ['owner', 'admin', 'super_admin', 'manager', 'store_manager'];

// HID keyboard-emulation readers type the UID with assorted separators/case, so
// normalise to bare uppercase alphanumerics before hashing/looking up.
const normalizeCard = (uid) =>
  String(uid || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const hashCard = (uid) => {
  const norm = normalizeCard(uid);
  return norm ? crypto.createHash('sha256').update(norm).digest('hex') : null;
};

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
      const cashierId = (actor && actor.id) || BaseModel.loggedUser || null;
      return {
        status: true,
        message: 'Approved',
        data: {
          approved_by_user_id: String(m._id),
          approved_by_name: approverName,
          action,
          approval_token: signApproval({
            action,
            approved_by_user_id: String(m._id),
            cashier_user_id: cashierId ? String(cashierId) : null,
          }),
        },
      };
    }
    return {
      status: false,
      statusCode: 403,
      message: 'Invalid PIN or not authorised for this action',
    };
  }

  /**
   * Assign (or clear) a user's RFID/swipe card. Stores a SHA-256 hash of the
   * normalised UID; a card can belong to only one user per tenant.
   */
  async setRfid({ userId, cardUid, license }) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return { status: false, statusCode: 400, message: 'A valid user_id is required' };
    }
    let hash = null;
    const raw = cardUid === null || cardUid === undefined ? '' : String(cardUid).trim();
    if (raw.length > 0) {
      hash = hashCard(raw);
      if (!hash) return { status: false, statusCode: 400, message: 'Invalid card' };
      // One card, one person: reject if another user already holds it.
      const clashFilter = {
        rfid_hash: hash,
        _id: { $ne: new mongoose.Types.ObjectId(String(userId)) },
      };
      if (license) clashFilter.license = license;
      const clash = await User.findOne(clashFilter).select('_id').lean();
      if (clash) {
        return {
          status: false,
          statusCode: 409,
          message: 'That card is already assigned to another user',
        };
      }
    }
    const filter = { _id: new mongoose.Types.ObjectId(String(userId)) };
    if (license) filter.license = license;
    const result = await User.updateOne(filter, { $set: { rfid_hash: hash } });
    if (!result.matchedCount) return { status: false, statusCode: 404, message: 'User not found' };
    return { status: true, message: hash ? 'RFID card assigned' : 'RFID card cleared' };
  }

  // Look up the (lean) user who holds a card, or null. Selects the fields the
  // callers need (access/usertype/name).
  async findUserByCard(cardUid, license) {
    const hash = hashCard(cardUid);
    if (!hash) return null;
    const filter = { rfid_hash: hash };
    if (license) filter.license = license;
    return User.findOne(filter)
      .select('+rfid_hash +access +usertype +firstname +lastname +username +email')
      .lean();
  }

  /**
   * Verify a swiped card belongs to a manager allowed to perform `action`; on
   * success record a MANAGER_APPROVAL audit event. Fails closed (403).
   */
  async verifyManagerCard({ card_uid, action, license, actor, entityId }) {
    if (!card_uid) return { status: false, statusCode: 400, message: 'Card is required' };
    if (!action) return { status: false, statusCode: 400, message: 'action is required' };
    const m = await this.findUserByCard(card_uid, license);
    if (!m || !this._canAuthorise(m, action)) {
      return {
        status: false,
        statusCode: 403,
        message: 'Card not recognised or not authorised for this action',
      };
    }
    const approverName =
      [m.firstname, m.lastname].filter(Boolean).join(' ') || m.username || m.email || 'Manager';
    await new AuditService().record(AUDIT_EVENTS.MANAGER_APPROVAL, {
      actor_user_id: (actor && actor.id) || BaseModel.loggedUser,
      actor_name: (actor && actor.name) || BaseModel.loggedUserName,
      approved_by_user_id: m._id,
      approved_by_name: approverName,
      entity: 'sale',
      entity_id: entityId || null,
      reason: `Approved ${action} (card)`,
      details: { action, method: 'rfid' },
    });
    const cashierId = (actor && actor.id) || BaseModel.loggedUser || null;
    return {
      status: true,
      message: 'Approved',
      data: {
        approved_by_user_id: String(m._id),
        approved_by_name: approverName,
        action,
        method: 'rfid',
        approval_token: signApproval({
          action,
          approved_by_user_id: String(m._id),
          cashier_user_id: cashierId ? String(cashierId) : null,
        }),
      },
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
