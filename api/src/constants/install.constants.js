/**
 * Install Module Constants
 * Centralized constants for installation-related operations
 */

// Default values
const DEFAULTS = {
  USER_TYPE: 'super_admin',
  IMAGE: 'user.svg',
  LOGO: 'store.png',
  PLAN_NAME: 'premium',
  MAX_SALES: 'unlimited',
  PLAN_DURATION_YEARS: 1,
  CURRENCY: '₹',
  CURRENCY_TEXT: 'India Rupee / INR or ₹',
  CURRENCY_TYPE: '₹',
  TIME_ZONE: 'Asia/Kolkata',
  SALES_PREFIX: 'S',
  RECEIVING_PREFIX: 'RID',
  PRINT_TYPE: 'standard',
  PRINTING_SIZE: 'receipt_medium',
  PRINT_CHARACTER: 'default',
  HEADER_PRINT: 'default',
  FOOTER_PRINT: 'Thank you for shopping...!',
  CLIENT_DATEFORMAT: 'yyyy/mm/dd',
  SERVER_DATEFORMAT: 'Y/m/d',
  DATEFORMAT_TEXT: '2018/01/01 -- yyyy/mm/dd',
  NOTIFICATION_RANGE: '10',
  SMS_TYPE: 'way2sms',
  SMS_AUTO_SEND_TIME: '10:00 am',
  SMS_RETRY_PERIOD: '24',
  SMS_MAX_RETRIES: '2',
  INDIAN_GST: 'gst_off',
  THEME: 'blue',
};

// Installation statuses
const INSTALL_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING: 'pending',
};

// User types
const USER_TYPES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
};

// Register status
const REGISTER_STATUS = {
  OPEN: 'Open',
  CLOSED: 'Closed',
};

// Error messages
const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized',
  VALIDATION_ERROR: 'Validation Error',
  COMPANY_NAME_REQUIRED: 'Company name is required',
  COMPANY_NAME_LENGTH: 'Company name must be between 3 and 160 characters',
  USERNAME_REQUIRED: 'Username is required',
  EMAIL_REQUIRED: 'Email is required',
  VALID_EMAIL_REQUIRED: 'Valid email is required',
  PHONE_LENGTH: 'Phone number must be less than 20 characters',
  LICENSE_ID_REQUIRED: 'License ID is required',
  DUPLICATE_USERNAME: 'This username already exists in our system',
  DUPLICATE_EMAIL: 'This email already exists in our system',
  DUPLICATE_LICENSE: 'This license already exists in our system',
  INSTALLATION_FAILED: 'An error occurred during installation',
  CLEANUP_FAILED: 'An error occurred during cleanup',
  INVALID_KEY_SECRET: 'Invalid installation key or secret',
  BRANCH_LICENSE_REQUIRED: 'Branch and license context required',
  DEMO_DATA_LOAD_FAILED: 'Failed to load demo data',
  DEFAULT_DATA_LOAD_FAILED: 'Failed to load default data',
};

// Success messages
const SUCCESS_MESSAGES = {
  ACCOUNT_CREATED: 'Account created successfully',
  CLEANUP_SUCCESS: 'Successfully deleted records across all collections',
  INSTALLATION_COMPLETE: 'Installation completed successfully',
  DEMO_DATA_LOADED: 'Demo data loaded successfully',
  DEFAULT_DATA_LOADED: 'Default data loaded successfully',
};

// HTTP Status codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

// Response types
const RESPONSE_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  EXIST: 'exist',
};

// Field limits for validation
const FIELD_LIMITS = {
  COMPANY_NAME_MIN: 3,
  COMPANY_NAME_MAX: 160,
  PHONE_MAX: 20,
  USERNAME_MIN: 3,
  USERNAME_MAX: 50,
  EMAIL_MAX: 100,
};

// Access permissions structure
const DEFAULT_ACCESS = {
  dashboard: { read: true, financials: true },
  sales: { read: true, write: true, delete: true },
  receiving: { read: true, write: true, delete: true },
  customer: { read: true, write: true, delete: true },
  supplier: { read: true, write: true, delete: true },
  category: { read: true, write: true, delete: true },
  item: { read: true, write: true, delete: true },
  user: { read: true, write: true, delete: true },
  expense: { read: true, write: true, delete: true },
  branch: { read: true, write: true, delete: true },
  report: { read: true, write: true, delete: true },
  plan: { read: true },
};

// Collections to cleanup
const CLEANUP_COLLECTIONS = [
  'users',
  'branches',
  'customers',
  'suppliers',
  'categories',
  'items',
  'grouptax',
  'unit',
  'sales',
  'receivings',
  'expenses',
  'stocklogs',
  'payments',
  'reports',
  'notifications',
  'settings',
];

module.exports = {
  DEFAULTS,
  INSTALL_STATUS,
  USER_TYPES,
  REGISTER_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  DEFAULT_ACCESS,
  CLEANUP_COLLECTIONS,
};
