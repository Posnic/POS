// src/services/shift.service.js
//
// Thin service over ShiftRepository that also records CLOCK_IN / CLOCK_OUT to the
// append-only audit trail (fail-safe: an audit failure never breaks the clock op).

const ShiftRepository = require('../repositories/shift.repository');
const BaseModel = require('../models/base.model');
const authorizationService = require('./authorization.service');
const { AuditService, AUDIT_EVENTS } = require('./audit.service');

class ShiftService {
  constructor(model) {
    this.repository = new ShiftRepository(model);
  }

  getCurrentShift() {
    return this.repository.getCurrentShift();
  }

  async clockIn(data = {}) {
    const result = await this.repository.clockIn(data);
    if (result.status) {
      await new AuditService().record(AUDIT_EVENTS.CLOCK_IN, {
        entity: 'shift',
        entity_id: result.data && result.data._id,
        device_id: data.device_id,
      });
    }
    return result;
  }

  async clockOut(data = {}) {
    const result = await this.repository.clockOut(data);
    if (result.status) {
      const worked = result.data && result.data.worked_minutes;
      await new AuditService().record(AUDIT_EVENTS.CLOCK_OUT, {
        entity: 'shift',
        entity_id: result.data && result.data._id,
        device_id: data.device_id,
        details: typeof worked === 'number' ? { worked_minutes: worked } : undefined,
      });
    }
    return result;
  }

  // Swipe-to-clock: identify the cardholder, then toggle THEIR shift (in <-> out)
  // and audit it as that person (not the terminal operator). Enables a shared
  // terminal where staff swipe to clock in/out without logging in.
  async clockByCard({ card_uid, device_id, register_id, license } = {}) {
    const tenant = license || BaseModel.license;
    const user = await authorizationService.findUserByCard(card_uid, tenant);
    if (!user) return { status: false, statusCode: 404, message: 'Card not recognised' };

    const userName =
      [user.firstname, user.lastname].filter(Boolean).join(' ') ||
      user.username ||
      user.email ||
      null;

    const result = await this.repository.toggleForUser({
      userId: user._id,
      userName,
      register_id,
      device_id,
    });

    if (result.status && result.data) {
      const clockedOut = result.data.action === 'clock_out';
      const shift = result.data.shift;
      await new AuditService().record(
        clockedOut ? AUDIT_EVENTS.CLOCK_OUT : AUDIT_EVENTS.CLOCK_IN,
        {
          actor_user_id: user._id,
          actor_name: userName,
          entity: 'shift',
          entity_id: shift && shift._id,
          device_id,
          details: clockedOut && shift ? { worked_minutes: shift.worked_minutes, method: 'rfid' } : { method: 'rfid' },
        }
      );
    }
    return result;
  }

  listShifts(opts = {}) {
    return this.repository.listShifts(opts);
  }
}

module.exports = ShiftService;
