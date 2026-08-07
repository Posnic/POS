const { body, query, param } = require('express-validator');
const { FIELD_LIMITS } = require('../constants/receivings.constants');

/**
 * Validation middleware for creating a receiving
 */
const validateCreateReceiving = [
  body('supplier_name')
    .trim()
    .notEmpty()
    .withMessage('Supplier name is required')
    .isLength({ min: FIELD_LIMITS.SUPPLIER_NAME_MIN, max: FIELD_LIMITS.SUPPLIER_NAME_MAX })
    .withMessage(
      `Supplier name must be between ${FIELD_LIMITS.SUPPLIER_NAME_MIN} and ${FIELD_LIMITS.SUPPLIER_NAME_MAX} characters`
    ),

  body('supplier').optional().isMongoId().withMessage('Invalid supplier ID'),

  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required')
    .custom((items) => {
      if (items.length > FIELD_LIMITS.MAX_ITEMS) {
        throw new Error(`Cannot exceed ${FIELD_LIMITS.MAX_ITEMS} items`);
      }
      return true;
    }),

  body('items.*.item')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid item ID'),

  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),

  body('items.*.cost_price')
    .isFloat({ min: 0 })
    .withMessage('Cost price must be a positive number'),

  body('items.*.selling_price')
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a positive number'),

  body('subtotal').isFloat({ min: 0 }).withMessage('Subtotal must be a positive number'),

  body('total').isFloat({ min: 0 }).withMessage('Total must be a positive number'),

  body('tax').optional().isFloat({ min: 0 }).withMessage('Tax must be a positive number'),

  body('discount').optional().isFloat({ min: 0 }).withMessage('Discount must be a positive number'),

  body('payment_method')
    .optional()
    .isIn(['cash', 'credit', 'bank_transfer', 'cheque', 'other'])
    .withMessage('Invalid payment method'),

  body('payment_status')
    .optional()
    .isIn(['pending', 'partial', 'paid'])
    .withMessage('Invalid payment status'),

  body('status').optional().isIn(['draft', 'received', 'cancelled']).withMessage('Invalid status'),

  body('notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: FIELD_LIMITS.NOTES_MAX })
    .withMessage(`Notes cannot exceed ${FIELD_LIMITS.NOTES_MAX} characters`),
];

/**
 * Validation middleware for updating a receiving
 */
const validateUpdateReceiving = [
  param('id')
    .notEmpty()
    .withMessage('Receiving ID is required')
    .isMongoId()
    .withMessage('Invalid receiving ID'),

  body('supplier_name')
    .optional()
    .trim()
    .isLength({ min: FIELD_LIMITS.SUPPLIER_NAME_MIN, max: FIELD_LIMITS.SUPPLIER_NAME_MAX })
    .withMessage(
      `Supplier name must be between ${FIELD_LIMITS.SUPPLIER_NAME_MIN} and ${FIELD_LIMITS.SUPPLIER_NAME_MAX} characters`
    ),

  body('items')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one item is required if items are provided'),

  body('subtotal').optional().isFloat({ min: 0 }).withMessage('Subtotal must be a positive number'),

  body('total').optional().isFloat({ min: 0 }).withMessage('Total must be a positive number'),

  body('tax').optional().isFloat({ min: 0 }).withMessage('Tax must be a positive number'),

  body('discount').optional().isFloat({ min: 0 }).withMessage('Discount must be a positive number'),

  body('payment_method')
    .optional()
    .isIn(['cash', 'credit', 'bank_transfer', 'cheque', 'other'])
    .withMessage('Invalid payment method'),

  body('payment_status')
    .optional()
    .isIn(['pending', 'partial', 'paid'])
    .withMessage('Invalid payment status'),

  body('status').optional().isIn(['draft', 'received', 'cancelled']).withMessage('Invalid status'),
];

/**
 * Validation middleware for getting a receiving by ID
 */
const validateGetReceiving = [
  param('id')
    .notEmpty()
    .withMessage('Receiving ID is required')
    .isMongoId()
    .withMessage('Invalid receiving ID'),
];

/**
 * Validation middleware for deleting receivings
 */
const validateDeleteReceivings = [
  body('data').optional().isArray({ min: 1 }).withMessage('At least one receiving ID is required'),

  body('ids').optional().isArray({ min: 1 }).withMessage('At least one receiving ID is required'),
];

/**
 * Validation middleware for receiving list filters
 */
const validateReceivingFilters = [
  query('page').optional().isInt().withMessage('Page must be an integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('status').optional().isIn(['draft', 'received', 'cancelled']).withMessage('Invalid status'),

  query('payment_status')
    .optional()
    .isIn(['pending', 'partial', 'paid'])
    .withMessage('Invalid payment status'),
];

/**
 * Validation middleware for uploading receiving images
 */
const validateUploadImage = [
  body('receiving_image')
    .isArray({ min: 1 })
    .withMessage('At least one image is required')
    .custom((images) => {
      if (images.length > FIELD_LIMITS.MAX_IMAGES) {
        throw new Error(`Cannot upload more than ${FIELD_LIMITS.MAX_IMAGES} images`);
      }
      return true;
    }),

  body('receiving_image.*.name').notEmpty().withMessage('Image name is required'),

  body('receiving_image.*.data').notEmpty().withMessage('Image data is required'),

  body('receiving_image.*.size')
    .isInt({ min: 1, max: FIELD_LIMITS.MAX_IMAGE_SIZE })
    .withMessage(
      `Image size must be between 1 byte and ${FIELD_LIMITS.MAX_IMAGE_SIZE} bytes (5MB)`
    ),
];

module.exports = {
  validateCreateReceiving,
  validateUpdateReceiving,
  validateGetReceiving,
  validateDeleteReceivings,
  validateReceivingFilters,
  validateUploadImage,
};
