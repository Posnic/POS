const express = require('express');
const router = express.Router();
const registersController = require('../controllers/registers.controller');
const { protect } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validateRequest');
const {
  validateRegisterAdd,
  validateRegisterInDetail,
  validateRegisterClose,
  validateRegisterCountedAmount,
  validateRegisterPaymentNote,
  validateRegisterDenomsubmit,
  validateDeleteCashInOut,
  validateRegisterReportFilters,
  validateRegisterSaleDetails,
} = require('../middleware/registers.validation');

// Helper function to bind controller methods (same pattern as items.routes.js)
const bindController = (handler, controller = registersController) => {
  if (typeof handler !== 'function') {
    throw new TypeError('Invalid controller handler supplied to router');
  }

  return (req, res, next) => handler.call(controller, req, res, next);
};

// Apply authentication middleware to all routes
router.use(protect);

// PHP: getDataChanges
router.get('/getDataChanges', bindController(registersController.getDataChanges));

// PHP: getcashField
router.get('/getcashField', bindController(registersController.getcashField));

// PHP: registerReportTable
router.get(
  '/registerReportTable',
  validateRequest(validateRegisterReportFilters),
  bindController(registersController.registerReportTable)
);

// PHP: registeropendateFilter
router.get('/registeropendateFilter', bindController(registersController.registeropendateFilter));

// PHP: registerFindStatus
router.get('/registerFindStatus', bindController(registersController.registerFindStatus));

// PHP: registerAdd
router.post(
  '/registerAdd',
  validateRequest(validateRegisterAdd),
  bindController(registersController.registerAdd)
);

// PHP: registerUpdate
router.post('/registerUpdate', bindController(registersController.registerUpdate));

// PHP: registerInDetail
router.post(
  '/registerInDetail',
  validateRequest(validateRegisterInDetail),
  bindController(registersController.registerInDetail)
);

// PHP: registerClose
router.post(
  '/registerClose',
  validateRequest(validateRegisterClose),
  bindController(registersController.registerClose)
);

// PHP: cashRegisterOpenManual
router.get('/cashRegisterOpenManual', bindController(registersController.cashRegisterOpenManual));

// PHP: getCashRegister
router.get('/getCashRegister', bindController(registersController.getCashRegister));

// PHP: registerCountedAmount
router.post(
  '/registerCountedAmount',
  validateRequest(validateRegisterCountedAmount),
  bindController(registersController.registerCountedAmount)
);

// PHP: registerPaymentNote
router.post(
  '/registerPaymentNote',
  validateRequest(validateRegisterPaymentNote),
  bindController(registersController.registerPaymentNote)
);

// PHP: registerSaleDetails
router.get(
  '/registerSaleDetails',
  validateRequest(validateRegisterSaleDetails),
  bindController(registersController.registerSaleDetails)
);

// PHP: getRegisterReportDetails
router.get(
  '/getRegisterReportDetails',
  bindController(registersController.getRegisterReportDetails)
);

// PHP: getRegisterReportPdfDetails
router.get(
  '/getRegisterReportPdfDetails',
  bindController(registersController.getRegisterReportPdfDetails)
);

// PHP: registerDenomsubmit
router.post(
  '/registerDenomsubmit',
  validateRequest(validateRegisterDenomsubmit),
  bindController(registersController.registerDenomsubmit)
);

// PHP: editCashDenomination
router.get('/editCashDenomination', bindController(registersController.editCashDenomination));

// PHP: deleteCashDenomination
router.delete(
  '/deleteCashDenomination',
  bindController(registersController.deleteCashDenomination)
);

// Delete cash in/out entry
router.post(
  '/deleteCashInOut',
  validateRequest(validateDeleteCashInOut),
  bindController(registersController.deleteCashInOut)
);

module.exports = router;
