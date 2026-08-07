const { passwordResetLimiter } = require('../middleware/auth-rate-limit');
const express = require('express');
const router = express.Router();
require('express-validator');
const { protect } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const authController = require('../controllers/auth.controller');
const upload = require('../middleware/upload');

// Import settings validation middleware
const {
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
} = require('../middleware/settings.validation');

const settingController = require('../controllers/settings.controller');

// Helper to preserve controller context when used as route handlers
const bindController = (handler) => {
  if (typeof handler !== 'function') {
    throw new TypeError('Invalid controller handler supplied to router');
  }
  return (req, res, next) => handler.call(settingController, req, res, next);
};

// Use the controller instance methods
router.get('/getJSONCountry', bindController(settingController.getJSONCountry));
router.get('/getJSONState', bindController(settingController.getJSONState));
router.get('/getJSONCurrency', bindController(settingController.getJSONCurrency));
router.get('/getJSONTimeZone', bindController(settingController.getJSONTimeZone));

// Legacy unauthenticated endpoints expected under /setting
router.post(
  '/forgotPassword',
  passwordResetLimiter,
  bindController(settingController.forgotPassword)
);

// Routes below require authentication
router.use(protect);

router.get('/getDefaultCustomer', bindController(settingController.getDefaultCustomer));

router.get('/getDefaultSupplier', bindController(settingController.getDefaultSupplier));

router.get(
  '/getDefaultCustomerSupplier',
  bindController(settingController.getDefaultCustomerSupplier)
);

router.get('/backupTable', bindController(settingController.backupTable));

// PUT /api/setting/general - Update general settings
router.put(
  '/general',
  validateGeneralSetting,
  handleValidationErrors,
  bindController(settingController.updateGeneralSetting)
);

// Legacy PHP endpoint - PUT /api/setting/updateGeneralSetting
router.put(
  '/updateGeneralSetting',
  validateGeneralSetting,
  handleValidationErrors,
  bindController(settingController.updateGeneralSetting)
);

// Also support POST for backward compatibility
router.post(
  '/updateGeneralSetting',
  validateGeneralSetting,
  handleValidationErrors,
  bindController(settingController.updateGeneralSetting)
);

router.post(
  '/updateCommonSettings',
  validateCommonSettings,
  handleValidationErrors,
  bindController(settingController.updateCommonSettings)
);

router.put(
  '/updateCommonSettings',
  validateCommonSettings,
  handleValidationErrors,
  bindController(settingController.updateCommonSettings)
);

router.get('/getTaxAll', bindController(settingController.getTaxAll));
router.get('/getTaxAjaxList', bindController(settingController.getTaxAjaxList));
router.get('/getTaxGroup', bindController(settingController.getTaxGroup));

// PHP: Tax CRUD routes
router.post(
  '/addTax',
  validateTax,
  handleValidationErrors,
  bindController(settingController.addTax)
);
router.post(
  '/editTax',
  validateTax,
  handleValidationErrors,
  bindController(settingController.editTax)
);
router.put(
  '/editTax',
  validateTax,
  handleValidationErrors,
  bindController(settingController.editTax)
);
router.delete('/deleteTax', bindController(settingController.deleteTax));

// PHP: Unit routes
router.get('/getUnitAll', bindController(settingController.getUnitAll));
router.get('/getUnitAjaxList', bindController(settingController.getUnitAjaxList));
router.post(
  '/addUnit',
  validateUnit,
  handleValidationErrors,
  bindController(settingController.addUnit)
);
router.post(
  '/editUnit',
  validateUnit,
  handleValidationErrors,
  bindController(settingController.editUnit)
);
router.put(
  '/editUnit',
  validateUnit,
  handleValidationErrors,
  bindController(settingController.editUnit)
);
router.delete('/deleteUnit', bindController(settingController.deleteUnit));

// PHP: Tax Group routes
router.post(
  '/addTaxGroup',
  validateTaxGroup,
  handleValidationErrors,
  bindController(settingController.addTaxGroup)
);
router.post(
  '/editTaxGroup',
  validateTaxGroup,
  handleValidationErrors,
  bindController(settingController.editTaxGroup)
);
router.put(
  '/editTaxGroup',
  validateTaxGroup,
  handleValidationErrors,
  bindController(settingController.editTaxGroup)
);
router.delete('/deleteTaxGroup', bindController(settingController.deleteTaxGroup));

// PHP: Denom routes
router.post(
  '/addDenomForm',
  validateDenom,
  handleValidationErrors,
  bindController(settingController.addDenomForm)
);
router.post(
  '/addDenomData',
  validateDenom,
  handleValidationErrors,
  bindController(settingController.addDenomData)
);
router.get('/getDenomAll', bindController(settingController.getDenomAll));
router.put(
  '/editDenomForm',
  validateDenom,
  handleValidationErrors,
  bindController(settingController.editDenomForm)
);
router.delete('/deleteDenom', bindController(settingController.deleteDenom));

