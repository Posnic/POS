const mongoose = require('mongoose');

const { defineModel } = require('../db/model-registry');
const easyTableSchema = new mongoose.Schema(
  {
    // Add specific fields for EasyTable
    tableNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'out_of_service'],
      default: 'available',
    },
    location: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Add any other fields specific to your EasyTable
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add any virtuals or methods specific to EasyTable

easyTableSchema.index({ tableNumber: 1 }, { unique: true });

const EasyTable = defineModel('EasyTable', easyTableSchema);

module.exports = EasyTable;
