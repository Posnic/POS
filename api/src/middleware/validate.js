const {
  validationResult,
  body,
  param,
  query,
  header,
  cookie,
  check,
  checkSchema,
  oneOf,
} = require('express-validator');
const { AppError } = require('../utils/appError');

/**
 * Middleware to validate request data using express-validator
 * @param {Array} validations - Array of validation chains
 * @returns {Function} - Express middleware function
 */
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    // Format errors
    const errorMessages = errors.array().map((err) => ({
      field: err.param,
      message: err.msg,
    }));

    return next(new AppError('Validation failed', 400, errorMessages));
  };
};

// Common validation rules
const rules = {
  // User validation rules
  user: {
    create: [
      body('name').trim().notEmpty().withMessage('Name is required'),
      body('email').isEmail().withMessage('Please provide a valid email'),
      body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number'),
      body('passwordConfirm')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('Passwords do not match'),
    ],

    login: [
      body('email').isEmail().withMessage('Please provide a valid email'),
      body('password').exists().withMessage('Password is required'),
    ],

    update: [
      body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
      body('email').optional().isEmail().withMessage('Please provide a valid email'),
      body('currentPassword')
        .if(body('password').exists())
        .notEmpty()
        .withMessage('Current password is required when changing password'),
      body('password')
        .optional()
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number'),
      body('passwordConfirm')
        .if(body('password').exists())
        .custom((value, { req }) => value === req.body.password)
        .withMessage('Passwords do not match'),
    ],
  },

  // Password reset validation
  passwordReset: {
    request: [body('email').isEmail().withMessage('Please provide a valid email')],

    reset: [
      body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number'),
      body('passwordConfirm')
        .custom((value, { req }) => value === req.body.password)
        .withMessage('Passwords do not match'),
    ],
  },
};

module.exports = {
  validate,
  rules,
  // Re-export express-validator for direct use
  body,
  param,
  query,
  header,
  cookie,
  check,
  checkSchema,
  oneOf,
  validationResult,
};
