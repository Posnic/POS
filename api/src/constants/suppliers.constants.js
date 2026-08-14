/**
 * Supplier Module Constants
 * Centralized constants for supplier-related operations
 */

// Default values
const DEFAULTS = {
  COUNTRY: 'India',
  GST: 'disable',
  GST_TYPE: 'consumer',
  BALANCE: 0.0,
  PAYMENT_TERMS: 'immediate',
  CREDIT_LIMIT: 0.0,
};

// Supplier statuses
const SUPPLIER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
};

// GST types
const GST_TYPES = {
  CONSUMER: 'consumer',
  REGULAR: 'regular',
  COMPOSITE: 'composite',
  UNREGISTERED: 'unregistered',
};

// GST status
const GST_STATUS = {
  ENABLE: 'enable',
  DISABLE: 'disable',
};

// Payment terms
const PAYMENT_TERMS = {
  IMMEDIATE: 'immediate',
  NET_7: 'net_7',
  NET_15: 'net_15',
  NET_30: 'net_30',
  NET_45: 'net_45',
  NET_60: 'net_60',
  NET_90: 'net_90',
};

// Error messages
const ERROR_MESSAGES = {
  SUPPLIER_NOT_FOUND: 'Supplier not found',
  SUPPLIER_NAME_REQUIRED: 'Supplier name is required',
  EMAIL_EXISTS: 'Supplier with this email already exists',
  PHONE_EXISTS: 'Supplier with this phone number already exists',
  INVALID_EMAIL: 'Invalid email address',
  INVALID_PHONE: 'Invalid phone number',
  INVALID_GST_NUMBER: 'Invalid GST number',
  VALIDATION_ERROR: 'Validation Error',
  BRANCH_REQUIRED: 'Branch ID is required',
  DELETE_FAILED: 'Failed to delete supplier',
  UPDATE_FAILED: 'Failed to update supplier',
  CREATE_FAILED: 'Failed to create supplier',
  CREDIT_LIMIT_EXCEEDED: 'The credit limit for this supplier has been exceeded',
};

// Success messages
const SUCCESS_MESSAGES = {
  SUPPLIER_CREATED: 'Supplier added',
  SUPPLIER_UPDATED: 'Supplier updated',
  SUPPLIER_DELETED: 'Supplier deleted',
  SUPPLIERS_DELETED: 'Suppliers deleted',
  SUPPLIERS_RETRIEVED: 'Suppliers retrieved',
  SUPPLIER_RETRIEVED: 'Supplier retrieved',
  PREFERENCES_UPDATED: 'Supplier preferences updated',
  SUPPLIERS_IMPORTED: 'Suppliers imported',
  SUPPLIERS_EXPORTED: 'Suppliers exported',
};

// HTTP Status codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

// Response types
const RESPONSE_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  EXIST: 'exist',
  NONE: 'none',
};

// Field limits
const FIELD_LIMITS = {
  NAME_MIN: 1,
  NAME_MAX: 100,
  EMAIL_MAX: 250,
  PHONE_MIN: 10,
  PHONE_MAX: 15,
  ADDRESS_MAX: 500,
  NOTES_MAX: 1000,
  GST_NUMBER_LENGTH: 15,
  PINCODE_LENGTH: 6,
  COMPANY_NAME_MAX: 200,
};

// Validation patterns
const VALIDATION_PATTERNS = {
  EMAIL: /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
  PHONE: /^[+]?[0-9]{10,15}$/,
  GST_NUMBER: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  PINCODE: /^[0-9]{6}$/,
};

module.exports = {
  DEFAULTS,
  SUPPLIER_STATUS,
  GST_TYPES,
  GST_STATUS,
  PAYMENT_TERMS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
};
