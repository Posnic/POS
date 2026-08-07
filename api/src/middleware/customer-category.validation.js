const { body, query, param } = require('express-validator');
const { FIELD_LIMITS } = require('../constants/customer-category.constants');

/**
 * Validation middleware for creating a customer category
 */
const validateCreateCustomerCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Customer category name is required')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Category name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),
];

/**
 * Validation middleware for updating a customer category
 */
const validateUpdateCustomerCategory = [
  param('id')
    .notEmpty()
    .withMessage('Customer category ID is required')
    .isMongoId()
    .withMessage('Invalid customer category ID format'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Customer category name cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Category name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),
];

/**
 * Validation middleware for customer category ID
 */
const validateCustomerCategoryId = [
  param('id')
    .notEmpty()
    .withMessage('Customer category ID is required')
    .isMongoId()
    .withMessage('Invalid customer category ID format'),
];

/**
 * Validation middleware for bulk delete
 */
const validateBulkDelete = [
  body('data')
    .isArray({ min: 1 })
    .withMessage('At least one customer category ID is required')
    .custom((value) => {
      if (!value.every((id) => typeof id === 'string' && id.length === 24)) {
        throw new Error('Invalid customer category ID format in array');
      }
      return true;
    }),
];

/**
 * Validation middleware for search
 */
const validateSearch = [
  query('page').optional().isInt().withMessage('Page must be an integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('search')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search term cannot exceed 100 characters'),
];

/**
 * Validation middleware for import
 */
const validateImport = [
  body('result')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Import data must be a non-empty array'),

  body('data').optional().isArray({ min: 1 }).withMessage('Import data must be a non-empty array'),
];

module.exports = {
  validateCreateCustomerCategory,
  validateUpdateCustomerCategory,
  validateCustomerCategoryId,
  validateBulkDelete,
  validateSearch,
  validateImport,
};
