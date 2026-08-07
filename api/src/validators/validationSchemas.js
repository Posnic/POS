const { body, param, query } = require('express-validator');

// Common validation rules
const commonValidators = {
  idParam: param('id')
    .trim()
    .notEmpty()
    .withMessage('ID is required')
    .isMongoId()
    .withMessage('Invalid ID format'),

  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
  ],
};

// User validation rules
const userValidators = {
  createUser: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2 and 50 characters'),
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
  ],
  updateUser: [
    param('id')
      .notEmpty()
      .withMessage('User ID is required')
      .isMongoId()
      .withMessage('Invalid user ID'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2 and 50 characters'),
    body('email').optional().trim().isEmail().withMessage('Invalid email format').normalizeEmail(),
  ],
};

// Branch validation rules
const branchValidators = {
  createBranch: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Branch name is required')
      .isLength({ min: 2, max: 100 })
      .withMessage('Branch name must be between 2 and 100 characters'),
    body('address').trim().notEmpty().withMessage('Address is required'),
  ],
  updateBranch: [
    param('id')
      .notEmpty()
      .withMessage('Branch ID is required')
      .isMongoId()
      .withMessage('Invalid branch ID'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Branch name must be between 2 and 100 characters'),
    body('address').optional().trim(),
  ],
};

// Category validation rules
const categoryValidators = {
  createCategory: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Category name is required')
      .isLength({ min: 2, max: 50 })
      .withMessage('Category name must be between 2 and 50 characters'),
    body('description').optional().trim(),
  ],
  updateCategory: [
    param('id')
      .notEmpty()
      .withMessage('Category ID is required')
      .isMongoId()
      .withMessage('Invalid category ID'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Category name must be between 2 and 50 characters'),
    body('description').optional().trim(),
  ],
};

module.exports = {
  ...commonValidators,
  ...userValidators,
  ...branchValidators,
  ...categoryValidators,
};
