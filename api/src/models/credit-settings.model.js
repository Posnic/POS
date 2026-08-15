// src/models/credit-settings.model.js
//
// One row per branch: how this shop runs customer credit ("khata"/udhaar) and
// how it reminds customers to pay. Currency-agnostic - a limit and a due amount
// are plain numbers in the branch's own currency. The actual outstanding lives
// in the `transaction` ledger; this is only the rules and the reminder config.
const BaseModel = require('./base.model');

class CreditSettingsModel extends BaseModel {
  constructor() {
    super('credit_settings');
    this.fields = CreditSettingsModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },

    // Credit rules. 0 credit limit = unlimited; 0 terms = no due date.
    default_credit_limit: { type: 'Number', select: true },
    credit_terms_days: { type: 'Number', select: true },

    // Payment reminders (sent through the shop's messaging providers).
    reminder_enabled: { type: 'Boolean', select: true },
    reminder_channel: { type: 'String', select: true }, // 'sms' | 'whatsapp'
    reminder_template: { type: 'String', select: true }, // {name} {due} {currency} {shop}
    reminder_min_due: { type: 'Number', select: true }, // ignore dues below this

    currency: { type: 'String', select: true }, // display only

    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CreditSettingsModel;
