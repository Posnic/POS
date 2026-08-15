// src/models/coupon-redemption.model.js
//
// One row each time a coupon is applied to a sale - the audit trail behind a
// coupon's usage counters and the per-customer limit. A redemption is voided
// (not deleted) when its sale is cancelled, so the history stays intact while
// the counters and limits free the use back up.
const BaseModel = require('./base.model');

class CouponRedemptionModel extends BaseModel {
  constructor() {
    super('coupon_redemptions');
    this.fields = CouponRedemptionModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    coupon_id: { type: 'ObjectId', select: true },
    code: { type: 'String', select: true },
    customer_id: { type: 'ObjectId', select: true },
    customer_name: { type: 'String', select: true },
    sale_id: { type: 'ObjectId', select: true },
    reference: { type: 'String', select: true }, // human sale number

    discount: { type: 'Number', select: true }, // amount taken off, branch currency
    bill_total: { type: 'Number', select: true }, // bill it was applied to
    currency: { type: 'String', select: true },

    voided: { type: 'Boolean', select: true }, // true once the sale is cancelled
    voided_date: { type: 'Date', select: true },

    branch_id: { type: 'ObjectId', select: true },
    date: { type: 'Date', select: true },
    created_date: { type: 'Date', select: true },
    changed_by: { type: 'String', select: false },
    changed_by_id: { type: 'ObjectId', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CouponRedemptionModel;
