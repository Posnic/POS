const { body, param } = require('express-validator');
const { ObjectId } = require('mongodb');
const { FIELD_LIMITS, ERROR_MESSAGES } = require('../constants/items.constants');

/**
 * Validation middleware for creating an item
 * Applied to the modern POST /items endpoint (ItemsController.add)
 */
const validateCreateItem = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.ITEM_NAME_REQUIRED)
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Item name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('selling_price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a positive number'),

  body('company_price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Company price must be a positive number'),

  body('available_quantity')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Available quantity must be a non-negative number'),

  body('barcode_id')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.BARCODE_MAX })
    .withMessage(`Barcode cannot exceed ${FIELD_LIMITS.BARCODE_MAX} characters`),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),
];

/**
 * Validation middleware for updating an item
 * Applied to the modern PUT /items/:id endpoint (ItemsController.edit)
 */
const validateUpdateItem = [
  param('id')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.ITEM_ID_REQUIRED)
    .isMongoId()
    .withMessage('Invalid item ID format'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Item name cannot be empty')
    .isLength({ min: FIELD_LIMITS.NAME_MIN, max: FIELD_LIMITS.NAME_MAX })
    .withMessage(
      `Item name must be between ${FIELD_LIMITS.NAME_MIN} and ${FIELD_LIMITS.NAME_MAX} characters`
    ),

  body('selling_price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a positive number'),

  body('company_price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Company price must be a positive number'),

  body('available_quantity')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Available quantity must be a non-negative number'),

  body('barcode_id')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.BARCODE_MAX })
    .withMessage(`Barcode cannot exceed ${FIELD_LIMITS.BARCODE_MAX} characters`),

  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.DESCRIPTION_MAX })
    .withMessage(`Description cannot exceed ${FIELD_LIMITS.DESCRIPTION_MAX} characters`),
];

const ensureValidItemIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    return next('route');
  }
  return next();
};

/**
 * A waiter saying a dish has run out for tonight.
 *
 * Small on purpose: which dish, whether it is off or back, and which shop's
 * menu is being changed. Declaring it here is not only runtime safety - the
 * API document is generated from these rules, so an endpoint with no
 * validation is an endpoint nobody reading the docs can call correctly.
 */
const validateSoldOut = [
  body('item')
    .notEmpty()
    .withMessage('Which dish has run out?')
    .isMongoId()
    .withMessage('Invalid item ID format'),

  /* Absent means "it has run out". Only an explicit false puts it back, so a
     body that loses a field cannot quietly restock the kitchen. */
  body('off').optional().isBoolean().withMessage('off must be true or false'),

  body('branch').optional().isMongoId().withMessage('Invalid branch ID format'),
];

module.exports = {
  validateCreateItem,
  validateSoldOut,
  validateUpdateItem,
  ensureValidItemIdParam,
};
