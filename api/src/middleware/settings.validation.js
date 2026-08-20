/**
 * Settings Module Validation Middleware
 * Express-validator rules matching PHP GUMP validation
 */

const { body } = require('express-validator');
const { VALIDATION_RULES } = require('../constants/settings.constants');

/**
 * Validation for updateGeneralSetting
 * PHP: setting.php lines 39-49
 */
const validateGeneralSetting = [
  body('store_name')
    .trim()
    .notEmpty()
    .withMessage('Store name is required')
    .isLength({ min: VALIDATION_RULES.STORE_NAME.MIN, max: VALIDATION_RULES.STORE_NAME.MAX })
    .withMessage(
      `Store name must be between ${VALIDATION_RULES.STORE_NAME.MIN} and ${VALIDATION_RULES.STORE_NAME.MAX} characters`
    ),

  body('store_email')
    .trim()
    .notEmpty()
    .withMessage('Store email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .isLength({ max: VALIDATION_RULES.STORE_EMAIL.MAX })
    .withMessage(`Store email must not exceed ${VALIDATION_RULES.STORE_EMAIL.MAX} characters`),

  body('store_telephone')
    .trim()
    .notEmpty()
    .withMessage('Store telephone is required')
    .isLength({
      min: VALIDATION_RULES.STORE_TELEPHONE.MIN,
      max: VALIDATION_RULES.STORE_TELEPHONE.MAX,
    })
    .withMessage(
      `Store telephone must be between ${VALIDATION_RULES.STORE_TELEPHONE.MIN} and ${VALIDATION_RULES.STORE_TELEPHONE.MAX} characters`
    ),

  body('store_alternativephone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({
      min: VALIDATION_RULES.STORE_TELEPHONE.MIN,
      max: VALIDATION_RULES.STORE_TELEPHONE.MAX,
    })
    .withMessage(
      `Alternative phone must be between ${VALIDATION_RULES.STORE_TELEPHONE.MIN} and ${VALIDATION_RULES.STORE_TELEPHONE.MAX} characters`
    ),

  body('store_address')
    .trim()
    .notEmpty()
    .withMessage('Store address is required')
    .isLength({ min: VALIDATION_RULES.STORE_ADDRESS.MIN, max: VALIDATION_RULES.STORE_ADDRESS.MAX })
    .withMessage(
      `Store address must be between ${VALIDATION_RULES.STORE_ADDRESS.MIN} and ${VALIDATION_RULES.STORE_ADDRESS.MAX} characters`
    ),

  body('printing_address')
    .trim()
    .notEmpty()
    .withMessage('Printing address is required')
    .isLength({
      min: VALIDATION_RULES.PRINTING_ADDRESS.MIN,
      max: VALIDATION_RULES.PRINTING_ADDRESS.MAX,
    })
    .withMessage(
      `Printing address must be between ${VALIDATION_RULES.PRINTING_ADDRESS.MIN} and ${VALIDATION_RULES.PRINTING_ADDRESS.MAX} characters`
    ),

  body('website')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: VALIDATION_RULES.WEBSITE.MIN, max: VALIDATION_RULES.WEBSITE.MAX })
    .withMessage(
      `Website must be between ${VALIDATION_RULES.WEBSITE.MIN} and ${VALIDATION_RULES.WEBSITE.MAX} characters`
    ),

  body('city')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.CITY.MAX })
    .withMessage(`City must not exceed ${VALIDATION_RULES.CITY.MAX} characters`),

  body('pincode')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.PINCODE.MAX })
    .withMessage(`Pincode must not exceed ${VALIDATION_RULES.PINCODE.MAX} characters`),
];

/**
 * Validation for addTax / editTax
 * PHP: setting.php lines 85-88, 139-142
 */
const validateTax = [
  body('tax_name')
    .trim()
    .notEmpty()
    .withMessage('Tax name is required')
    .isLength({ min: VALIDATION_RULES.TAX_NAME.MIN, max: VALIDATION_RULES.TAX_NAME.MAX })
    .withMessage(
      `Tax name must be between ${VALIDATION_RULES.TAX_NAME.MIN} and ${VALIDATION_RULES.TAX_NAME.MAX} characters`
    ),

  body('tax_value')
    .trim()
    .notEmpty()
    .withMessage('Tax value is required')
    .isLength({ min: VALIDATION_RULES.TAX_VALUE.MIN, max: VALIDATION_RULES.TAX_VALUE.MAX })
    .withMessage(
      `Tax value must be between ${VALIDATION_RULES.TAX_VALUE.MIN} and ${VALIDATION_RULES.TAX_VALUE.MAX} characters`
    ),
];

/**
 * Validation for addUnit
 * PHP: setting.php lines 108-110
 */
const validateUnit = [
  body('unit_name')
    .trim()
    .notEmpty()
    .withMessage('Unit name is required')
    .isLength({ min: VALIDATION_RULES.UNIT_NAME.MIN, max: VALIDATION_RULES.UNIT_NAME.MAX })
    .withMessage(
      `Unit name must be between ${VALIDATION_RULES.UNIT_NAME.MIN} and ${VALIDATION_RULES.UNIT_NAME.MAX} characters`
    ),

  body('unit_value')
    .trim()
    .notEmpty()
    .withMessage('Unit value is required')
    .isLength({ min: VALIDATION_RULES.UNIT_VALUE.MIN, max: VALIDATION_RULES.UNIT_VALUE.MAX })
    .withMessage(
      `Unit value must be between ${VALIDATION_RULES.UNIT_VALUE.MIN} and ${VALIDATION_RULES.UNIT_VALUE.MAX} characters`
    ),
];

/**
 * Validation for addTaxGroup / editTaxGroup
 * PHP: setting.php lines 325, 346
 */
