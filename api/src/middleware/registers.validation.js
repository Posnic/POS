const { body, query } = require('express-validator');
const { FIELD_LIMITS } = require('../constants/registers.constants');

/**
 * Validation middleware for opening a register (registerAdd)
 * This mirrors the expectations of registeraddInsert in RegisterModel
 * without changing field names used by the legacy UI.
 */
const validateRegisterAdd = [
  body('register_Id').notEmpty().withMessage('register_Id is required'),

  body('register_name')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({
      min: FIELD_LIMITS.REGISTER_NAME_MIN,
      max: FIELD_LIMITS.REGISTER_NAME_MAX,
    })
    .withMessage(
      `register_name must be between ${FIELD_LIMITS.REGISTER_NAME_MIN} and ${FIELD_LIMITS.REGISTER_NAME_MAX} characters`
    ),

  body('opening_float')
    .notEmpty()
    .withMessage('opening_float is required')
    .bail()
    .isFloat({ min: 0 })
    .withMessage('opening_float must be a non-negative number'),
];

/**
 * Validation middleware for adding cash in/out details (registerInDetail)
 */
const validateRegisterInDetail = [
  body('cash_register_id').notEmpty().withMessage('cash_register_id is required'),

  body('in_amount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('in_amount must be a non-negative number'),

  body('out_amount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('out_amount must be a non-negative number'),

  body('in_description').optional({ checkFalsy: true }).isString().trim(),

  body('out_description').optional({ checkFalsy: true }).isString().trim(),
];

/**
 * Validation middleware for closing a register (registerClose)
 */
const validateRegisterClose = [
  body('cash_register_id').notEmpty().withMessage('cash_register_id is required'),
];

/**
 * Validation middleware for updating counted amount (registerCountedAmount)
 */
const validateRegisterCountedAmount = [
  body('register_row_Id').notEmpty().withMessage('register_row_Id is required'),

  body('payment_Type').notEmpty().withMessage('payment_Type is required'),

  body('countedAmount')
    .notEmpty()
    .withMessage('countedAmount is required')
    .bail()
    .isFloat({ min: 0 })
    .withMessage('countedAmount must be a non-negative number'),
];

/**
 * Validation middleware for updating payment note (registerPaymentNote)
 */
const validateRegisterPaymentNote = [
  body('id').notEmpty().withMessage('id is required'),

  body('note').optional({ checkFalsy: true }).isString().withMessage('note must be a string'),
];

/**
 * Validation middleware for saving denomination details (registerDenomsubmit)
 */
const validateRegisterDenomsubmit = [
  body('register_id').notEmpty().withMessage('register_id is required'),

  body('denomination_values')
    .optional({ checkFalsy: true })
    .isArray()
    .withMessage('denomination_values must be an array'),
];

/**
 * Validation middleware for deleting cash in/out entry (deleteCashInOut)
 */
const validateDeleteCashInOut = [
  body('register_id').notEmpty().withMessage('register_id is required'),

  body('index')
    .notEmpty()
    .withMessage('index is required')
    .bail()
    .isInt({ min: 0 })
    .withMessage('index must be a non-negative integer'),
];

/**
 * Validation middleware for register report table filters (registerReportTable)
 * Dates and register filters are kept optional to avoid breaking legacy flows.
 */
const validateRegisterReportFilters = [
  query('limit')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),

  query('page').optional({ checkFalsy: true }).isInt().withMessage('page must be an integer'),

  query('starting_date')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('starting_date must be a string'),

  query('ending_date')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('ending_date must be a string'),

  query('register')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('register must be a string'),
];

/**
 * Validation middleware for register sale details query (registerSaleDetails)
 */
const validateRegisterSaleDetails = [
  query('id').notEmpty().withMessage('id is required'),

  query('limit')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),

  query('page').optional({ checkFalsy: true }).isInt().withMessage('page must be an integer'),
];

module.exports = {
  validateRegisterAdd,
  validateRegisterInDetail,
  validateRegisterClose,
  validateRegisterCountedAmount,
  validateRegisterPaymentNote,
  validateRegisterDenomsubmit,
  validateDeleteCashInOut,
  validateRegisterReportFilters,
  validateRegisterSaleDetails,
};
