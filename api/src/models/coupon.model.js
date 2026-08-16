// src/models/coupon.model.js
//
// A discount code a shop can hand out. One row covers both a shared campaign
// code and a unique one-time code - the difference is only in the usage limits
// (and an optional customer binding). Currency-agnostic: a percent coupon needs
// no currency, and a fixed coupon's value is a plain amount in the branch's own
// currency.
const BaseModel = require('./base.model');

class CouponModel extends BaseModel {
  constructor() {
    super('coupons');
    this.fields = CouponModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    code: { type: 'String', select: true }, // stored upper-cased, unique per license
    description: { type: 'String', select: true },
    type: { type: 'String', select: true }, // 'percent' | 'fixed'
    value: { type: 'Number', select: true },

    min_spend: { type: 'Number', select: true },
    max_discount: { type: 'Number', select: true }, // 0 = no cap

    start_date: { type: 'Date', select: true },
    end_date: { type: 'Date', select: true },

    usage_limit: { type: 'Number', select: true }, // total, 0 = unlimited
    per_customer_limit: { type: 'Number', select: true }, // per customer, 0 = unlimited
    customer_id: { type: 'ObjectId', select: true }, // bind a code to one customer
    times_used: { type: 'Number', select: true },
    active: { type: 'Boolean', select: true },

    // Display only: the branch's currency symbol at save time. Not used in maths.
    currency: { type: 'String', select: true },

    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CouponModel;
