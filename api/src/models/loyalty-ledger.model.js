// src/models/loyalty-ledger.model.js
//
// Append-only. Every earn, redeem, expiry, adjustment or reversal is one row,
// so a customer's balance is the sum of their ledger and can be rebuilt or
// audited - and two offline tills can't quietly disagree about a wallet. Nothing
// here is ever updated in place; a correction is another row.
const BaseModel = require('./base.model');

class LoyaltyLedgerModel extends BaseModel {
  constructor() {
    super('loyalty_ledger');
    this.fields = LoyaltyLedgerModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    customer_id: { type: 'ObjectId', select: true },
    customer_name: { type: 'String', select: true },
    branch_id: { type: 'ObjectId', select: true },

    // earn | redeem | expire | adjust | reverse
    type: { type: 'String', select: true },
    // signed: positive adds to the wallet, negative takes from it.
    points: { type: 'Number', select: true },
    // running balance after this entry, for a fast statement without a re-sum.
    balance_after: { type: 'Number', select: true },

    // The currency value this movement was worth at the time, plus the symbol,
    // so a statement reads correctly even if the branch's currency later changes.
    value: { type: 'Number', select: true },
    currency: { type: 'String', select: true },

    // The sale this came from, so a return can find and reverse it.
    sale_id: { type: 'ObjectId', select: true },
    reference: { type: 'String', select: true },
    reason: { type: 'String', select: true },
    tier_at: { type: 'String', select: true },

    date: { type: 'Date', select: true },
    created_date: { type: 'Date', select: true },
    changed_by: { type: 'String', select: true },
    changed_by_id: { type: 'ObjectId', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = LoyaltyLedgerModel;
