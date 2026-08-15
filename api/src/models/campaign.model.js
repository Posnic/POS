// src/models/campaign.model.js
//
// A message to a segment of customers over a channel. The segment is a small
// object describing who to reach; the message is a template with merge fields.
// Channel-neutral and currency-agnostic - it carries no symbol or locale.
const BaseModel = require('./base.model');

class CampaignModel extends BaseModel {
  constructor() {
    super('campaigns');
    this.fields = CampaignModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    name: { type: 'String', select: true },
    channel: { type: 'String', select: true }, // 'sms' | 'whatsapp'
    message: { type: 'String', select: true }, // template with {merge} fields

    // { type, tier?, min_points?, category_id?, lapsed_days? }
    segment: { type: 'Object', select: true },

    status: { type: 'String', select: true },
    schedule_at: { type: 'Date', select: true }, // set when scheduled

    audience_size: { type: 'Number', select: true },
    sent_count: { type: 'Number', select: true },
    failed_count: { type: 'Number', select: true },
    skipped_count: { type: 'Number', select: true },
    last_run_date: { type: 'Date', select: true },

    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CampaignModel;
