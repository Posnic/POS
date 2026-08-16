// src/models/messaging-settings.model.js
//
// One row per branch: which SMS provider the shop uses and its credentials, plus
// its local WhatsApp device. SMS is the CUSTOMER's own account - we hold their
// keys only so the server can send on their behalf; the secrets live here (in
// the cloud tenant DB) and are never returned to a client in the clear, so a
// desktop copy never carries them. WhatsApp runs locally on the shop's machine
// (a linked device), so only its id/host is recorded here, not a credential.
const BaseModel = require('./base.model');

class MessagingSettingsModel extends BaseModel {
  constructor() {
    super('messaging_settings');
    this.fields = MessagingSettingsModel.fields;
  }

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },

    sms_enabled: { type: 'Boolean', select: true },
    sms_provider: { type: 'String', select: true }, // registry id, e.g. 'twilio'
    // Provider credential fields (incl. secrets). Secrets are blanked on read.
    sms_config: { type: 'Object', select: true },
    sms_template: { type: 'String', select: true }, // optional default / DLT text

    whatsapp_enabled: { type: 'Boolean', select: true },
    // 'web' = a QR-linked device on the shop's own machine (whatsapp-web);
    // 'cloud' = Meta's WhatsApp Cloud API (registered Meta app + access token).
    whatsapp_mode: { type: 'String', select: true },
    whatsapp_device_id: { type: 'String', select: true }, // web mode: local linked device
    whatsapp_host: { type: 'String', select: true }, // web mode: machine/IP (informational)
    // cloud mode: { access_token (secret), phone_number_id, api_version,
    // template_name, template_lang }
    whatsapp_cloud: { type: 'Object', select: true },

    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = MessagingSettingsModel;
