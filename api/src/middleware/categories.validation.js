const { body, query, param } = require('express-validator');
const { FIELD_LIMITS, VALIDATION_PATTERNS } = require('../constants/categories.constants');

/**
 * Validation middleware for creating a category
 */
const validateCreateCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Category name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    )
    .matches(VALIDATION_PATTERNS.NAME)
    .withMessage('Category name contains invalid characters'),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),

  body('image')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.IMAGE_MAX })
    .withMessage(`Image path cannot exceed ${FIELD_LIMITS.IMAGE_MAX} characters`),

  body('discount_amount')
    .optional()
    .isFloat({ min: FIELD_LIMITS.DISCOUNT_MIN })
    .withMessage('Discount amount must be a positive number'),

  body('discount_percentage')
    .optional()
    .isFloat({ min: FIELD_LIMITS.DISCOUNT_MIN, max: FIELD_LIMITS.DISCOUNT_MAX })
    .withMessage(
      `Discount percentage must be between ${FIELD_LIMITS.DISCOUNT_MIN} and ${FIELD_LIMITS.DISCOUNT_MAX}`
    ),

  body('is_active').optional().isBoolean().withMessage('is_active must be a boolean value'),

  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Sort order must be a positive integer'),
];

/**
 * Validation middleware for updating a category
 */
const validateUpdateCategory = [
  param('id')
    .notEmpty()
    .withMessage('Category ID is required')
    .isMongoId()
    .withMessage('Invalid category ID format'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Category name cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Category name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    )
    .matches(VALIDATION_PATTERNS.NAME)
    .withMessage('Category name contains invalid characters'),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),

  body('discount_amount')
    .optional()
    .isFloat({ min: FIELD_LIMITS.DISCOUNT_MIN })
    .withMessage('Discount amount must be a positive number'),

  body('discount_percentage')
    .optional()
    .isFloat({ min: FIELD_LIMITS.DISCOUNT_MIN, max: FIELD_LIMITS.DISCOUNT_MAX })
    .withMessage(
      `Discount percentage must be between ${FIELD_LIMITS.DISCOUNT_MIN} and ${FIELD_LIMITS.DISCOUNT_MAX}`
    ),

  body('is_active').optional().isBoolean().withMessage('is_active must be a boolean value'),
];

/**
 * Validation middleware for category ID parameter
 */
const validateCategoryId = [
  param('id')
    .notEmpty()
    .withMessage('Category ID is required')
    .isMongoId()
    .withMessage('Invalid category ID format'),
];

/**
 * Validation middleware for bulk delete
 */
const validateBulkDelete = [
  body('ids')
    .isArray({ min: 1 })
    .withMessage('At least one category ID is required')
    .custom((ids) => {
      if (!ids.every((id) => /^[a-f\d]{24}$/i.test(id))) {
        throw new Error('Invalid category ID format in array');
      }
      return true;
    }),
];

/**
 * Validation middleware for search
 */
const validateSearch = [
  query('q').optional().trim().isLength({ min: 1 }).withMessage('Search query must not be empty'),

  query('search')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Search query must not be empty'),

  query('page').optional().isInt().withMessage('Page must be an integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('status')
    .optional()
    .isIn(['all', 'active', 'inactive'])
    .withMessage('Status must be all, active, or inactive'),
];

/**
 * Validation middleware for category import
 */
const validateImport = [
  body('categories')
    .isArray({ min: 1 })
    .withMessage('At least one category is required for import')
    .custom((categories) => {
      if (!categories.every((c) => c.name)) {
        throw new Error('All categories must have a name');
      }
      return true;
    }),
];

module.exports = {
  validateCreateCategory,
  validateUpdateCategory,
  validateCategoryId,
  validateBulkDelete,
  validateSearch,
  validateImport,
};
