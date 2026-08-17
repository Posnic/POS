// src/repositories/shift.repository.js
//
// Data layer for staff shifts (Phase 4). All queries are tenant-scoped by
// license; the actor comes from the per-request BaseModel context. A user may
// have at most one OPEN shift at a time (enforced in clockIn).

const ShiftModel = require('../models/shift.model');
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const {
  SHIFT_STATUS,
  STALE_SHIFT_AFTER_MINUTES,
  AUTO_CLOCKOUT_CAP_MINUTES,
} = require('../constants/shift.constants');

const toId = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof ObjectId) return v;
  return ObjectId.isValid(v) ? new ObjectId(v) : v;
};

class ShiftRepository {
  constructor(model) {
    this.model = model || new ShiftModel();
  }

  _license() {
    return toId(this.model.licenseId || BaseModel.license);
  }

  _branch() {
    return toId(this.model.branchId || BaseModel.currentBranch);
  }

  _userId() {
    return toId((this.model.user && this.model.user._id) || BaseModel.loggedUser);
  }

  _userName() {
    const u = this.model.user;
    return (
      (u && (u.username || u.name || u.email)) ||
      BaseModel.loggedUserName ||
      null
    );
  }

  /*
   * Forgot-to-clock-out safeguard: if this open shift is stale (older than
   * STALE_SHIFT_AFTER_MINUTES), close it now - clock_out at the cap, worked
   * minutes capped, note flagged - and return the closed doc so the caller can
   * audit it. Returns null when the shift is fresh (caller keeps its normal
   * behaviour, e.g. the 409 on double clock-in).
   */
  async _autoCloseIfStale(collection, shift, now) {
    const clockIn = shift.clock_in instanceof Date ? shift.clock_in : new Date(shift.clock_in);
    const ageMin = Math.round((now.getTime() - clockIn.getTime()) / 60000);
    if (!(ageMin > STALE_SHIFT_AFTER_MINUTES)) return null;
    const breakMin = Number(shift.break_minutes) || 0;
    const cappedGross = Math.min(ageMin, AUTO_CLOCKOUT_CAP_MINUTES);
    const set = {
      status: SHIFT_STATUS.CLOSED,
      clock_out: new Date(clockIn.getTime() + cappedGross * 60000),
      worked_minutes: Math.max(0, cappedGross - breakMin),
      note: [shift.note, '[auto clock-out]'].filter(Boolean).join(' '),
      updated_date: now,
    };
    await collection.updateOne({ _id: shift._id }, { $set: set });
    return { ...shift, ...set };
  }

