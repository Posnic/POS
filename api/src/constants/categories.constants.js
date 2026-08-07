/**
 * Category Module Constants
 * Centralized constants for category-related operations
 */

// Default values
const DEFAULTS = {
  IMAGE: 'category.svg',
  DISCOUNT_AMOUNT: 0,
  DISCOUNT_PERCENTAGE: 0,
  IS_ACTIVE: true,
  DESCRIPTION: '',
  SORT_ORDER: 0,
};

// Category statuses
const CATEGORY_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
};

// Error messages
const ERROR_MESSAGES = {
  CATEGORY_NOT_FOUND: 'Category not found',
  CATEGORY_NAME_REQUIRED: 'Category name is required',
  NAME_EXISTS: 'Category with this name already exists',
  INVALID_DISCOUNT: 'Invalid discount value',
  VALIDATION_ERROR: 'Validation Error',
  BRANCH_REQUIRED: 'Branch ID is required',
  DELETE_FAILED: 'Failed to delete category',
  UPDATE_FAILED: 'Failed to update category',
  CREATE_FAILED: 'Failed to create category',
  CANNOT_DELETE_WITH_ITEMS: 'Cannot delete category with associated items',
};

// Success messages
const SUCCESS_MESSAGES = {
  CATEGORY_CREATED: 'Category created successfully',
  CATEGORY_UPDATED: 'Category updated successfully',
  CATEGORY_DELETED: 'Category deleted successfully',
  CATEGORIES_DELETED: 'Categories deleted successfully',
  CATEGORIES_RETRIEVED: 'Categories retrieved successfully',
  CATEGORY_RETRIEVED: 'Category retrieved successfully',
  CATEGORIES_IMPORTED: 'Categories imported successfully',
  CATEGORIES_EXPORTED: 'Categories exported successfully',
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
  IMAGE_MAX: 255,
  DISCOUNT_MIN: 0,
  DISCOUNT_MAX: 100,
};

// Validation patterns
const VALIDATION_PATTERNS = {
  NAME: /^[a-zA-Z0-9\s\-_&()]+$/,
  IMAGE_URL: /^[a-zA-Z0-9\-_./]+$/,
};

module.exports = {
  DEFAULTS,
  CATEGORY_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
};
