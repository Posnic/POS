/**
 * Customer Module Constants
 * Centralized constants for customer-related operations
 */

// Default values
const DEFAULTS = {
  COUNTRY: 'India',
  GST: 'disable',
  GST_TYPE: 'consumer',
  BALANCE: 0.0,
  PARTIAL_BALANCE: false,
  LOYALTY_TIER: 'bronze',
  LOYALTY_POINTS: 0,
};

// Customer statuses
const CUSTOMER_STATUS = {
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

// Loyalty tiers
const LOYALTY_TIERS = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum',
};

// Loyalty tier thresholds (points)
const LOYALTY_THRESHOLDS = {
  BRONZE: 0,
  SILVER: 1000,
  GOLD: 5000,
  PLATINUM: 10000,
};

// Error messages
const ERROR_MESSAGES = {
  CUSTOMER_NOT_FOUND: 'Customer not found',
  CUSTOMER_NAME_REQUIRED: 'Customer name is required',
  EMAIL_EXISTS: 'Customer with this email already exists',
  PHONE_EXISTS: 'Customer with this phone number already exists',
  INVALID_EMAIL: 'Invalid email address',
  INVALID_PHONE: 'Invalid phone number',
  INVALID_GST_NUMBER: 'Invalid GST number',
  VALIDATION_ERROR: 'Validation Error',
  BRANCH_REQUIRED: 'Branch ID is required',
  INSUFFICIENT_POINTS: 'Insufficient loyalty points',
  INVALID_POINTS: 'Points must be greater than 0',
  DELETE_FAILED: 'Failed to delete customer',
  UPDATE_FAILED: 'Failed to update customer',
  CREATE_FAILED: 'Failed to create customer',
  PARTIAL_BALANCE_DISABLED: 'Partial balance is not enabled for this customer',
};

// Success messages
const SUCCESS_MESSAGES = {
  CUSTOMER_CREATED: 'Customer added successfully',
  CUSTOMER_UPDATED: 'Customer updated successfully',
  CUSTOMER_DELETED: 'Customer deleted successfully',
  CUSTOMERS_DELETED: 'Customers deleted successfully',
  CUSTOMERS_RETRIEVED: 'Customers retrieved successfully',
  CUSTOMER_RETRIEVED: 'Customer retrieved successfully',
  POINTS_ADDED: 'Loyalty points added successfully',
  POINTS_REDEEMED: 'Loyalty points redeemed successfully',
  PREFERENCES_UPDATED: 'Customer preferences updated successfully',
  CUSTOMERS_IMPORTED: 'Customers imported successfully',
  CUSTOMERS_EXPORTED: 'Customers exported successfully',
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
  CUSTOMER_STATUS,
  GST_TYPES,
  GST_STATUS,
  LOYALTY_TIERS,
  LOYALTY_THRESHOLDS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
};
