/**
 * Variants Module Validation Middleware
 * Express-validator rules matching PHP GUMP validation
 */

const { body, query, param } = require('express-validator');
const { VALIDATION_RULES, ERROR_MESSAGES } = require('../constants/variants.constants');

/**
 * Validation for creating a new variant
 * Matches PHP validation: name => 'required|max_len,20|min_len,1'
 */
const createVariantValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.VARIANT_NAME_REQUIRED)
    .isLength({ min: VALIDATION_RULES.NAME.MIN_LENGTH, max: VALIDATION_RULES.NAME.MAX_LENGTH })
    .withMessage(
      `Variant name must be between ${VALIDATION_RULES.NAME.MIN_LENGTH} and ${VALIDATION_RULES.NAME.MAX_LENGTH} characters`
    ),

  body('product_type').optional().isArray().withMessage('Product type must be an array'),

  body('description').optional().trim(),
];

/**
 * Validation for updating a variant
 * Matches PHP validation: name => 'required|max_len,20|min_len,1'
 */
const updateVariantValidation = [
  param('id')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.VARIANT_ID_REQUIRED)
    .isMongoId()
    .withMessage(ERROR_MESSAGES.INVALID_VARIANT_ID),

  body('name')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.VARIANT_NAME_REQUIRED)
    .isLength({ min: VALIDATION_RULES.NAME.MIN_LENGTH, max: VALIDATION_RULES.NAME.MAX_LENGTH })
    .withMessage(
      `Variant name must be between ${VALIDATION_RULES.NAME.MIN_LENGTH} and ${VALIDATION_RULES.NAME.MAX_LENGTH} characters`
    ),

  body('product_type').optional().isArray().withMessage('Product type must be an array'),

  body('description').optional().trim(),
];

/**
 * Validation for getting a single variant by ID
 */
const getVariantByIdValidation = [
  param('id').optional().isMongoId().withMessage(ERROR_MESSAGES.INVALID_VARIANT_ID),

  query('id').optional().isMongoId().withMessage(ERROR_MESSAGES.INVALID_VARIANT_ID),
];

/**
 * Validation for deleting variants
 */
const deleteVariantsValidation = [
  body('data')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.UID_MISSING)
    .isArray()
    .withMessage('Data must be an array of IDs'),
];

/**
 * Validation for bulk delete
 */
const bulkDeleteValidation = [
  body('ids')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.NO_VARIANT_IDS_PROVIDED)
    .isArray()
    .withMessage('IDs must be an array'),
];

/**
 * Validation for export variants
 */
const exportVariantsValidation = [
  // Body can be an array or object with data property
  body()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      if (value && (Array.isArray(value.data) || typeof value.data === 'string')) return true;
      if (typeof value === 'string') return true;
      if (value && Object.keys(value).length > 0) return true;
      return false;
    })
    .withMessage(ERROR_MESSAGES.NO_VARIANTS_SELECTED),
];

/**
 * Validation for search query
 */
const searchValidation = [
  query('q')
    .trim()
    .notEmpty()
    .withMessage('Search query is required')
    .isLength({ min: VALIDATION_RULES.SEARCH_QUERY.MIN_LENGTH })
    .withMessage(ERROR_MESSAGES.SEARCH_QUERY_TOO_SHORT),

  query('limit').optional().isInt().withMessage('Limit must be an integer'),
];

/**
 * Validation for pagination and filtering
 * Note: Page and limit validation is lenient to match PHP behavior
 * Service layer normalizes invalid values (e.g., page=-1 becomes page=1)
 */
const getPaginatedVariantsValidation = [
  query('page').optional().isInt().withMessage('Page must be an integer'),

  query('limit').optional().isInt().withMessage('Limit must be an integer'),

  query('sort').optional().trim(),

  query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be either asc or desc'),

  query('filters')
    .optional()
    .custom((value) => {
      if (typeof value === 'object') return true;
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    })
    .withMessage(ERROR_MESSAGES.INCORRECT_FILTER_FORMAT),
];

/**
 * Validation for getVariantsAjaxList
 */
const getVariantsAjaxListValidation = [query('query').optional().trim()];

/**
 * Validation for getByField
 */
const getByFieldValidation = [
  param('field').notEmpty().withMessage('Field parameter is required').trim(),
];

module.exports = {
  createVariantValidation,
  updateVariantValidation,
  getVariantByIdValidation,
  deleteVariantsValidation,
  bulkDeleteValidation,
  exportVariantsValidation,
  searchValidation,
  getPaginatedVariantsValidation,
  getVariantsAjaxListValidation,
  getByFieldValidation,
};