const validateTaxGroup = [
  body('tax_name')
    .trim()
    .notEmpty()
    .withMessage('Tax group name is required')
    .isLength({ min: VALIDATION_RULES.TAX_NAME.MIN, max: VALIDATION_RULES.TAX_NAME.MAX })
    .withMessage(
      `Tax group name must be between ${VALIDATION_RULES.TAX_NAME.MIN} and ${VALIDATION_RULES.TAX_NAME.MAX} characters`
    ),
];

/**
 * Validation for addDenomData / addDenomForm / editDenomForm
 * PHP: setting.php lines 223-224, 376-377
 */
const validateDenom = [
  body('denom_value')
    .trim()
    .notEmpty()
    .withMessage('Denomination value is required')
    .isLength({ min: VALIDATION_RULES.DENOM_VALUE.MIN, max: VALIDATION_RULES.DENOM_VALUE.MAX })
    .withMessage(
      `Denomination value must be between ${VALIDATION_RULES.DENOM_VALUE.MIN} and ${VALIDATION_RULES.DENOM_VALUE.MAX} characters`
    ),
];

/**
 * Validation for addPaymentData / editPaymentForm
 * PHP: setting.php lines 264, 285
 */
const validatePayment = [
  body('payment_value')
    .trim()
    .notEmpty()
    .withMessage('Payment value is required')
    .isLength({ min: VALIDATION_RULES.PAYMENT_VALUE.MIN, max: VALIDATION_RULES.PAYMENT_VALUE.MAX })
    .withMessage(
      `Payment value must be between ${VALIDATION_RULES.PAYMENT_VALUE.MIN} and ${VALIDATION_RULES.PAYMENT_VALUE.MAX} characters`
    ),
];

/**
 * Validation for updateCommonSettings
 * PHP: setting.php lines 672-691
 */
/*
 * This endpoint takes PARTIAL payloads - the quotation-defaults card and the
 * signature upload each send a handful of their own keys and nothing else.
 * Demanding fields they never carry made an image upload fail with "Default
 * customer is required", which is a question the form never asked the user.
 *
 * So each rule is skipped when its key is absent (`.optional()`), and only
 * validated when the caller actually sends it. A full settings-form save
 * sends both keys and is checked exactly as before. Absent means "leave it
 * alone"; present-but-empty is still refused.
 */
const validateCommonSettings = [
  body('default_customer')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Default customer is required')
    .isLength({
      min: VALIDATION_RULES.DEFAULT_CUSTOMER.MIN,
      max: VALIDATION_RULES.DEFAULT_CUSTOMER.MAX,
    })
    .withMessage(
      `Default customer must be between ${VALIDATION_RULES.DEFAULT_CUSTOMER.MIN} and ${VALIDATION_RULES.DEFAULT_CUSTOMER.MAX} characters`
    ),

  body('default_supplier')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Default supplier is required')
    .isLength({
      min: VALIDATION_RULES.DEFAULT_SUPPLIER.MIN,
      max: VALIDATION_RULES.DEFAULT_SUPPLIER.MAX,
    })
    .withMessage(
      `Default supplier must be between ${VALIDATION_RULES.DEFAULT_SUPPLIER.MIN} and ${VALIDATION_RULES.DEFAULT_SUPPLIER.MAX} characters`
    ),
];

/**
 * Validation for changePassword
 * PHP: setting.php lines 784-786
 */
const validateChangePassword = [
  body('old_password')
    .trim()
    .notEmpty()
    .withMessage('Old password is required')
    .isLength({ min: VALIDATION_RULES.PASSWORD.MIN, max: VALIDATION_RULES.PASSWORD.MAX })
    .withMessage(
      `Old password must be between ${VALIDATION_RULES.PASSWORD.MIN} and ${VALIDATION_RULES.PASSWORD.MAX} characters`
    ),

  body('new_password')
    .trim()
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: VALIDATION_RULES.PASSWORD.MIN, max: VALIDATION_RULES.PASSWORD.MAX })
    .withMessage(
      `New password must be between ${VALIDATION_RULES.PASSWORD.MIN} and ${VALIDATION_RULES.PASSWORD.MAX} characters`
    ),

  body('confirm_password')
    .trim()
    .notEmpty()
    .withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.new_password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
];

/**
 * Validation for updateWay2SmsSetting
 * PHP: setting.php lines 457-458
 */
const validateWay2SmsSetting = [
  body('way2sms_api')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.WAY2SMS_API.MAX })
    .withMessage(`Way2SMS API must not exceed ${VALIDATION_RULES.WAY2SMS_API.MAX} characters`),

  body('way2sms_userid')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.WAY2SMS_USERID.MAX })
    .withMessage(
      `Way2SMS User ID must not exceed ${VALIDATION_RULES.WAY2SMS_USERID.MAX} characters`
    ),
];

/**
 * Validation for updateTextLocalSmsSetting
 * PHP: setting.php lines 489-490
 */
const validateTextLocalSmsSetting = [
  body('textlocal_api')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.TEXTLOCAL_API.MAX })
    .withMessage(`TextLocal API must not exceed ${VALIDATION_RULES.TEXTLOCAL_API.MAX} characters`),

  body('textlocal_sender')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: VALIDATION_RULES.TEXTLOCAL_SENDER.MAX })
    .withMessage(
      `TextLocal sender must not exceed ${VALIDATION_RULES.TEXTLOCAL_SENDER.MAX} characters`
    ),
];

module.exports = {
  validateGeneralSetting,
  validateTax,
  validateUnit,
  validateTaxGroup,
  validateDenom,
  validatePayment,
  validateCommonSettings,
  validateChangePassword,
  validateWay2SmsSetting,
  validateTextLocalSmsSetting,
};
