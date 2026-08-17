// src/models/register_model.js
const BaseModel = require('./base.model');

class RegisterModel extends BaseModel {
  constructor() {
    super('cashregister');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      branch_id: { type: 'ObjectId', select: false },
      branch_name: { type: 'String', select: true },
      register_name: { type: 'String', select: true },
      register_id: { type: 'ObjectId', select: true },
      register_status: { type: 'String', select: true },
      payment_note: { type: 'String', select: true },
      date: { type: 'Date', select: false },
      opening_float: { type: 'Double', select: true },
      register_opendate: { type: 'Date', select: true },
      register_closedate: { type: 'Date', select: true },
      current_user: { type: 'String', select: true },
      current_user_id: { type: 'ObjectId', select: false },
      lock_device_id: { type: 'String', select: false },
      lock_acquired_at: { type: 'Date', select: false },
      license: { type: 'ObjectId', select: false },
      register_sales: { type: 'Array', select: true },
      cashInOutDetail: { type: 'Array', select: true },
      cashDenomDetail: { type: 'Array', select: true },
      countedAmount: { type: 'Array', select: true },
      // Persisted close (immutable Z numbers), written once by
      // registercloseUpdate: expected cash at the moment of close, what was
      // counted, and the difference. Reports read these instead of recomputing,
      // so later edits to sales or cash entries can't rewrite a closed till.
      closing_expected: { type: 'Double', select: true },
      closing_counted: { type: 'Double', select: true },
      over_short: { type: 'Double', select: true },
    };
  }
}

module.exports = RegisterModel;
