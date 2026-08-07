// src/models/Supplier.js
const mongoose = require('mongoose');
const validator = require('validator');
const { toJSON, paginate } = require('./plugins');

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (value && !validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
    },
    gst_number: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    gst_type: {
      type: String,
      enum: ['regular', 'composition', 'unregistered'],
      default: 'regular',
    },
    balance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    // Audit fields
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins
supplierSchema.plugin(toJSON);
supplierSchema.plugin(paginate);

// Indexes
supplierSchema.index({ name: 'text', phone: 'text' });

// Static method to check if email is taken
supplierSchema.statics.isEmailTaken = async function (email, excludeSupplierId) {
  const supplier = await this.findOne({
    email,
    _id: { $ne: excludeSupplierId },
  });
  return !!supplier;
};

// Instance method to check if supplier can be deleted
supplierSchema.methods.canBeDeleted = async function () {
  // Check if supplier has any associated purchases
  const Purchase = mongoose.model('Purchase');
  const purchaseCount = await Purchase.countDocuments({ supplier: this._id });
  return purchaseCount === 0;
};

const Supplier = mongoose.model('Supplier', supplierSchema);

module.exports = Supplier;