  // The current user's open shift, or null.
  async getCurrentShift() {
    try {
      const collection = await this.model.getCollection('shifts');
      const shift = await collection.findOne({
        license: this._license(),
        user_id: this._userId(),
        status: SHIFT_STATUS.OPEN,
      });
      return { status: true, data: shift || null, message: shift ? 'success' : 'No open shift' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // Start a shift. Fails (409) if the user already has one open.
  async clockIn(data = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const userId = this._userId();
      if (!userId) return { status: false, statusCode: 400, message: 'No user in context' };

      const existing = await collection.findOne({
        license: this._license(),
        user_id: userId,
        status: SHIFT_STATUS.OPEN,
      });
      const now = new Date();
      let autoClosed = null;
      if (existing) {
        autoClosed = await this._autoCloseIfStale(collection, existing, now);
        if (!autoClosed) {
          return {
            status: false,
            statusCode: 409,
            data: existing,
            message: 'You already have an open shift',
          };
        }
      }

      const doc = {
        license: this._license(),
        branch_id: this._branch(),
        user_id: userId,
        user_name: this._userName(),
        status: SHIFT_STATUS.OPEN,
        clock_in: now,
        clock_out: null,
        break_minutes: 0,
        worked_minutes: 0,
        register_id: data.register_id ? toId(data.register_id) : null,
        device_id: data.device_id ? String(data.device_id) : null,
        note: data.note ? String(data.note).trim() : null,
        created_date: now,
        updated_date: now,
      };
      const result = await collection.insertOne(doc);
      return {
        status: true,
        data: { ...doc, _id: result.insertedId },
        auto_closed: autoClosed,
        message: autoClosed
          ? 'Clocked in (your forgotten shift was closed automatically)'
          : 'Clocked in',
      };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // End the current user's open shift, computing worked minutes (gross minus any
  // accumulated break time). Fails (409) if there is nothing open.
  async clockOut(data = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const userId = this._userId();
      if (!userId) return { status: false, statusCode: 400, message: 'No user in context' };

      const shift = await collection.findOne({
        license: this._license(),
        user_id: userId,
        status: SHIFT_STATUS.OPEN,
      });
      if (!shift) {
        return { status: false, statusCode: 409, message: 'No open shift to clock out' };
      }

      const now = new Date();
      const clockIn = shift.clock_in instanceof Date ? shift.clock_in : new Date(shift.clock_in);
      const breakMin = Number(shift.break_minutes) || 0;
      const grossMin = Math.max(0, Math.round((now.getTime() - clockIn.getTime()) / 60000));
      const workedMin = Math.max(0, grossMin - breakMin);

      const set = {
        status: SHIFT_STATUS.CLOSED,
        clock_out: now,
        worked_minutes: workedMin,
        note: data.note !== undefined ? String(data.note).trim() : shift.note,
        updated_date: now,
      };
      // Cash tips declared at clock-out (optional; hospitality). Stored on the
      // shift so the labour report and payroll export carry them.
      if (data.tips !== undefined && data.tips !== null && data.tips !== '') {
        const tips = Number(data.tips);
        if (Number.isFinite(tips) && tips >= 0) set.tips_declared = Math.round(tips * 100) / 100;
      }
      await collection.updateOne({ _id: shift._id }, { $set: set });
      return { status: true, data: { ...shift, ...set }, message: 'Clocked out' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // Toggle a SPECIFIC user's shift (used by clock-by-card, where the cardholder
  // is not the logged-in terminal operator): open shift -> clock out, else clock
  // in. Branch/license come from the terminal's context.
  async toggleForUser({ userId, userName, register_id, device_id, note } = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const uid = toId(userId);
      if (!uid) return { status: false, statusCode: 400, message: 'No user for card' };

      const open = await collection.findOne({
        license: this._license(),
        user_id: uid,
        status: SHIFT_STATUS.OPEN,
      });

      const now = new Date();
      let autoClosed = null;
      if (open) {
        // A stale (forgotten) shift is auto-closed and the swipe counts as a
        // fresh clock-IN - otherwise a forgotten tap yesterday would turn
        // today's arrival into a 30-hour clock-out.
        autoClosed = await this._autoCloseIfStale(collection, open, now);
        if (!autoClosed) {
          const clockIn = open.clock_in instanceof Date ? open.clock_in : new Date(open.clock_in);
          const breakMin = Number(open.break_minutes) || 0;
          const grossMin = Math.max(0, Math.round((now.getTime() - clockIn.getTime()) / 60000));
          const workedMin = Math.max(0, grossMin - breakMin);
          const set = {
            status: SHIFT_STATUS.CLOSED,
            clock_out: now,
            worked_minutes: workedMin,
            updated_date: now,
          };
          await collection.updateOne({ _id: open._id }, { $set: set });
          return {
            status: true,
            data: { action: 'clock_out', shift: { ...open, ...set } },
            message: 'Clocked out',
          };
        }
      }

      const doc = {
        license: this._license(),
        branch_id: this._branch(),
        user_id: uid,
        user_name: userName || null,
        status: SHIFT_STATUS.OPEN,
        clock_in: now,
        clock_out: null,
        break_minutes: 0,
        worked_minutes: 0,
        register_id: register_id ? toId(register_id) : null,
        device_id: device_id ? String(device_id) : null,
        note: note ? String(note).trim() : null,
        created_date: now,
        updated_date: now,
      };
      const result = await collection.insertOne(doc);
      return {
        status: true,
        data: {
          action: 'clock_in',
          shift: { ...doc, _id: result.insertedId },
          auto_closed: autoClosed,
        },
        message: autoClosed
          ? 'Clocked in (the forgotten shift was closed automatically)'
          : 'Clocked in',
      };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // Manager correction of a shift (timecard): adjust clock_in / clock_out /
  // break_minutes / note and recompute worked_minutes. License-scoped. A closed
  // shift stays closed; worked_minutes is recomputed only when both ends exist.
  async editShift(shiftId, patch = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const id = toId(shiftId);
      if (!id) return { status: false, statusCode: 400, message: 'A valid shift id is required' };
      const filter = { _id: id, license: this._license() };
      const shift = await collection.findOne(filter);
      if (!shift) return { status: false, statusCode: 404, message: 'Shift not found' };

      const set = { updated_date: new Date() };
      const parseDate = (v) => {
        if (v === undefined) return undefined;
        if (v === null || v === '') return null;
        const d = v instanceof Date ? v : new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };

      const newIn = parseDate(patch.clock_in);
      if (newIn !== undefined) set.clock_in = newIn;
      const newOut = parseDate(patch.clock_out);
      if (newOut !== undefined) set.clock_out = newOut;
      if (patch.break_minutes !== undefined) {
        const b = Number(patch.break_minutes);
        if (!Number.isFinite(b) || b < 0) {
          return { status: false, statusCode: 400, message: 'break_minutes must be a non-negative number' };
        }
        set.break_minutes = b;
      }
      if (patch.note !== undefined) set.note = patch.note === null ? null : String(patch.note).trim();
      if (patch.tips !== undefined) {
        const tips = Number(patch.tips);
        if (!Number.isFinite(tips) || tips < 0) {
          return { status: false, statusCode: 400, message: 'tips must be a non-negative number' };
        }
        set.tips_declared = Math.round(tips * 100) / 100;
      }

      // Recompute worked_minutes from the effective in/out/break.
      const effIn = set.clock_in !== undefined ? set.clock_in : shift.clock_in;
      const effOut = set.clock_out !== undefined ? set.clock_out : shift.clock_out;
      const effBreak = set.break_minutes !== undefined ? set.break_minutes : (Number(shift.break_minutes) || 0);
      if (effIn && effOut) {
        const inMs = (effIn instanceof Date ? effIn : new Date(effIn)).getTime();
        const outMs = (effOut instanceof Date ? effOut : new Date(effOut)).getTime();
        if (outMs < inMs) {
          return { status: false, statusCode: 400, message: 'clock_out cannot be before clock_in' };
        }
        const grossMin = Math.max(0, Math.round((outMs - inMs) / 60000));
        set.worked_minutes = Math.max(0, grossMin - effBreak);
      }

      await collection.updateOne(filter, { $set: set });
      return { status: true, data: { ...shift, ...set }, message: 'Shift updated' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // Group shifts by user over a date range (by clock_in) for the labour report.
  // Returns per-user rows (shift count, worked minutes, span, still-open count)
  // and a grand total. Payout (x wage) is layered on in the service.
  async getShiftReport({ from, to, user_id } = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const query = { license: this._license() };
      const branch = this._branch();
      if (branch) query.branch_id = branch;
      if (user_id) query.user_id = toId(user_id);
      const range = {};
      if (from instanceof Date) range.$gte = from;
      if (to instanceof Date) range.$lte = to;
      if (range.$gte || range.$lte) query.clock_in = range;

      const shifts = await collection.find(query).sort({ clock_in: 1 }).toArray();

      const byUser = new Map();
      let totalMinutes = 0;
      let totalShifts = 0;
      let totalTips = 0;
      for (const s of shifts) {
        const key = String(s.user_id);
        if (!byUser.has(key)) {
          byUser.set(key, {
            user_id: s.user_id,
            user_name: s.user_name || null,
            shifts: 0,
            open_shifts: 0,
            worked_minutes: 0,
            tips: 0,
            scheduled_minutes: 0,
            first_in: s.clock_in || null,
            last_out: s.clock_out || null,
          });
        }
        const row = byUser.get(key);
        row.shifts += 1;
        row.worked_minutes += Number(s.worked_minutes) || 0;
        row.tips += Number(s.tips_declared) || 0;
        if (s.status === SHIFT_STATUS.OPEN) row.open_shifts += 1;
        if (s.clock_in && (!row.first_in || s.clock_in < row.first_in)) row.first_in = s.clock_in;
        if (s.clock_out && (!row.last_out || s.clock_out > row.last_out)) row.last_out = s.clock_out;
        totalMinutes += Number(s.worked_minutes) || 0;
        totalTips += Number(s.tips_declared) || 0;
        totalShifts += 1;
      }

      // Scheduled-vs-actual: overlay rostered minutes for the same range so the
      // report can show both. A user with a roster but no shifts still appears.
      let totalScheduled = 0;
      try {
        const schedules = await this.listSchedules({
          from: from instanceof Date ? from.toISOString().slice(0, 10) : undefined,
          to: to instanceof Date ? to.toISOString().slice(0, 10) : undefined,
          user_id,
        });
        for (const sch of schedules.data || []) {
          const key = String(sch.user_id);
          if (!byUser.has(key)) {
            byUser.set(key, {
              user_id: sch.user_id,
              user_name: sch.user_name || null,
              shifts: 0,
              open_shifts: 0,
              worked_minutes: 0,
              tips: 0,
              scheduled_minutes: 0,
              first_in: null,
              last_out: null,
            });
          }
          byUser.get(key).scheduled_minutes += Number(sch.minutes) || 0;
          totalScheduled += Number(sch.minutes) || 0;
        }
      } catch (schErr) {
        // The roster is an overlay - a failure there never sinks the report.
      }

      // Tips captured on sales at tender (the standard tip line), summed per
      // seller for the same range. Kept separate from declared cash tips so
      // payroll can show both. An overlay: a failure never sinks the report.
      const saleTipsByUser = new Map();
      let totalSaleTips = 0;
      try {
        const salesCol = await this.model.getCollection('sales');
        const saleQuery = { license: this._license(), tip_amount: { $gt: 0 } };
        const saleBranch = this._branch();
        if (saleBranch) saleQuery.branch_id = saleBranch;
        if (user_id) saleQuery.user_id = String(user_id);
        const dateRange = {};
        if (from instanceof Date) dateRange.$gte = from;
        if (to instanceof Date) dateRange.$lte = to;
        if (dateRange.$gte || dateRange.$lte) saleQuery.created_date = dateRange;
        const tipped = await salesCol
          .find(saleQuery, { projection: { user_id: 1, tip_amount: 1 } })
          .toArray();
        for (const sale of tipped) {
          const key = String(sale.user_id);
          const amt = Number(sale.tip_amount) || 0;
          saleTipsByUser.set(key, (saleTipsByUser.get(key) || 0) + amt);
          totalSaleTips += amt;
        }
      } catch (tipErr) {
        // sale-tips overlay skipped
      }

      const round2 = (n) => Math.round(n * 100) / 100;
      const rows = Array.from(byUser.values()).map((r) => {
        const saleTips = saleTipsByUser.get(String(r.user_id)) || 0;
        return {
          ...r,
          worked_hours: round2(r.worked_minutes / 60),
          scheduled_hours: round2(r.scheduled_minutes / 60),
          tips: round2(r.tips),
          sale_tips: round2(saleTips),
          tips_total: round2(r.tips + saleTips),
        };
      });

      return {
        status: true,
        data: {
          rows,
          totals: {
            users: rows.length,
            shifts: totalShifts,
            worked_minutes: totalMinutes,
            worked_hours: round2(totalMinutes / 60),
            scheduled_hours: round2(totalScheduled / 60),
            tips: round2(totalTips),
            sale_tips: round2(totalSaleTips),
            tips_total: round2(totalTips + totalSaleTips),
          },
        },
        message: 'success',
      };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  /* ----- Roster / scheduling (Phase 7) ------------------------------------
   * A schedule entry is one planned stretch for one person on one day:
   * { user_id, user_name, date 'YYYY-MM-DD', start 'HH:MM', end 'HH:MM',
   *   minutes, note }. Split shifts are simply two entries on the same day.
   * The labour report overlays these as scheduled-vs-actual.
   */
  async addSchedule({ user_id, user_name, date, start, end, note } = {}) {
    try {
      const uid = toId(user_id);
      if (!uid) return { status: false, statusCode: 400, message: 'A valid user_id is required' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
        return { status: false, statusCode: 400, message: 'date must be YYYY-MM-DD' };
      }
      const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!TIME_RE.test(String(start || '')) || !TIME_RE.test(String(end || ''))) {
        return { status: false, statusCode: 400, message: 'start and end must be HH:MM' };
      }
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const minutes = toMin(end) - toMin(start);
      if (minutes <= 0) {
        return { status: false, statusCode: 400, message: 'end must be after start' };
      }
      const collection = await this.model.getCollection('shift_schedules');
      const now = new Date();
      const doc = {
        license: this._license(),
        branch_id: this._branch(),
        user_id: uid,
        user_name: user_name ? String(user_name).trim() : null,
        date: String(date),
        start: String(start),
        end: String(end),
        minutes,
        note: note ? String(note).trim() : null,
        created_date: now,
        updated_date: now,
      };
      const result = await collection.insertOne(doc);
      return { status: true, data: { ...doc, _id: result.insertedId }, message: 'Scheduled' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  async listSchedules({ from, to, user_id } = {}) {
    try {
      const collection = await this.model.getCollection('shift_schedules');
      const query = { license: this._license() };
      const branch = this._branch();
      if (branch) query.branch_id = branch;
      if (user_id) query.user_id = toId(user_id);
      const range = {};
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) range.$gte = String(from);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) range.$lte = String(to);
      if (range.$gte || range.$lte) query.date = range;
      const entries = await collection
        .find(query)
        .sort({ date: 1, start: 1 })
        .limit(1000)
        .toArray();
      return { status: true, data: entries, message: 'success' };
    } catch (error) {
      return { status: false, data: [], message: error.message };
    }
  }

  async deleteSchedule(id) {
    try {
      const sid = toId(id);
      if (!sid) return { status: false, statusCode: 400, message: 'A valid id is required' };
      const collection = await this.model.getCollection('shift_schedules');
      const result = await collection.deleteOne({ _id: sid, license: this._license() });
      if (!result.deletedCount) {
        return { status: false, statusCode: 404, message: 'Schedule entry not found' };
      }
      return { status: true, message: 'Schedule entry removed' };
    } catch (error) {
      return { status: false, data: null, message: error.message };
    }
  }

  // List shifts for the current branch (most recent first). Optional filters:
  // user_id, status, from/to (Date range on clock_in), limit.
  async listShifts(opts = {}) {
    try {
      const collection = await this.model.getCollection('shifts');
      const query = { license: this._license() };
      const branch = this._branch();
      if (branch) query.branch_id = branch;
      if (opts.user_id) query.user_id = toId(opts.user_id);
      if (opts.status) query.status = opts.status;
      const range = {};
      if (opts.from instanceof Date) range.$gte = opts.from;
      if (opts.to instanceof Date) range.$lte = opts.to;
      if (range.$gte || range.$lte) query.clock_in = range;
      const shifts = await collection
        .find(query)
        .sort({ clock_in: -1 })
        .limit(Number(opts.limit) || 200)
        .toArray();
      return { status: true, data: shifts, message: 'success' };
    } catch (error) {
      return { status: false, data: [], message: error.message };
    }
  }
}

module.exports = ShiftRepository;
