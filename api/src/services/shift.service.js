// src/services/shift.service.js
//
// Thin service over ShiftRepository that also records CLOCK_IN / CLOCK_OUT to the
// append-only audit trail (fail-safe: an audit failure never breaks the clock op).

const ShiftRepository = require('../repositories/shift.repository');
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

  listShifts(opts = {}) {
    return this.repository.listShifts(opts);
  }
}

module.exports = ShiftService;
