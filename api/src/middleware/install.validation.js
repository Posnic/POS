const { body } = require('express-validator');
const { FIELD_LIMITS, ERROR_MESSAGES } = require('../constants/install.constants');
const { ObjectId } = require('mongodb');

/**
 * Validation middleware for installation
 * Applied to POST /install endpoint
 */
const validateInstallation = [
  body('register_companyname')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.COMPANY_NAME_REQUIRED)
    .isLength({ min: FIELD_LIMITS.COMPANY_NAME_MIN, max: FIELD_LIMITS.COMPANY_NAME_MAX })
    .withMessage(ERROR_MESSAGES.COMPANY_NAME_LENGTH),

  body('register_username')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.USERNAME_REQUIRED)
    .isLength({ min: FIELD_LIMITS.USERNAME_MIN, max: FIELD_LIMITS.USERNAME_MAX })
    .withMessage(
      `Username must be between ${FIELD_LIMITS.USERNAME_MIN} and ${FIELD_LIMITS.USERNAME_MAX} characters`
    ),

  body('register_useremail')
    .trim()
    .notEmpty()
    .withMessage(ERROR_MESSAGES.EMAIL_REQUIRED)
    .isEmail()
    .withMessage(ERROR_MESSAGES.VALID_EMAIL_REQUIRED)
    .isLength({ max: FIELD_LIMITS.EMAIL_MAX })
    .withMessage(`Email must not exceed ${FIELD_LIMITS.EMAIL_MAX} characters`),

  body('register_userphone')
    .optional()
    .trim()
    .isLength({ max: FIELD_LIMITS.PHONE_MAX })
    .withMessage(ERROR_MESSAGES.PHONE_LENGTH),

  // Either a plaintext password (the desktop install wizard) or an already
  // bcrypt-hashed one (a cloud signup, where the plaintext is never kept).
  body('register_userpassword')
    .if((_value, { req }) => !req.body.register_userpasswordhash)
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),

  body('register_userpasswordhash')
    .optional()
    .matches(/^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/)
    .withMessage('register_userpasswordhash must be a bcrypt hash'),

  body('register_license')
    .notEmpty()
    .withMessage('License ID is required')
    .custom((value) => {
      if (!ObjectId.isValid(value)) {
        throw new Error('Invalid license ID format');
      }
      return true;
    }),

  body('register_firstname').optional().trim(),
  body('register_lastname').optional().trim(),
  body('register_address').optional().trim(),
  body('register_fullnumber').optional().trim(),
  body('register_country').optional().trim(),
  body('register_countryid').optional().trim(),
  body('register_state').optional().trim(),
  body('register_timezone').optional().trim(),
  body('register_demo').optional(),
  body('businessType')
    .optional()
    .trim()
    .isIn([
      'icecream',
      'cafe',
      'bakery',
      'supermarket',
      'kirana',
      'grocery',
      'textile',
      'electrical',
      'hardware',
      '',
    ])
    .withMessage(
      'Business type must be one of: supermarket, textile, electrical, hardware, cafe, bakery, icecream'
    ),
];

/**
 * Validation middleware for cleanup operation
 * Applied to POST /install/cleanup endpoint
 */
const validateCleanup = [
  body('license_id')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.LICENSE_ID_REQUIRED)
    .custom((value) => {
      if (!ObjectId.isValid(value)) {
        throw new Error('Invalid license ID format');
      }
      return true;
    }),
];

/**
 * Middleware to verify installation key and secret
 * Can be used as route middleware
 */
const verifyInstallationCredentials = (req, res, next) => {
  const config = require('../config/config');
  const key = req.body.key || req.headers['x-posnic-key'];
  const secret = req.body.secret || req.headers['x-posnic-secret'];

  // Unconfigured means closed. Without this an empty env would compare
  // undefined against undefined and let anyone through.
  if (!config.posnic_key || !config.posnic_secret) {
    console.warn('[install] refused: POSNIC_KEY/POSNIC_SECRET are not configured');
    return res.status(503).json({
      type: 'error',
      message: 'Installation is not configured on this server',
      data: null,
    });
  }

  if (key !== config.posnic_key || secret !== config.posnic_secret) {
    return res.status(401).json({
      type: 'error',
      message: ERROR_MESSAGES.UNAUTHORIZED,
      data: null,
    });
  }

  next();
};

module.exports = {
  validateInstallation,
  validateCleanup,
  verifyInstallationCredentials,
};
