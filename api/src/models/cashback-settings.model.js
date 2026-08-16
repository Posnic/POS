// src/models/cashback-settings.model.js
//
// One row per branch: the shop's cashback rule. A qualifying sale mints a unique,
// single-use coupon worth a percentage of the bill, redeemable on the customer's
// NEXT visit before it expires - a repeat-purchase nudge. Currency-agnostic: the
// percentage needs no currency and the amount minted is in the branch's own.
const BaseModel = require('./base.model');

class CashbackSettingsModel extends BaseModel {
  constructor() {
    super('cashback_settings');
    this.fields = CashbackSettingsModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },

    enabled: { type: 'Boolean', select: true },
    percent: { type: 'Number', select: true }, // cashback as a % of the bill
    min_spend: { type: 'Number', select: true }, // bill must reach this to earn
    max_cashback: { type: 'Number', select: true }, // cap the cashback (0 = none)
    validity_days: { type: 'Number', select: true }, // coupon expires after N days
    min_redeem_spend: { type: 'Number', select: true }, // next bill must reach this
    bind_to_customer: { type: 'Boolean', select: true }, // tie the coupon to the buyer

    // How to hand the coupon to the customer.
    deliver_channel: { type: 'String', select: true }, // 'none' | 'sms' | 'whatsapp'
    deliver_template: { type: 'String', select: true }, // {name}{amount}{code}{currency}{shop}{expiry}

    currency: { type: 'String', select: true }, // display only

    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CashbackSettingsModel;
