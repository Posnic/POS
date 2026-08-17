// src/services/shift.service.js
//
// Thin service over ShiftRepository that also records CLOCK_IN / CLOCK_OUT to the
// append-only audit trail (fail-safe: an audit failure never breaks the clock op).

const mongoose = require('mongoose');
const ShiftRepository = require('../repositories/shift.repository');
const BaseModel = require('../models/base.model');
const User = require('../models/user.model');
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
      // A forgotten shift closed on the way in is audited as its own event, so
      // the trail shows both the auto-close and the fresh clock-in.
      if (result.auto_closed) {
        await new AuditService().record(AUDIT_EVENTS.CLOCK_OUT, {
          entity: 'shift',
          entity_id: result.auto_closed._id,
          device_id: data.device_id,
          details: { auto: true, worked_minutes: result.auto_closed.worked_minutes },
        });
      }
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
      const tips = result.data && result.data.tips_declared;
      await new AuditService().record(AUDIT_EVENTS.CLOCK_OUT, {
        entity: 'shift',
        entity_id: result.data && result.data._id,
        device_id: data.device_id,
        details:
          typeof worked === 'number'
            ? { worked_minutes: worked, ...(typeof tips === 'number' ? { tips_declared: tips } : {}) }
            : undefined,
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
      if (result.data.auto_closed) {
        await new AuditService().record(AUDIT_EVENTS.CLOCK_OUT, {
          actor_user_id: user._id,
          actor_name: userName,
          entity: 'shift',
          entity_id: result.data.auto_closed._id,
          device_id,
          details: { auto: true, worked_minutes: result.data.auto_closed.worked_minutes, method: 'rfid' },
        });
      }
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

  // Labour / payout report: per-user worked hours over a range, times each
  // person's hourly wage (0 if unset => hours only). Wages are joined here so
  // the repository stays about shift data.
  async getReport({ from, to, user_id } = {}) {
    const result = await this.repository.getShiftReport({ from, to, user_id });
    if (!result.status || !result.data) return result;

    const rows = result.data.rows || [];
    const ids = rows.map((r) => r.user_id).filter(Boolean);
    let userById = {};
    if (ids.length) {
      try {
        const users = await User.find({ _id: { $in: ids } })
          .select('hourly_rate firstname lastname username')
          .lean();
        users.forEach((u) => { userById[String(u._id)] = u; });
      } catch (e) {
        userById = {};
      }
    }

    let totalPayout = 0;
    result.data.rows = rows.map((r) => {
      const u = userById[String(r.user_id)] || {};
      const rate = Number(u.hourly_rate) || 0;
      const payout = Math.round(r.worked_hours * rate * 100) / 100;
      totalPayout += payout;
      const name =
        r.user_name || [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username || null;
      return { ...r, user_name: name, hourly_rate: rate, payout };
    });
    result.data.totals.payout = Math.round(totalPayout * 100) / 100;
    return result;
  }

  // Manager correction of a shift's times/breaks/tips (timecard). Records a
  // SHIFT_EDIT audit event with what changed, so corrections are accountable.
  async editShift(shiftId, patch = {}) {
    const result = await this.repository.editShift(shiftId, patch);
    if (result.status) {
      await new AuditService().record(AUDIT_EVENTS.SHIFT_EDIT, {
        entity: 'shift',
        entity_id: shiftId,
        details: {
          clock_in: patch.clock_in,
          clock_out: patch.clock_out,
          break_minutes: patch.break_minutes,
          tips: patch.tips,
          worked_minutes: result.data && result.data.worked_minutes,
        },
      });
    }
    return result;
  }

  /* Roster / scheduling (Phase 7): planned stretches per person per day,
   * overlaid on the labour report as scheduled-vs-actual. Add and remove are
   * audited (SCHEDULE_EDIT) so roster changes are accountable too. */
  async addSchedule(entry = {}) {
    const result = await this.repository.addSchedule(entry);
    if (result.status) {
      await new AuditService().record(AUDIT_EVENTS.SCHEDULE_EDIT, {
        entity: 'shift_schedule',
        entity_id: result.data && result.data._id,
        details: {
          action: 'add',
          user_id: entry.user_id,
          date: entry.date,
          start: entry.start,
          end: entry.end,
        },
      });
    }
    return result;
  }

  listSchedules(opts = {}) {
    return this.repository.listSchedules(opts);
  }

  async deleteSchedule(id) {
    const result = await this.repository.deleteSchedule(id);
    if (result.status) {
      await new AuditService().record(AUDIT_EVENTS.SCHEDULE_EDIT, {
        entity: 'shift_schedule',
        entity_id: id,
        details: { action: 'delete' },
      });
    }
    return result;
  }

  // Set a user's hourly wage (used by the payout report).
  async setRate({ userId, hourlyRate, license }) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return { status: false, statusCode: 400, message: 'A valid user_id is required' };
    }
    const rate = Number(hourlyRate);
    if (!Number.isFinite(rate) || rate < 0) {
      return { status: false, statusCode: 400, message: 'Hourly rate must be a non-negative number' };
    }
    const filter = { _id: new mongoose.Types.ObjectId(String(userId)) };
    if (license) filter.license = license;
    const result = await User.updateOne(filter, { $set: { hourly_rate: rate } });
    if (!result.matchedCount) return { status: false, statusCode: 404, message: 'User not found' };
    return { status: true, message: 'Hourly rate saved' };
  }
}

module.exports = ShiftService;
