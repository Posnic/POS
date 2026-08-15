// src/models/loyalty-config.model.js
//
// One row per branch: the rules that turn spend into points and points back
// into a discount. Currency-agnostic - the rates are ratios against the
// branch's own currency, so this model carries no symbol or locale of its own.
const BaseModel = require('./base.model');

class LoyaltyConfigModel extends BaseModel {
  constructor() {
    super('loyalty_config');
    this.fields = LoyaltyConfigModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },
    enabled: { type: 'Boolean', select: true },

    earn_points: { type: 'Number', select: true },
    earn_amount: { type: 'Number', select: true },
    min_spend: { type: 'Number', select: true },
    earn_rounding: { type: 'String', select: true },

    redeem_points: { type: 'Number', select: true },
    redeem_value: { type: 'Number', select: true },
    min_redeem: { type: 'Number', select: true },
    max_redeem_percent: { type: 'Number', select: true },

    expiry_months: { type: 'Number', select: true },

    // Referrals: reward both sides when a referred customer first buys.
    referral_enabled: { type: 'Boolean', select: true },
    referral_referrer_points: { type: 'Number', select: true },
    referral_referee_points: { type: 'Number', select: true },
    referral_min_spend: { type: 'Number', select: true },

    // [{ name, threshold, multiplier }] - fully configurable per branch.
    tiers: { type: 'Array', select: true },

    // Display only: the branch's currency symbol at save time, so the settings
    // screen can render "1 pt = $1" without another lookup. Not used in maths.
    currency: { type: 'String', select: true },

    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = LoyaltyConfigModel;
