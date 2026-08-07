// src/models/customer.model.js
const BaseModel = require('./base.model');
require('mongodb');

/**
 * Customer Model
 * Schema-only model for customer data structure and validation
 * All business logic moved to CustomerService
 * All database operations moved to CustomerRepository
 */
class CustomerModel extends BaseModel {
  constructor() {
    super('customers');

    // Field definitions and validation rules
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },

      // Branch Information
      branch_id: { type: 'ObjectId', select: true },
      branch_name: { type: 'String', select: true },

      // Basic Information
      name: { type: 'String', select: true, required: true },
      category_id: { type: 'ObjectId', select: true },
      category_name: { type: 'String', select: true },
      referrer_id: { type: 'ObjectId', select: true },
      referrer_name: { type: 'String', select: true },
      email: {
        type: 'String',
        select: true,
        unique: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
      },
      phone: {
        type: 'String',
        select: true,
        required: true,
        unique: true,
      },
      alternatePhone: { type: 'String', select: true },

      // Address Information
      address: { type: 'String', select: true },
      city: { type: 'String', select: true },
      state: { type: 'String', select: true },
      country: { type: 'String', select: true, default: 'India' },
      pincode: { type: 'String', select: true },

      // Multiple Addresses
      addresses: [
        {
          type: {
            type: String,
            enum: ['billing', 'shipping', 'both'],
            default: 'both',
          },
          street: String,
          city: String,
          state: String,
          country: { type: String, default: 'India' },
          pincode: String,
          isDefault: Boolean,
          _id: false,
        },
      ],

      // GST Details
      gst: {
        type: 'String',
        enum: ['enable', 'disable'],
        default: 'disable',
        select: true,
      },
      gst_type: {
        type: 'String',
        enum: ['consumer', 'regular', 'composite', 'unregistered'],
        default: 'consumer',
        select: true,
      },
      gst_number: {
        type: 'String',
        select: true,
        match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST number'],
      },

      // Loyalty Program
      loyalty: {
        points: { type: Number, default: 0, min: 0 },
        pointsEarned: { type: Number, default: 0 },
        pointsRedeemed: { type: Number, default: 0 },
        tier: {
          type: String,
          enum: ['bronze', 'silver', 'gold', 'platinum'],
          default: 'bronze',
        },
        joinDate: { type: Date },
        lastUpdated: { type: Date, default: Date.now },
        _id: false,
      },

      // Customer Preferences
      preferences: {
        emailNotifications: { type: Boolean, default: true },
        smsNotifications: { type: Boolean, default: true },
        whatsappNotifications: { type: Boolean, default: true },
        preferredCommunication: {
          type: String,
          enum: ['email', 'sms', 'whatsapp', 'any'],
          default: 'any',
        },
        _id: false,
      },

      // Statistics (updated by sales transactions)
      totalPurchases: { type: Number, default: 0, min: 0 },
      totalSpent: { type: Number, default: 0, min: 0 },
      lastPurchaseDate: { type: Date },
      averageOrderValue: { type: Number, default: 0, min: 0 },

      // Credit/Payment Information
      creditLimit: { type: Number, default: 0, min: 0 },
      currentBalance: { type: Number, default: 0 },
      paymentTerms: {
        type: String,
        enum: ['immediate', 'net15', 'net30', 'net60', 'net90', 'custom'],
        default: 'immediate',
      },

      // Status
      status: {
        type: 'String',
        enum: ['active', 'inactive', 'blocked'],
        default: 'active',
        select: true,
      },

      // Notes and Tags
      notes: { type: 'String', select: true },
      tags: [{ type: String }],

      // Metadata
      license: { type: 'ObjectId', select: true, required: true },
      created_date: { type: 'Date', select: true, default: Date.now },
      updated_date: { type: 'Date', select: true, default: Date.now },
      created_by: { type: 'String', select: true },
      created_by_id: { type: 'ObjectId', select: true },
      updated_by: { type: 'String', select: true },
      updated_by_id: { type: 'ObjectId', select: true },
      is_deleted: { type: 'Boolean', select: true, default: false },
      deleted_date: { type: 'Date', select: true },
    };
  }

  /**
   * Validate customer data
   * @param {Object} data - Customer data to validate
   * @returns {Object} - { valid: boolean, errors: array }
   */
  validate(data) {
    const errors = [];

    // Required fields
    if (!data.name) {
      errors.push({ field: 'name', message: 'Customer name is required' });
    }

    if (!data.phone) {
      errors.push({ field: 'phone', message: 'Phone number is required' });
    }

    // Email validation
    if (data.email) {
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(data.email)) {
        errors.push({ field: 'email', message: 'Invalid email format' });
      }
    }

    // GST number validation
    if (data.gst === 'enabled' && data.gst_number) {
      const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstRegex.test(data.gst_number)) {
        errors.push({ field: 'gst_number', message: 'Invalid GST number format' });
      }
    }

    // Phone number basic validation
    if (data.phone && data.phone.length < 10) {
      errors.push({ field: 'phone', message: 'Phone number must be at least 10 digits' });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get default customer data structure
   * @returns {Object} - Default customer object
   */
  getDefaultData() {
    return {
      name: '',
      category_id: null,
      category_name: '',
      referrer_id: null,
      referrer_name: '',
      email: '',
      phone: '',
      alternatePhone: '',
      address: '',
      city: '',
      state: '',
      country: 'India',
      pincode: '',
      gst: 'disable',
      gst_type: 'consumer',
      gst_number: '',
      loyalty: {
        points: 0,
        pointsEarned: 0,
        pointsRedeemed: 0,
        tier: 'bronze',
        lastUpdated: new Date(),
      },
      preferences: {
        emailNotifications: true,
        smsNotifications: true,
        whatsappNotifications: true,
        preferredCommunication: 'any',
      },
      totalPurchases: 0,
      totalSpent: 0,
      creditLimit: 0,
      currentBalance: 0,
      paymentTerms: 'immediate',
      status: 'active',
      notes: '',
      tags: [],
      is_deleted: false,
    };
  }

  /**
   * Sanitize customer data before saving
   * @param {Object} data - Customer data
   * @returns {Object} - Sanitized data
   */
  sanitize(data) {
    const sanitized = { ...data };

    // Trim string fields
    if (sanitized.name) sanitized.name = sanitized.name.trim();
    if (sanitized.email) sanitized.email = sanitized.email.trim().toLowerCase();
    if (sanitized.phone) sanitized.phone = sanitized.phone.trim();
    if (sanitized.address) sanitized.address = sanitized.address.trim();
    if (sanitized.city) sanitized.city = sanitized.city.trim();
    if (sanitized.state) sanitized.state = sanitized.state.trim();

    // Convert numeric fields
    if (sanitized.creditLimit) sanitized.creditLimit = parseFloat(sanitized.creditLimit) || 0;
    if (sanitized.currentBalance)
      sanitized.currentBalance = parseFloat(sanitized.currentBalance) || 0;

    // Ensure loyalty points are numbers
    if (sanitized.loyalty) {
      if (sanitized.loyalty.points)
        sanitized.loyalty.points = parseInt(sanitized.loyalty.points) || 0;
      if (sanitized.loyalty.pointsEarned)
        sanitized.loyalty.pointsEarned = parseInt(sanitized.loyalty.pointsEarned) || 0;
      if (sanitized.loyalty.pointsRedeemed)
        sanitized.loyalty.pointsRedeemed = parseInt(sanitized.loyalty.pointsRedeemed) || 0;
    }

    return sanitized;
  }
}

module.exports = CustomerModel;
