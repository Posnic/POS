/**
 * Variants Module Constants
 * Centralized constants for variants module following best practices
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  INTERNAL_SERVER_ERROR: 500,
};

// Response Types
const RESPONSE_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
};

// Success Messages
const SUCCESS_MESSAGES = {
  VARIANT_RETRIEVED: 'Variant retrieved',
  VARIANTS_RETRIEVED: 'Variants retrieved',
  VARIANT_CREATED: 'variant added',
  VARIANT_UPDATED: 'variant updated',
  VARIANT_DELETED: 'Variant deleted',
  VARIANTS_DELETED: 'variant deleted',
  VARIANTS_EXPORTED: 'Variants Exported',
  VARIANT_DETAILS_RETRIEVED: 'Variant details retrieved',
  SEARCH_RESULTS_RETRIEVED: 'Search results retrieved',
  VARIANT_STATS_RETRIEVED: 'Variant statistics retrieved',
};

// Error Messages
const ERROR_MESSAGES = {
  VARIANT_NOT_FOUND: 'Variant not found',
  VARIANT_ID_REQUIRED: 'Variant Id is mandatory',
  VARIANT_ID_NOT_FOUND: 'Variant Id Not Found',
  VARIANT_NAME_REQUIRED: 'Variant name is required',
  VARIANT_VALUE_REQUIRED: 'At least one variant value is required',
  VARIANT_EXISTS: 'This variant already exists',
  VARIANT_RETRIEVE_FAILED: 'Failed to retrieve variants. Please try again later.',
  VARIANT_LOAD_FAILED: 'Unable to load variant. Please try again later.',
  VARIANT_DETAILS_LOAD_FAILED: 'Unable to load variant details. Please try again later.',
  VARIANT_CREATE_FAILED: 'Failed to create variant. Please try again later.',
  VARIANT_UPDATE_FAILED: 'Failed to update variant. Please try again later.',
  VARIANT_DELETE_FAILED: 'Failed to delete variant. Please try again later.',
  VARIANTS_DELETE_FAILED: 'Failed to delete variants.',
  VARIANTS_EXPORT_FAILED: 'Failed to export variants. Please try again later.',
  VARIANTS_SEARCH_FAILED: 'Failed to search variants.',
  VARIANT_STATS_FAILED: 'Failed to retrieve variant statistics.',
  VARIANTS_BY_FIELD_FAILED: 'Failed to retrieve variants by field.',
  VARIANT_NOT_DELETED: 'variant Not deleted',
  VALIDATION_FAILED: 'Validation failed',
  INCORRECT_FILTER_FORMAT: 'Incorrect format of filter',
  INVALID_VARIANT_ID: 'Invalid variant ID',
  INVALID_ID_FORMAT: 'Invalid ID format',
  UID_MISSING: 'UID is missing',
  NO_VARIANTS_SELECTED: 'No variants selected for export',
  NO_VARIANT_IDS_PROVIDED: 'No variant IDs provided',
  SEARCH_QUERY_TOO_SHORT: 'Search query must be at least 2 characters',
  UNAUTHORIZED: 'Unauthorized',
  WRONG_REQUEST: 'Wrong request',
  DETAILS_NOT_FOUND: 'Details Not Found',
  VARIANT_SUGGESTIONS_FAILED: 'Failed to load variant suggestions.',
};

// Validation Rules (matching PHP GUMP validation)
const VALIDATION_RULES = {
  NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 20,
  },
  SEARCH_QUERY: {
    MIN_LENGTH: 2,
  },
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 5,
    DEFAULT_SORT: '_id',
    DEFAULT_ORDER: 'desc',
  },
  AJAX_LIST: {
    MAX_RESULTS: 20,
  },
};

// Collection Name
const COLLECTION_NAME = 'variants';

// Field Names
const FIELD_NAMES = {
  ID: '_id',
  BRANCH_ID: 'branch_id',
  BRANCH_NAME: 'branch_name',
  NAME: 'name',
  FIELDS: 'fields',
  PRODUCT_TYPE: 'product_type',
  DESCRIPTION: 'description',
  CREATED_DATE: 'created_date',
  UPDATED_DATE: 'updated_date',
  CREATED_BY_ID: 'created_by_id',
  CREATED_BY: 'created_by',
  UPDATED_BY_ID: 'updated_by_id',
  UPDATED_BY: 'updated_by',
  LICENSE: 'license',
};

// Export Fields
const EXPORT_FIELDS = {
  NAME: 'name',
  FIELDS: 'fields',
  DESCRIPTION: 'description',
};

// Default Values
const DEFAULT_VALUES = {
  DESCRIPTION: '',
  FIELDS: [],
};

module.exports = {
  HTTP_STATUS,
  RESPONSE_TYPES,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
  VALIDATION_RULES,
  COLLECTION_NAME,
  FIELD_NAMES,
  EXPORT_FIELDS,
  DEFAULT_VALUES,
};
