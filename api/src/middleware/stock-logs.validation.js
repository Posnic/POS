const { body, param } = require('express-validator');
require('../constants/stock-logs.constants');

// Valid process types based on PHP implementation
const VALID_PROCESS_TYPES = [
  'Add',
  'Edit',
  'Delete',
  'Return',
  'PartialReturn',
  'Partial',
  'Receiving',
  'StockAdjustment',
];

// Valid action types
const VALID_ACTION_TYPES = ['Add', 'Subtract'];

const validateCreateStockLog = [
  body('view_item_id')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid item ID format'),
  body('item_name')
    .notEmpty()
    .withMessage('Item name is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Item name must be between 1 and 255 characters'),
  body('item_quantity')
    .notEmpty()
    .withMessage('Item quantity is required')
    .isNumeric()
    .withMessage('Item quantity must be a number'),
  body('process')
    .notEmpty()
    .withMessage('Process type is required')
    .isString()
    .trim()
    .isIn(VALID_PROCESS_TYPES)
    .withMessage(`Process must be one of: ${VALID_PROCESS_TYPES.join(', ')}`),
  body('action')
    .notEmpty()
    .withMessage('Action type is required')
    .isString()
    .trim()
    .isIn(VALID_ACTION_TYPES)
    .withMessage(`Action must be one of: ${VALID_ACTION_TYPES.join(', ')}`),
  body('reference').optional({ checkFalsy: true }).isString().trim(),
  body('opening_balance').optional({ checkFalsy: true }).isString(),
  body('closing_balance').optional({ checkFalsy: true }).isString(),
  body('count').optional({ checkFalsy: true }).isString(),
  body('changed_by').optional({ checkFalsy: true }).isString().trim(),
];

const validateUpdateItemName = [
  param('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid item ID format'),
  body('item_name')
    .notEmpty()
    .withMessage('New item name is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Item name must be between 1 and 255 characters'),
];

const validateCleanupLogs = [
  body('daysOld')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 365 })
    .withMessage('Days old must be between 1 and 365')
    .toInt(),
];

module.exports = {
  validateCreateStockLog,
  validateUpdateItemName,
  validateCleanupLogs,
  VALID_PROCESS_TYPES,
  VALID_ACTION_TYPES,
};
