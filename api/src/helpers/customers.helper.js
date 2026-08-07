/**
 * Customer Helper Functions
 * Utility functions for customer-related operations
 */

const {
  LOYALTY_TIERS,
  LOYALTY_THRESHOLDS,
  VALIDATION_PATTERNS,
} = require('../constants/customers.constants');

/**
 * Calculate loyalty tier based on points
 * @param {Number} points - Total loyalty points
 * @returns {String} - Loyalty tier
 */
const calculateLoyaltyTier = (points) => {
  if (points >= LOYALTY_THRESHOLDS.PLATINUM) return LOYALTY_TIERS.PLATINUM;
  if (points >= LOYALTY_THRESHOLDS.GOLD) return LOYALTY_TIERS.GOLD;
  if (points >= LOYALTY_THRESHOLDS.SILVER) return LOYALTY_TIERS.SILVER;
  return LOYALTY_TIERS.BRONZE;
};

/**
 * Validate email format
 * @param {String} email - Email address
 * @returns {Boolean} - Valid or not
 */
const isValidEmail = (email) => {
  if (!email) return true; // Email is optional
  return VALIDATION_PATTERNS.EMAIL.test(email);
};

/**
 * Validate phone format
 * @param {String} phone - Phone number
 * @returns {Boolean} - Valid or not
 */
const isValidPhone = (phone) => {
  if (!phone) return true; // Phone is optional
  return VALIDATION_PATTERNS.PHONE.test(phone);
};

/**
 * Validate GST number format
 * @param {String} gstNumber - GST number
 * @returns {Boolean} - Valid or not
 */
const isValidGSTNumber = (gstNumber) => {
  if (!gstNumber) return true; // GST is optional
  return VALIDATION_PATTERNS.GST_NUMBER.test(gstNumber);
};

/**
 * Validate pincode format
 * @param {String} pincode - Pincode
 * @returns {Boolean} - Valid or not
 */
const isValidPincode = (pincode) => {
  if (!pincode) return true; // Pincode is optional
  return VALIDATION_PATTERNS.PINCODE.test(pincode);
};

/**
 * Sanitize customer data
 * Remove unwanted fields and trim strings
 * @param {Object} data - Customer data
 * @returns {Object} - Sanitized data
 */
const sanitizeCustomerData = (data) => {
  const sanitized = { ...data };

  // Remove system fields that shouldn't be updated directly
  delete sanitized._id;
  delete sanitized.license;
  delete sanitized.created_date;
  delete sanitized.created_by;
  delete sanitized.created_by_id;
  delete sanitized.is_deleted;

  // Trim string fields
  if (sanitized.name) sanitized.name = sanitized.name.trim();
  if (sanitized.email) sanitized.email = sanitized.email.trim().toLowerCase();
  if (sanitized.phone) sanitized.phone = sanitized.phone.trim();
  if (sanitized.address) sanitized.address = sanitized.address.trim();
  if (sanitized.city) sanitized.city = sanitized.city.trim();
  if (sanitized.state) sanitized.state = sanitized.state.trim();
  if (sanitized.gst_number) sanitized.gst_number = sanitized.gst_number.trim().toUpperCase();

  return sanitized;
};

/**
 * Format customer for response
 * @param {Object} customer - Customer document
 * @returns {Object} - Formatted customer
 */
const formatCustomerResponse = (customer) => {
  if (!customer) return null;

  return {
    id: customer._id,
    name: customer.name,
    email: customer.email || '',
    phone: customer.phone || '',
    alternatePhone: customer.alternatePhone || '',
    address: customer.address || '',
    city: customer.city || '',
    state: customer.state || '',
    country: customer.country || 'India',
    pincode: customer.pincode || '',
    gst: customer.gst || 'disable',
    gst_type: customer.gst_type || 'consumer',
    gst_number: customer.gst_number || '',
    branch_id: customer.branch_id,
    branch_name: customer.branch_name || '',
    balance: customer.balance || 0.0,
    partial_balance: customer.partial_balance || false,
    loyalty: customer.loyalty || null,
    tags: customer.tags || [],
    notes: customer.notes || '',
    created_date: customer.created_date,
    updated_date: customer.updated_date,
  };
};

/**
 * Normalize boolean value
 * @param {*} value - Value to normalize
 * @returns {Boolean} - Boolean value
 */
const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'on';
  }
  if (typeof value === 'number') return value === 1;
  return false;
};

/**
 * Calculate points for purchase amount
 * @param {Number} amount - Purchase amount
 * @param {Number} pointsPerRupee - Points per rupee (default: 0.1)
 * @returns {Number} - Points earned
 */
const calculatePointsForPurchase = (amount, pointsPerRupee = 0.1) => {
  return Math.floor(amount * pointsPerRupee);
};

/**
 * Validate customer data for creation
 * @param {Object} data - Customer data
 * @returns {Object} - { valid: Boolean, errors: Array }
 */
const validateCustomerData = (data) => {
  const errors = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push('Customer name is required');
  }

  if (data.email && !isValidEmail(data.email)) {
    errors.push('Invalid email format');
  }

  if (data.phone && !isValidPhone(data.phone)) {
    errors.push('Invalid phone format');
  }

  if (data.gst_number && !isValidGSTNumber(data.gst_number)) {
    errors.push('Invalid GST number format');
  }

  if (data.pincode && !isValidPincode(data.pincode)) {
    errors.push('Invalid pincode format');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

module.exports = {
  calculateLoyaltyTier,
  isValidEmail,
  isValidPhone,
  isValidGSTNumber,
  isValidPincode,
  sanitizeCustomerData,
  formatCustomerResponse,
  normalizeBoolean,
  calculatePointsForPurchase,
  validateCustomerData,
};
