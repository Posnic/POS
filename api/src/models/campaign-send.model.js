// src/models/campaign-send.model.js
//
// One row per recipient of a campaign - the audit trail of who was messaged,
// what they were sent, and how it went. Also the dedupe key: a customer is never
// messaged twice for the same campaign.
const BaseModel = require('./base.model');

class CampaignSendModel extends BaseModel {
  constructor() {
    super('campaign_sends');
    this.fields = CampaignSendModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    campaign_id: { type: 'ObjectId', select: true },
    customer_id: { type: 'ObjectId', select: true },
    customer_name: { type: 'String', select: true },
    phone: { type: 'String', select: true },
    channel: { type: 'String', select: true },
    status: { type: 'String', select: true }, // see SEND_STATUS
    message: { type: 'String', select: true }, // the rendered message
    error: { type: 'String', select: true },
    dry_run: { type: 'Boolean', select: true },
    branch_id: { type: 'ObjectId', select: true },
    date: { type: 'Date', select: true },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = CampaignSendModel;
