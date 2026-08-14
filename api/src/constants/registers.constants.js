/**
 * Register Module Constants
 * Centralized constants for register-related operations
 */

// Register statuses persisted in DB
const REGISTER_STATUS = {
  OPENED: 'Opened',
  CLOSED: 'Closed',
};

// Error messages
const ERROR_MESSAGES = {
  DOCUMENT_NOT_FOUND: 'Document Not Found',
  REGISTER_NOT_FOUND: 'Register Not Found',
  REGISTER_NOT_OPENED: 'Register is not opened',
  INVALID_REGISTER_ID: 'Invalid register ID',
  FAILED_FETCH_REGISTER_REPORT: 'Failed to fetch register report',
  FAILED_FETCH_REGISTER_SALE_DETAILS: 'Failed to fetch register sale details',
  NOT_VALID_INPUT: 'Not valid Input',
  UNAUTHORIZED: 'Unauthorized',
  SALES_DETAILS_NOT_FOUND: 'Sales Details Not Found',
  REGISTER_SESSION_LOCKED: 'This register is already open on another device or by another user',
};

// Success messages
const SUCCESS_MESSAGES = {
  REGISTER_OPENED: 'Register opened',
  REGISTER_CLOSED: 'Register closed',
  REGISTER_FETCHED: 'Register retrieved',
  REGISTER_CASHDETAIL_UPDATED: 'Cash details updated',
  REGISTER_CASH_ENTRY_DELETED: 'Cash In/Out entry deleted',
  PAYMENT_NOTE_UPDATED: 'Payment note updated',
  AMOUNT_UPDATED: 'Amount updated',
  CASH_ADDED: 'Cash added',
  CHANGES_RETRIEVED: 'Changes Retrieved',
  REGISTER_REPORT_DETAILS_RETRIEVED: 'Register report details retrieved',
  DELETE_SUCCESS: 'Deleted',
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

// Field limits for basic validation (kept conservative for now)
const FIELD_LIMITS = {
  REGISTER_NAME_MIN: 1,
  REGISTER_NAME_MAX: 200,
};

module.exports = {
  REGISTER_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
};
