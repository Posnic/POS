/**
 * Receiving Module Constants
 * Centralized constants for receiving/purchase order operations
 */

// Default values
const DEFAULTS = {
  STATUS: 'draft',
  RECEIVING_STATUS: 'Open',
  PAYMENT_STATUS: 'pending',
  PAYMENT_METHOD: 'cash',
  TAX: 0,
  DISCOUNT: 0,
  SUBTOTAL: 0,
  TOTAL: 0,
  PREFIX: 'RID',
};

// Receiving statuses
const RECEIVING_STATUS = {
  OPEN: 'Open',
  RECEIVED: 'Received',
  PARTIAL_RETURN: 'PartialReturn',
  FULL_RETURN: 'FullReturn',
  CANCELLED: 'Cancelled',
};

// Internal status (for processing)
const STATUS = {
  DRAFT: 'draft',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

// Payment statuses
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  PAID: 'paid',
};

// Payment methods
const PAYMENT_METHOD = {
  CASH: 'cash',
  CREDIT: 'credit',
  BANK_TRANSFER: 'bank_transfer',
  CHEQUE: 'cheque',
  OTHER: 'other',
};

// Error messages
const ERROR_MESSAGES = {
  RECEIVING_NOT_FOUND: 'Receiving not found',
  SUPPLIER_REQUIRED: 'Supplier is required',
  ITEMS_REQUIRED: 'At least one item is required',
  INVALID_QUANTITY: 'Invalid quantity',
  INVALID_PRICE: 'Invalid price',
  VALIDATION_ERROR: 'Validation Error',
  BRANCH_REQUIRED: 'Branch ID is required',
  DELETE_FAILED: 'Failed to delete receiving',
  UPDATE_FAILED: 'Failed to update receiving',
  CREATE_FAILED: 'Failed to create receiving',
  ALREADY_RECEIVED: 'This receiving is already marked as received',
  CANNOT_MODIFY_RECEIVED: 'Cannot modify received receiving',
};

// Success messages
const SUCCESS_MESSAGES = {
  RECEIVING_CREATED: 'Receiving created',
  RECEIVING_UPDATED: 'Receiving updated',
  RECEIVING_DELETED: 'Receiving deleted',
  RECEIVINGS_DELETED: 'Receivings deleted',
  RECEIVINGS_RETRIEVED: 'Receivings retrieved',
  RECEIVING_RETRIEVED: 'Receiving retrieved',
  RECEIVING_RECEIVED: 'Receiving marked as received',
  RETURN_PROCESSED: 'Return processed',
  IMAGE_UPLOADED: 'Image uploaded',
  RECEIVINGS_EXPORTED: 'Receivings exported',
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
  SUPPLIER_NAME_MIN: 3,
  SUPPLIER_NAME_MAX: 200,
  NOTES_MAX: 1000,
  RECEIVING_ID_LENGTH: 9, // RID + 6 digits
  MAX_ITEMS: 1000,
  MAX_IMAGE_SIZE: 5242880, // 5MB
  MAX_IMAGES: 10,
};

// Validation patterns
const VALIDATION_PATTERNS = {
  RECEIVING_ID: /^[A-Z]{3}\d{6}$/,
  POSITIVE_NUMBER: /^\d+(\.\d{1,2})?$/,
};

// Allowed image extensions
const ALLOWED_IMAGE_EXTENSIONS = ['gif', 'jpg', 'png', 'jpeg', 'bmp', 'pdf'];

module.exports = {
  DEFAULTS,
  RECEIVING_STATUS,
  STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
  ALLOWED_IMAGE_EXTENSIONS,
};
