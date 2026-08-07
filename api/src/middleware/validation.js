const { body, param, validationResult } = require('express-validator');

/**
 * Generic validation error handler middleware
 * Used after express-validator validation arrays
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      type: 'error',
      message: 'Validation failed',
      data: errors.array(),
    });
  }
  next();
};

// Validation middleware for expense creation/update
const validateExpense = [
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a number')
    .isFloat({ min: 0 })
    .withMessage('Amount must be a positive number'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ max: 255 })
    .withMessage('Description must be less than 255 characters'),
  body('date')
    .optional({ checkFalsy: true })
    // Accept legacy UI date strings; we normalize on the server side
    .isString()
    .withMessage('Date must be a string'),
  body('category')
    .optional()
    .isString()
    .withMessage('Category must be a string')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Category must be less than 100 characters'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        type: 'error',
        message: 'Validation failed',
        data: errors.array(),
      });
    }
    next();
  },
];

// Validation middleware for ID parameters
const validateId = [
  param('id').isMongoId().withMessage('Invalid ID format'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        type: 'error',
        message: 'Validation failed',
        data: errors.array(),
      });
    }
    next();
  },
];

// Validation middleware for category creation/update
const validateCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ min: 3, max: 250 })
    .withMessage('Name must be between 3 and 250 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),

  body('discount_amount')
    .optional()
    .isLength({ max: 10 })
    .withMessage('Discount amount must be less than 10 characters'),

  body('discount_percentage')
    .optional()
    .isLength({ max: 10 })
    .withMessage('Discount percentage must be less than 10 characters'),

  body('is_active').optional().isBoolean().withMessage('Active status must be a boolean'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        type: 'error',
        message: 'Validation failed',
        data: errors.array(),
      });
    }
    next();
  },
];

// Validation middleware for customer category creation/update
const validateCustomerCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('The Name field is required')
    .isLength({ min: 3, max: 250 })
    .withMessage('The Name field needs to be between 3 and 250 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('The Description field needs to be 500 characters or less'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Format errors to match PHP GUMP readable errors format
      const readableErrors = errors.array().map((err) => err.msg);
      return res.status(400).json({
        type: 'error',
        message: 'Validation Error',
        data: readableErrors,
      });
    }
    next();
  },
];

module.exports = {
  handleValidationErrors,
  validateExpense,
  validateId,
  validateCategory,
  validateCustomerCategory,
};