// PHP: Payment routes
router.get('/getPaymentAll', bindController(settingController.getPaymentAll));
router.post(
  '/addPaymentData',
  validatePayment,
  handleValidationErrors,
  bindController(settingController.addPaymentData)
);
router.put(
  '/editPaymentForm',
  validatePayment,
  handleValidationErrors,
  bindController(settingController.editPaymentForm)
);
router.delete('/deletePayment', bindController(settingController.deletePayment));

// PHP: SMS Settings routes
router.post(
  '/updateWay2SmsSetting',
  validateWay2SmsSetting,
  handleValidationErrors,
  bindController(settingController.updateWay2SmsSetting)
);
router.post(
  '/updateTextLocalSmsSetting',
  validateTextLocalSmsSetting,
  handleValidationErrors,
  bindController(settingController.updateTextLocalSmsSetting)
);
router.post('/updateOfflineSetting', bindController(settingController.updateOfflineSetting));

// PHP: Image routes
router.post(
  '/updateBranchLogo',
  upload.single('file'),
  bindController(settingController.updateBranchLogo)
);
// PHP expects multiple files: kiosk_logo, kiosk_banner, kiosk_homebanner, kiosk_advertisement
router.post(
  '/updateKioskImages',
  upload.fields([
    { name: 'kiosk_logo', maxCount: 1 },
    { name: 'kiosk_banner', maxCount: 1 },
    { name: 'kiosk_homebanner', maxCount: 1 },
    { name: 'kiosk_advertisement', maxCount: 1 },
  ]),
  bindController(settingController.updateKioskImages)
);
router.post('/storedImageData', bindController(settingController.storedImageData));
router.put('/storedImageData', bindController(settingController.storedImageData));
router.delete('/branchImageDelete', bindController(settingController.branchImageDelete));

// PHP: Customer/Supplier Settings routes
router.get('/updateCustomerSettings', bindController(settingController.updateCustomerSettings));
router.get('/updateSupplierSettings', bindController(settingController.updateSupplierSettings));

// PHP: Password routes
router.post(
  '/changePassword',
  validateChangePassword,
  handleValidationErrors,
  bindController(settingController.changePassword)
);

// PHP: SMS Receipt route
router.post('/salesSmsReceipt', bindController(settingController.salesSmsReceipt));

// WhatsApp Receipt routes
router.post('/saveWhatsAppReceipt', bindController(settingController.saveWhatsAppReceipt));
router.get('/getWhatsAppReceipt', bindController(settingController.getWhatsAppReceipt));

// PHP: Payment Key routes
router.post('/paymentsKey', bindController(settingController.paymentsKey));
router.post('/phonepepaymentsKey', bindController(settingController.phonepepaymentsKey));

// PHP: Data Management routes
router.delete('/deleteCollection', bindController(settingController.deleteCollection));
router.post(
  '/deleteAllSelectedCollection',
  bindController(settingController.deleteAllSelectedCollection)
);

// PHP: JSON routes
router.get('/getJSONGstState', bindController(settingController.getJSONGstState));

// PHP: Backup routes
router.post('/restoreBackup', bindController(settingController.restoreBackup));

// PHP: Dashboard route
router.get('/getDasboardSalesCount', bindController(settingController.getDasboardSalesCount));

// PHP: Recycle Bin routes
router.get('/getRecycleBin', bindController(settingController.getRecycleBin));
router.get(
  '/autoSuggestionRecycleBinTableField',
  bindController(settingController.autoSuggestionRecycleBinTableField)
);

// PHP: Collection routes
router.get('/getAllCollectionTotal', bindController(settingController.getAllCollectionTotal));

// PHP: Email Setting route
router.post('/emailSetting', bindController(settingController.emailSetting));
router.put('/emailSetting', bindController(settingController.emailSetting));

// PHP: Kiosk Settings routes
router.post('/kioskAccountSettings', bindController(settingController.kioskAccountSettings));
router.put('/kioskAccountSettings', bindController(settingController.kioskAccountSettings));
router.post('/kioskPrinterSettings', bindController(settingController.kioskPrinterSettings));
router.put('/kioskPrinterSettings', bindController(settingController.kioskPrinterSettings));
router.post('/kioskPayment', bindController(settingController.kioskPayment));
router.put('/kioskPayment', bindController(settingController.kioskPayment));
router.post('/kioskupdateInfo', bindController(settingController.kioskupdateInfo));
router.put('/kioskupdateInfo', bindController(settingController.kioskupdateInfo));

// PHP: Table Order routes
router.post('/addTableOrderData', bindController(settingController.addTableOrderData));
router.get('/getTableOrderAll', bindController(settingController.getTableOrderAll));
router.put('/editTableOrderForm', bindController(settingController.editTableOrderForm));
router.delete('/deleteTableOrder', bindController(settingController.deleteTableOrder));

// PHP: Theme Settings routes
router.get('/getThemeSettings', bindController(settingController.getThemeSettings));
router.post('/updateThemeSettings', bindController(settingController.updateThemeSettings));
router.put('/updateThemeSettings', bindController(settingController.updateThemeSettings));

module.exports = router;
