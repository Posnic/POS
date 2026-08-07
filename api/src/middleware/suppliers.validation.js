const { body, query, param } = require('express-validator');
const { FIELD_LIMITS, VALIDATION_PATTERNS } = require('../constants/suppliers.constants');

/**
 * Validation middleware for creating a supplier
 */
const validateCreateSupplier = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Supplier name is required')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Supplier name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('company_name')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.COMPANY_NAME_MAX })
    .withMessage(`Company name cannot exceed ${FIELD_LIMITS.COMPANY_NAME_MAX} characters`),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('Invalid email address')
    .isLength({ max: FIELD_LIMITS.EMAIL_MAX })
    .withMessage(`Email cannot exceed ${FIELD_LIMITS.EMAIL_MAX} characters`)
    .matches(VALIDATION_PATTERNS.EMAIL)
    .withMessage('Invalid email format'),

  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(VALIDATION_PATTERNS.PHONE)
    .withMessage('Invalid phone number format'),

  body('alternatePhone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(VALIDATION_PATTERNS.PHONE)
    .withMessage('Invalid alternate phone number format'),

  body('gst_number')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (value && value.length > 0) {
        if (!VALIDATION_PATTERNS.GST_NUMBER.test(value)) {
          throw new Error('Invalid GST number format');
        }
      }
      return true;
    }),

  body('pincode')
    .optional({ checkFalsy: true })
    .trim()
    .matches(VALIDATION_PATTERNS.PINCODE)
    .withMessage('Invalid pincode format'),

  body('address')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.ADDRESS_MAX })
    .withMessage(`Address cannot exceed ${FIELD_LIMITS.ADDRESS_MAX} characters`),

  body('notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.NOTES_MAX })
    .withMessage(`Notes cannot exceed ${FIELD_LIMITS.NOTES_MAX} characters`),

  body('credit_limit')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Credit limit must be a positive number'),

  body('balance').optional().isFloat().withMessage('Balance must be a valid number'),
];

/**
 * Validation middleware for updating a supplier
 */
const validateUpdateSupplier = [
  param('id')
    .notEmpty()
    .withMessage('Supplier ID is required')
    .isMongoId()
    .withMessage('Invalid supplier ID format'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Supplier name cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Supplier name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('Invalid email address')
    .isLength({ max: FIELD_LIMITS.EMAIL_MAX })
    .withMessage(`Email cannot exceed ${FIELD_LIMITS.EMAIL_MAX} characters`),

  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(VALIDATION_PATTERNS.PHONE)
    .withMessage('Invalid phone number format'),

  body('gst_number')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (value && value.length > 0) {
        if (!VALIDATION_PATTERNS.GST_NUMBER.test(value)) {
          throw new Error('Invalid GST number format');
        }
      }
      return true;
    }),
];

/**
 * Validation middleware for supplier ID parameter
 */
const validateSupplierId = [
  param('id')
    .notEmpty()
    .withMessage('Supplier ID is required')
    .isMongoId()
    .withMessage('Invalid supplier ID format'),
];

/**
 * Validation middleware for bulk delete
 */
const validateBulkDelete = [
  body('ids')
    .isArray({ min: 1 })
    .withMessage('At least one supplier ID is required')
    .custom((ids) => {
      if (!ids.every((id) => /^[a-f\d]{24}$/i.test(id))) {
        throw new Error('Invalid supplier ID format in array');
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
];

/**
 * Validation middleware for supplier preferences
 */
const validatePreferences = [
  param('id')
    .notEmpty()
    .withMessage('Supplier ID is required')
    .isMongoId()
    .withMessage('Invalid supplier ID format'),

  body('preferences')
    .notEmpty()
    .withMessage('Preferences are required')
    .isObject()
    .withMessage('Preferences must be an object'),
];

/**
 * Validation middleware for supplier import
 */
const validateImport = [
  body('suppliers')
    .isArray({ min: 1 })
    .withMessage('At least one supplier is required for import')
    .custom((suppliers) => {
      if (!suppliers.every((s) => s.name)) {
        throw new Error('All suppliers must have a name');
      }
      return true;
    }),
];

module.exports = {
  validateCreateSupplier,
  validateUpdateSupplier,
  validateSupplierId,
  validateBulkDelete,
  validateSearch,
  validatePreferences,
  validateImport,
};
