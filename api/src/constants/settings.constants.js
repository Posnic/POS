/**
 * Settings Module Constants
 * Centralized constants for settings-related operations
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

// Error Messages
const ERROR_MESSAGES = {
  // General
  NOT_FOUND: 'Setting not found',
  INVALID_DATA: 'The data provided is not valid',
  UNAUTHORIZED: 'Unauthorized',
  UPDATE_FAILED: 'Failed to update setting',
  DELETE_FAILED: 'Failed to delete setting',

  // Tax
  TAX_NOT_FOUND: 'Tax not found',
  TAX_ADD_FAILED: 'Failed to add tax',
  TAX_UPDATE_FAILED: 'Failed to update tax',
  TAX_DELETE_FAILED: 'Failed to delete tax',
  TAX_GROUP_NOT_FOUND: 'Tax group not found',

  // Unit
  UNIT_NOT_FOUND: 'Unit not found',
  UNIT_ADD_FAILED: 'Failed to add unit',
  UNIT_UPDATE_FAILED: 'Failed to update unit',
  UNIT_DELETE_FAILED: 'Failed to delete unit',

  // Denomination
  DENOM_NOT_FOUND: 'Denomination not found',
  DENOM_ADD_FAILED: 'Failed to add denomination',
  DENOM_UPDATE_FAILED: 'Failed to update denomination',
  DENOM_DELETE_FAILED: 'Failed to delete denomination',

  // Payment
  PAYMENT_NOT_FOUND: 'Payment method not found',
  PAYMENT_ADD_FAILED: 'Failed to add payment method',
  PAYMENT_UPDATE_FAILED: 'Failed to update payment method',
  PAYMENT_DELETE_FAILED: 'Failed to delete payment method',

  // Table Order
  TABLE_ORDER_NOT_FOUND: 'Table order not found',
  TABLE_ORDER_ADD_FAILED: 'Failed to add table order',
  TABLE_ORDER_UPDATE_FAILED: 'Failed to update table order',
  TABLE_ORDER_DELETE_FAILED: 'Failed to delete table order',

  // File/Image
  FILE_NOT_FOUND: 'File not found',
  FILE_UPLOAD_FAILED: 'File upload failed',
  INVALID_FILE_NAME: 'Invalid file name',
  IMAGE_DELETE_FAILED: 'Failed to delete image',

  // Password
  PASSWORD_CHANGE_FAILED: 'Failed to change password',
  OLD_PASSWORD_INCORRECT: 'Your current password is incorrect',

  // Collection
  COLLECTION_DELETE_FAILED: 'Failed to delete collection',

  // Customer/Supplier
  CUSTOMER_SETTINGS_FAILED: 'Failed to update customer settings',
  SUPPLIER_SETTINGS_FAILED: 'Failed to update supplier settings',

  // Theme
  THEME_SETTINGS_FAILED: 'Failed to update theme settings',
  THEME_NOT_FOUND: 'No theme settings found',

  // Validation
  REQUIRED_FIELDS_MISSING: 'Required fields are missing',
  ID_REQUIRED: 'ID is required',
  INVALID_ID_FORMAT: 'Invalid ID format',

  // SMS
  SMS_SEND_FAILED: 'Failed to send SMS',

  // Backup
  BACKUP_FAILED: 'Backup operation failed',
  RESTORE_FAILED: 'Restore operation failed',
};

// Success Messages
const SUCCESS_MESSAGES = {
  // General
  UPDATED: 'Setting updated',
  DELETED: 'Setting deleted',
  RETRIEVED: 'Setting retrieved',

  // Tax
  TAX_ADDED: 'Tax added',
  TAX_UPDATED: 'Tax updated',
  TAX_DELETED: 'Tax deleted',
  TAX_RETRIEVED: 'Tax retrieved',
  TAX_GROUP_ADDED: 'Tax group added',
  TAX_GROUP_UPDATED: 'Tax group updated',
  TAX_GROUP_DELETED: 'Tax group deleted',

  // Unit
  UNIT_ADDED: 'Unit added',
  UNIT_UPDATED: 'Unit updated',
  UNIT_DELETED: 'Unit deleted',
  UNIT_RETRIEVED: 'Unit retrieved',

  // Denomination
  DENOM_ADDED: 'Denomination added',
  DENOM_UPDATED: 'Denomination updated',
  DENOM_DELETED: 'Denomination deleted',
  DENOM_RETRIEVED: 'Denomination retrieved',

  // Payment
  PAYMENT_ADDED: 'Payment method added',
  PAYMENT_UPDATED: 'Payment method updated',
  PAYMENT_DELETED: 'Payment method deleted',
  PAYMENT_RETRIEVED: 'Payment methods retrieved',

  // Table Order
  TABLE_ORDER_ADDED: 'Table order added',
  TABLE_ORDER_UPDATED: 'Table order updated',
  TABLE_ORDER_DELETED: 'Table order deleted',
  TABLE_ORDER_RETRIEVED: 'Table orders retrieved',

  // Settings Updates
  GENERAL_SETTING_UPDATED: 'General Setting updated',
  COMMON_SETTINGS_UPDATED: 'Common settings updated',
  OFFLINE_SETTING_UPDATED: 'Offline setting updated',
  SMS_SETTING_UPDATED: 'SMS setting updated',
  LOGO_UPDATED: 'Branch logo updated',
  KIOSK_IMAGES_UPDATED: 'Kiosk images updated',
  IMAGE_STORED: 'Image data stored',
  IMAGE_DELETED: 'Image deleted',

  // Password
  PASSWORD_CHANGED: 'Password changed',

  // Customer/Supplier
  CUSTOMER_SETTINGS_UPDATED: 'Customer settings updated',
  SUPPLIER_SETTINGS_UPDATED: 'Supplier settings updated',

  // Theme
  THEME_SETTINGS_UPDATED: 'Theme settings updated',
  THEME_SETTINGS_RETRIEVED: 'Theme settings retrieved',

  // Collection
  COLLECTION_DELETED: 'Collection deleted',

  // Payment Keys
  PAYMENT_KEY_UPDATED: 'Payment key updated',

  // SMS Receipt
  SMS_RECEIPT_SENT: 'SMS receipt sent',

  // Backup
  BACKUP_CREATED: 'Backup created',
  RESTORE_COMPLETED: 'Restore completed',
};

// Validation Constraints
const VALIDATION_RULES = {
  // General Settings
  STORE_NAME: { MIN: 3, MAX: 250 },
  STORE_EMAIL: { MAX: 50 },
  STORE_TELEPHONE: { MIN: 3, MAX: 20 },
  STORE_ADDRESS: { MIN: 3, MAX: 500 },
  PRINTING_ADDRESS: { MIN: 3, MAX: 500 },
  WEBSITE: { MIN: 3, MAX: 50 },
  CITY: { MAX: 50 },
  PINCODE: { MAX: 15 },

  // Tax
  TAX_NAME: { MIN: 3, MAX: 20 },
  TAX_VALUE: { MIN: 1, MAX: 5 },

  // Unit
  UNIT_NAME: { MIN: 1, MAX: 20 },
  UNIT_VALUE: { MIN: 1, MAX: 6 },

  // Denomination
  DENOM_VALUE: { MIN: 1, MAX: 5 },

  // Payment
  PAYMENT_VALUE: { MIN: 1, MAX: 12 },

  // Common Settings
  DEFAULT_CUSTOMER: { MIN: 3, MAX: 100 },
  DEFAULT_SUPPLIER: { MIN: 3, MAX: 100 },

  // Password
  PASSWORD: { MIN: 5, MAX: 20 },

  // SMS
  WAY2SMS_API: { MAX: 100 },
  WAY2SMS_USERID: { MAX: 20 },
  TEXTLOCAL_API: { MAX: 100 },
  TEXTLOCAL_SENDER: { MAX: 20 },
};

// Collection Names
const COLLECTIONS = {
  BRANCHES: 'branches',
  TAX: 'grouptax',
  UNIT: 'unit',
  DENOMINATION: 'denomination',
  TABLE_ORDER: 'tableorder',
  PAYMENT: 'payment_method',
  RECYCLE_BIN: 'recycle_bin',
};

// Default Values
const DEFAULTS = {
  COUNTRY_ID: '101', // India
  COUNTRY_SORTNAME: 'IN',
  LIMIT: 5,
  PAGE: 1,
  TAX_GROUP: 'all',
};

// File Paths
const FILE_PATHS = {
  JSON_COUNTRIES: 'countries.json',
  JSON_CURRENCY: 'currency.json',
  JSON_TIMEZONE: 'timezone.json',
  JSON_GST_STATE: 'gst_state_code.json',
  STATE_PREFIX: 'state_',
};

module.exports = {
  HTTP_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  VALIDATION_RULES,
  COLLECTIONS,
  DEFAULTS,
  FILE_PATHS,
};
