/**
 * Supplier Helper Functions
 * Utility functions for supplier-related operations
 */

const { VALIDATION_PATTERNS } = require('../constants/suppliers.constants');

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
 * Sanitize supplier data
 * Remove unwanted fields and trim strings
 * @param {Object} data - Supplier data
 * @returns {Object} - Sanitized data
 */
const sanitizeSupplierData = (data) => {
  const sanitized = { ...data };

  // Remove system fields that shouldn't be updated directly
  delete sanitized._id;
  delete sanitized.license;
  delete sanitized.created_date;
  delete sanitized.is_deleted;

  // Note: Keep created_by, created_by_id, branch_id, branch_name as they are set by controller

  // Trim string fields
  if (sanitized.name) sanitized.name = sanitized.name.trim();
  if (sanitized.company_name) sanitized.company_name = sanitized.company_name.trim();
  if (sanitized.email) sanitized.email = sanitized.email.trim().toLowerCase();
  if (sanitized.phone) sanitized.phone = sanitized.phone.trim();
  if (sanitized.address) sanitized.address = sanitized.address.trim();
  if (sanitized.city) sanitized.city = sanitized.city.trim();
  if (sanitized.state) sanitized.state = sanitized.state.trim();
  if (sanitized.gst_number) sanitized.gst_number = sanitized.gst_number.trim().toUpperCase();

  return sanitized;
};

/**
 * Format supplier for response
 * @param {Object} supplier - Supplier document
 * @returns {Object} - Formatted supplier
 */
const formatSupplierResponse = (supplier) => {
  if (!supplier) return null;

  return {
    id: supplier._id,
    name: supplier.name,
    company_name: supplier.company_name || '',
    email: supplier.email || '',
    phone: supplier.phone || '',
    alternatePhone: supplier.alternatePhone || '',
    address: supplier.address || '',
    city: supplier.city || '',
    state: supplier.state || '',
    country: supplier.country || 'India',
    pincode: supplier.pincode || '',
    gst: supplier.gst || 'disable',
    gst_type: supplier.gst_type || 'registered',
    gst_number: supplier.gst_number || '',
    branch_id: supplier.branch_id,
    branch_name: supplier.branch_name || '',
    balance: supplier.balance || 0.0,
    credit_limit: supplier.credit_limit || 0.0,
    payment_terms: supplier.payment_terms || 'immediate',
    notes: supplier.notes || '',
    created_date: supplier.created_date,
    updated_date: supplier.updated_date,
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
 * Calculate outstanding balance
 * @param {Number} totalPurchases - Total purchase amount
 * @param {Number} totalPaid - Total paid amount
 * @returns {Number} - Outstanding balance
 */
const calculateOutstandingBalance = (totalPurchases, totalPaid) => {
  return totalPurchases - totalPaid;
};

/**
 * Check if credit limit exceeded
 * @param {Number} currentBalance - Current outstanding balance
 * @param {Number} creditLimit - Credit limit
 * @param {Number} newPurchaseAmount - New purchase amount
 * @returns {Boolean} - True if limit would be exceeded
 */
const isCreditLimitExceeded = (currentBalance, creditLimit, newPurchaseAmount) => {
  if (creditLimit === 0) return false; // No limit set
  return currentBalance + newPurchaseAmount > creditLimit;
};

/**
 * Validate supplier data for creation
 * @param {Object} data - Supplier data
 * @returns {Object} - { valid: Boolean, errors: Array }
 */
const validateSupplierData = (data) => {
  const errors = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push('Supplier name is required');
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

// For bulk CSV import we need to be slightly more tolerant to match
// legacy behaviour. In particular, an invalid phone format alone
// should not cause the entire row to be rejected.
const validateSupplierImportData = (data) => {
  const base = validateSupplierData(data);

  if (base.valid) {
    return base;
  }

  const filteredErrors = base.errors.filter((msg) => msg !== 'Invalid phone format');

  return {
    valid: filteredErrors.length === 0,
    errors: filteredErrors,
  };
};

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidGSTNumber,
  isValidPincode,
  sanitizeSupplierData,
  formatSupplierResponse,
  normalizeBoolean,
  calculateOutstandingBalance,
  isCreditLimitExceeded,
  validateSupplierData,
  validateSupplierImportData,
};
