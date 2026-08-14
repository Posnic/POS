/**
 * Customer Category Module Constants
 * Centralized constants for customer category operations
 */

// Default values
const DEFAULTS = {
  DESCRIPTION: '',
  IS_ACTIVE: true,
};

// Error messages
const ERROR_MESSAGES = {
  CATEGORY_NOT_FOUND: 'Customer category not found',
  CATEGORY_NAME_REQUIRED: 'Customer category name is required',
  CATEGORY_EXISTS: 'This category details already exist in our system',
  VALIDATION_ERROR: 'Validation Error',
  BRANCH_REQUIRED: 'Branch ID is required',
  DELETE_FAILED: 'Failed to delete customer category',
  UPDATE_FAILED: 'Failed to update customer category',
  CREATE_FAILED: 'Failed to create customer category',
  IMPORT_FAILED: 'Failed to import customer categories',
  EXPORT_FAILED: 'Failed to export customer categories',
};

// Success messages
const SUCCESS_MESSAGES = {
  CATEGORY_CREATED: 'Customer category created',
  CATEGORY_UPDATED: 'Customer category updated',
  CATEGORY_DELETED: 'Customer category deleted',
  CATEGORIES_DELETED: 'Customer categories deleted',
  CATEGORIES_RETRIEVED: 'Customer categories retrieved',
  CATEGORY_RETRIEVED: 'Customer category retrieved',
  CATEGORIES_IMPORTED: 'Customer categories imported',
  CATEGORIES_EXPORTED: 'Customer categories exported',
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
  DESCRIPTION_MAX: 500,
};

// Validation patterns
const VALIDATION_PATTERNS = {
  NAME: /^[a-zA-Z0-9\s\-_]+$/,
};

module.exports = {
  DEFAULTS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
};
