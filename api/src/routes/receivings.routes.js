const express = require('express');
const router = express.Router();
const receivingsController = require('../controllers/receivings.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler !== 'function') {
    // Some legacy handlers may not yet be ported on the ApiV2
    // controller. Instead of crashing the whole app at require time,
    // expose a placeholder that clearly reports the missing handler.
    return (req, res) => {
      // eslint-disable-next-line no-console
      console.error('Missing receivings controller handler for path', req.path);
      return res.status(500).json({
        type: 'error',
        message: 'Handler not implemented',
        data: null,
      });
    };
  }
  return (req, res, next) => handler.call(receivingsController, req, res, next);
};

// Apply authentication middleware to all routes
router.use(protect);

// POST /api/receivings - Create a new receiving
router.post('/', bindController(receivingsController.create));

// GET /api/receivings - List receivings with filters
router.get('/', bindController(receivingsController.getAll));

// Legacy receiving report table endpoint
router.get('/receivingReportTable', bindController(receivingsController.receivingReportTable));

// Legacy supplier receiving report endpoint
router.get(
  '/supplierReceivingReportTable',
  bindController(receivingsController.supplierReceivingReportTable)
);

// Legacy return receiving report endpoint
router.get(
  '/returnReceivingReportTable',
  bindController(receivingsController.returnReceivingReportTable)
);

router.get(
  '/receivingsGraphicalReports',
  bindController(receivingsController.receivingsGraphicalReports)
);

router.get(
  '/productBasedReceivingReturnDetails',
  bindController(receivingsController.productBasedReceivingReturnDetails)
);

// GET /api/receivings/summary - Summary stats
router.get('/summary', bindController(receivingsController.getSummary));

// Legacy pending report routes that frontend still requests under /receivings
router.get(
  '/pendingReceivingReportTable',
  bindController(receivingsController.pendingReceivingReportTable)
);
router.get(
  '/pendingSupplierReportTable',
  bindController(receivingsController.pendingSupplierReportTable)
);

// PHP: receivedReceiving() - Mark as received
router.post('/receivedReceiving', bindController(receivingsController.receivedReceiving));

// PHP: returnReceiving() - Process return
// Legacy frontend issues a PUT request via PosnicPro.put(), so support
// both POST and PUT methods for compatibility.
router.post('/returnReceiving', bindController(receivingsController.returnReceiving));
router.put('/returnReceiving', bindController(receivingsController.returnReceiving));

// PHP: getDataChanges() - Sync data changes
router.get('/getDataChanges', bindController(receivingsController.getDataChanges));

// PHP: receivingsPdf() - Generate PDF
router.get('/receivingsPdf', bindController(receivingsController.receivingsPdf));

// Email the same PDF to the supplier (outward-facing: receiving write).
router.post('/emailToSupplier', bindController(receivingsController.emailToSupplier));

// PHP: exportReceivings() - Excel export
router.post('/exportReceivings', bindController(receivingsController.exportReceivings));

// Frontend POSTs to lowercase /exportreceivings (from PosnicPro.getExportValue)
router.post('/exportreceivings', bindController(receivingsController.exportReceivings));

// PHP: supplierReceivingDetails() - Supplier details
router.get(
  '/supplierReceivingDetails',
  bindController(receivingsController.supplierReceivingDetails)
);

// PHP: uploadReceivingImage() - Upload receipt image
router.post('/uploadReceivingImage', bindController(receivingsController.uploadReceivingImage));

// PHP: pendingReceivingProductDetails() - Pending product details
router.get(
  '/pendingReceivingProductDetails',
  bindController(receivingsController.pendingReceivingProductDetails)
);

// PHP: returnReceivingProductView() - Return product view
router.get(
  '/returnReceivingProductView',
  bindController(receivingsController.returnReceivingProductView)
);

// PHP: returnPrintDetails() - Return print details
router.get('/returnPrintDetails', bindController(receivingsController.returnPrintDetails));

// PHP: gstTwoReportTable() - GST-2 report
router.get('/gstTwoReportTable', bindController(receivingsController.gstTwoReportTable));

// PHP: gstNineReportTable() - GST-9 report
router.get('/gstNineReportTable', bindController(receivingsController.gstNineReportTable));

// PHP: companyPriceUpdate() - Update company/supplier price
// Frontend sends PUT request, support both POST and PUT for compatibility
router.post('/companyPriceUpdate', bindController(receivingsController.companyPriceUpdate));
router.put('/companyPriceUpdate', bindController(receivingsController.companyPriceUpdate));

// PHP: returnReceivingProductDetails() - Return product details
router.get(
  '/returnReceivingProductDetails',
  bindController(receivingsController.returnReceivingProductDetails)
);

// Legacy bulk delete endpoint used by frontend: DELETE /receivings/delete
router.delete('/delete', bindController(receivingsController.delete));

// GET /api/receivings/:id - Single receiving
router.get('/:id', bindController(receivingsController.getById));

// PUT /api/receivings/:id - Update receiving (Edit Purchase)
router.put('/:id', bindController(receivingsController.update));

// PATCH /api/receivings/:id/status - Update receiving status only
router.patch('/:id/status', bindController(receivingsController.updateStatus));

module.exports = router;
