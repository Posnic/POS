const { body, query, validationResult } = require('express-validator');

const validateUser = [
  body('firstname')
    .if(body('usertype').not().equals('api'))
    .trim()
    .notEmpty()
    .withMessage('The Firstname field is required')
    .isLength({ min: 3, max: 20 })
    .withMessage('The Firstname field needs to be between 3 and 20 characters in length'),

  body('lastname')
    .if(body('usertype').not().equals('api'))
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('The Lastname field needs to be between 3 and 20 characters in length'),

  body('name')
    .if(body('usertype').not().equals('api'))
    .trim()
    .notEmpty()
    .withMessage('The Name field is required')
    .isLength({ min: 6, max: 30 })
    .withMessage('The Name field needs to be between 6 and 30 characters in length')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage(
      'The Name field can only contain alpha-numeric characters, dashes, and underscores'
    ),

  body('email')
    .if(body('usertype').not().equals('api'))
    .trim()
    .notEmpty()
    .withMessage('The Email field is required')
    .isEmail()
    .withMessage('The Email field needs to contain a valid email address')
    .isLength({ max: 250 })
    .withMessage('The Email field can be no longer than 250 characters in length'),

  body('password')
    .if(body('usertype').not().equals('api'))
    .optional({ checkFalsy: true })
    .isLength({ min: 5, max: 20 })
    .withMessage('The Password field needs to be between 5 and 20 characters in length'),

  body('usertype')
    .if(body('usertype').not().equals('api'))
    .notEmpty()
    .withMessage('The Usertype field is required'),

  body('branch_id')
    .if(body('usertype').not().equals('api'))
    .notEmpty()
    .withMessage('The Branch Id field is required'),

  body('branch_data')
    .if(body('usertype').not().equals('api'))
    .isArray({ min: 1 })
    .withMessage('At least one branch must be selected'),

  body('app_name')
    .if(body('usertype').equals('api'))
    .trim()
    .notEmpty()
    .withMessage('The App Name field is required')
    .isLength({ min: 3, max: 20 })
    .withMessage('The App Name field needs to be between 3 and 20 characters in length'),

  body('app_key')
    .if(body('usertype').equals('api'))
    .trim()
    .notEmpty()
    .withMessage('The App Key field is required')
    .isLength({ min: 30, max: 60 })
    .withMessage('The App Key field needs to be between 30 and 60 characters in length'),
];

const validateLogin = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('The Username field is required')
    .isLength({ min: 3, max: 250 })
    .withMessage('The Username field needs to be between 3 and 250 characters in length'),

  body('password')
    .notEmpty()
    .withMessage('The Password field is required')
    .isLength({ min: 5, max: 200 })
    .withMessage('The Password field needs to be between 5 and 200 characters in length'),
];

const validatePasswordUpdate = [
  body('update_new_password')
    .notEmpty()
    .withMessage('The New Password field is required')
    .isLength({ min: 5, max: 20 })
    .withMessage('The New Password field needs to be between 5 and 20 characters in length'),

  body('retype_new_password')
    .notEmpty()
    .withMessage('The Retype Password field is required')
    .custom((value, { req }) => {
      if (value !== req.body.update_new_password) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    }),
];

const validateUserVerify = [
  query('password')
    .notEmpty()
    .withMessage('The Password field is required')
    .isLength({ min: 5, max: 20 })
    .withMessage('The Password field needs to be between 5 and 20 characters in length'),
];

const validateChangeBranch = [
  body('branch_no')
    .trim()
    .notEmpty()
    .withMessage('The Branch ID field is required')
    .isMongoId()
    .withMessage('Invalid Branch ID format'),
];

const validateUserProfile = [
  body('name')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('The Name field needs to be between 3 and 100 characters'),
  body('lastname')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('The Lastname field needs to be between 1 and 100 characters'),
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
  validateUser,
  validateLogin,
  validatePasswordUpdate,
  validateUserVerify,
  validateChangeBranch,
  validateUserProfile,
  handleValidationErrors,
};
