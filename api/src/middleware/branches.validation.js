const { body, validationResult } = require('express-validator');

const validateBranch = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('The Name field is required')
    .isLength({ min: 3, max: 250 })
    .withMessage('The Name field needs to be between 3 and 250 characters in length'),

  body('phone')
    .trim()
    .notEmpty()
    .withMessage('The Phone field is required')
    .isLength({ min: 3, max: 20 })
    .withMessage('The Phone field needs to be between 3 and 20 characters in length'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('The Email field is required')
    .isEmail()
    .withMessage('The Email field needs to contain a valid email address'),

  body('address')
    .trim()
    .notEmpty()
    .withMessage('The Address field is required')
    .isLength({ min: 3, max: 500 })
    .withMessage('The Address field needs to be between 3 and 500 characters in length'),

  body('country').trim().notEmpty().withMessage('The Country field is required'),

  body('state').trim().notEmpty().withMessage('The State field is required'),
];

const validateBranchUpdate = [
  body('name')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 250 })
    .withMessage('The Name field needs to be between 3 and 250 characters in length'),

  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('The Phone field needs to be between 3 and 20 characters in length'),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('The Email field needs to contain a valid email address'),

  body('address')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('The Address field needs to be between 3 and 500 characters in length'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const readableErrors = errors.array().map((err) => err.msg);

    return res.status(400).json({
      type: 'error',
      message: 'Validation Error',
      data: readableErrors,
    });
  }

  next();
};

module.exports = {
  validateBranch,
  validateBranchUpdate,
  handleValidationErrors,
};
