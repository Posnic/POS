const mongoose = require('mongoose');

// Subdocument schema for individual variant values (matches legacy `fields`)
const variantFieldSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

// Main Variant schema aligned with legacy PHP `variant_model`
const variantSchema = new mongoose.Schema(
  {
    // Branch context (optional but used for scoping in legacy)
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    branch_name: {
      type: String,
      trim: true,
    },

    // Core fields
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Array of variant values: [{ name: "Small" }, { name: "Medium" }, ...]
    fields: {
      type: [variantFieldSchema],
      default: [],
    },

    description: {
      type: String,
      trim: true,
    },

    // Audit + license metadata (kept compatible with legacy collection shape)
    created_date: {
      type: Date,
      default: Date.now,
    },
    updated_date: {
      type: Date,
      default: Date.now,
    },
    created_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    created_by: {
      type: String,
      trim: true,
    },
    updated_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updated_by: {
      type: String,
      trim: true,
    },
    license: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'License',
    },
  },
  {
    timestamps: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Ensure updated_date is always maintained
variantSchema.pre('save', function () {
  this.updated_date = new Date();
  if (!this.created_date) {
    this.created_date = this.updated_date;
  }
});

// Index name + branch for faster lookups and uniqueness checks
variantSchema.index({ name: 1, branch_id: 1 });

const VariantModel = mongoose.model('Variant', variantSchema);

module.exports = VariantModel;
