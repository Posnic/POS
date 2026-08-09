const { Schema } = require('mongoose');
/* Through defineModel for the same reason as every other model here: one
   compiled with mongoose.model is bound to the default connection, which in a
   shard is not any shop's database. */
const { defineModel } = require('../db/model-registry');

const whatsappTemplateSchema = new Schema({
  branch_id: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'branches',
  },
  branch_name: { type: String, required: true, trim: true },
  license: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'License',
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  template_type: {
    type: String,
    enum: ['general', 'sales_receipt', 'payment_reminder', 'welcome'],
    default: 'general',
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

whatsappTemplateSchema.index({ license: 1, branch_id: 1, branch_name: 1, created_at: -1 });

// Update the updated_at field on save
whatsappTemplateSchema.pre('save', function () {
  this.updated_at = new Date();
});

module.exports = defineModel('WhatsAppTemplate', whatsappTemplateSchema);
