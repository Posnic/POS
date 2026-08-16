// src/models/shift.model.js
//
// One staff shift: a single clock-in -> clock-out cycle for a user (Phase 4).
// Attendance + labour/payout reporting (Phase 5) build on this. A shift may span
// several register sessions, so register_id is an optional convenience link to
// the session open at clock-in, not a hard 1:1.
//
// Native-driver data-access class extending BaseModel (not Mongoose).

const BaseModel = require('./base.model');

class ShiftModel extends BaseModel {
  constructor() {
    super('shifts');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      license: { type: 'ObjectId', select: false },
      branch_id: { type: 'ObjectId', select: false },
      user_id: { type: 'ObjectId', select: true },
      user_name: { type: 'String', select: true }, // denormalised for reports
      status: { type: 'String', select: true }, // 'open' | 'closed'
      clock_in: { type: 'Date', select: true },
      clock_out: { type: 'Date', select: true },
      break_minutes: { type: 'Number', select: true }, // accumulated break time
      worked_minutes: { type: 'Number', select: true }, // computed at clock-out
      register_id: { type: 'ObjectId', select: true }, // session open at clock-in
      device_id: { type: 'String', select: true },
      note: { type: 'String', select: true },
      created_date: { type: 'Date', select: true },
      updated_date: { type: 'Date', select: true },
    };
  }
}

module.exports = ShiftModel;
