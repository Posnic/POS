const { body, query, param } = require('express-validator');
const { FIELD_LIMITS, VALIDATION_PATTERNS } = require('../constants/customers.constants');

/**
 * Validation middleware for creating a customer
 */
const validateCreateCustomer = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Customer name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('customer_category')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Invalid category ID'),

  body('category_id').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid category ID'),

  body('category_name').optional({ checkFalsy: true }).trim(),

  body('customer_referrer_id')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Invalid referrer customer ID'),

  body('referrer_id')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Invalid referrer customer ID'),

  body('customer_referrer_name').optional({ checkFalsy: true }).trim(),

  body('referrer_name').optional({ checkFalsy: true }).trim(),

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

  body('gstin_number')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (value && value.length > 0) {
        if (!VALIDATION_PATTERNS.GST_NUMBER.test(value)) {
          throw new Error('Invalid GSTIN number format');
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

  body('tags').optional().isArray().withMessage('Tags must be an array'),

  body('partial_balance')
    .optional()
    .custom((value) => {
      // Accept boolean, 'on', 'off', '1', '0', 1, 0
      if (typeof value === 'boolean') return true;
      if (value === 'on' || value === 'off') return true;
      if (value === '1' || value === '0') return true;
      if (value === 1 || value === 0) return true;
      if (value === 'true' || value === 'false') return true;
      throw new Error('Partial balance must be a boolean value');
    }),

  body('balance').optional().isFloat({ min: 0 }).withMessage('Balance must be a positive number'),
];

/**
 * Validation middleware for updating a customer
 */
const validateUpdateCustomer = [
  param('id')
    .notEmpty()
    .withMessage('Customer ID is required')
    .isMongoId()
    .withMessage('Invalid customer ID format'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Customer name cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Customer name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
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
 * Validation middleware for customer ID parameter
 */
const validateCustomerId = [
  param('id')
    .notEmpty()
    .withMessage('Customer ID is required')
    .isMongoId()
    .withMessage('Invalid customer ID format'),
];

/**
 * Validation middleware for bulk delete
 */
const validateBulkDelete = [
  body('ids')
    .isArray({ min: 1 })
    .withMessage('At least one customer ID is required')
    .custom((ids) => {
      if (!ids.every((id) => /^[a-f\d]{24}$/i.test(id))) {
        throw new Error('Invalid customer ID format in array');
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
 * Validation middleware for loyalty points
 */
const validateLoyaltyPoints = [
  param('id')
    .notEmpty()
    .withMessage('Customer ID is required')
    .isMongoId()
    .withMessage('Invalid customer ID format'),

  body('points')
    .notEmpty()
    .withMessage('Points are required')
    .isInt({ min: 1 })
    .withMessage('Points must be a positive integer'),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Reason cannot exceed 200 characters'),
];

/**
 * Validation middleware for customer preferences
 */
const validatePreferences = [
  param('id')
    .notEmpty()
    .withMessage('Customer ID is required')
    .isMongoId()
    .withMessage('Invalid customer ID format'),

  body('preferences')
    .notEmpty()
    .withMessage('Preferences are required')
    .isObject()
    .withMessage('Preferences must be an object'),
];

/**
 * Validation middleware for customer import
 */
const validateImport = [
  body('customers')
    .isArray({ min: 1 })
    .withMessage('At least one customer is required for import')
    .custom((customers) => {
      if (!customers.every((c) => c.name)) {
        throw new Error('All customers must have a name');
      }
      return true;
    }),
];

module.exports = {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateCustomerId,
  validateBulkDelete,
  validateSearch,
  validateLoyaltyPoints,
  validatePreferences,
  validateImport,
};
