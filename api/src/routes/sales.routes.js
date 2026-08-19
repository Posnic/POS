const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');
const { protect, optionalProtect } = require('../middleware/auth');
const {
  validateCreateSale,
  validateUpdateSale,
  ensureValidSaleIdParam,
  validateInstantSaleDetailsQuery,
  validateDailyReportQuery,
  prepareItemExpiryReportQuery,
  validateSalesSummaryReportQuery,
  preparePaginatedDateRangeQuery,
  validateSalesReportsQuery,
  prepareUserReportTableQuery,
  prepareBranchPaginatedReportQuery,
  preparePaymentPaginatedReportQuery,
  prepareBranchReportQuery,
  prepareGstOneReportContext,
  prepareGstThreeReportContext,
  prepareKioskPaginatedReportQuery,
  prepareKioskReportQuery,
  prepareCreateSalePayload,
  prepareUpdateSalePayload,
  ensureKioskKey,
  protectOrKioskKey,
} = require('../middleware/sales.validation');
const { handleValidationErrors } = require('../middleware/validation');
const bindController = (handler) => {
  if (typeof handler === 'function') {
    return handler.bind(salesController);
  }

  return (req, res, next) => {
    if (typeof salesController.error === 'function') {
      return salesController.error(res, 'Handler not implemented', 501);
    }

    res.status(501).json({
      success: false,
      message: 'Handler not implemented',
      data: null,
    });
  };
};

// Apply middleware if needed
// const { authenticate, authorize } = require('../middleware/auth');

/*
 * ── Routes that may be called without a login session ──
 *
 * Inherited from PHP's sessionExceptionalRequest['sales']: the KOT screen, the
 * table tablets and the mobile ordering app reach these without going through a
 * browser login, so optionalProtect authenticates when it can and never returns
 * 401 when it cannot.
 *
 * That alone was not a guard. optionalProtect leaves an unauthenticated caller
 * as anonymous and lets them through, and these handlers take the branch from
 * the request when there is no session to take it from - req.body.branch_id,
 * req.query.branchId, req.body.order_id. So anyone who could reach the API could
 * name any branch of any shop and read its live orders, its order history, its
 * catalogue and its receipts. updateOrder was worse than a read: it accepts
 * items, totals and discounts, so an anonymous caller could rewrite what another
 * shop's order said it cost.
 *
 * protectOrKioskKey now sits behind optionalProtect. A real session passes
 * exactly as before - which is every caller inside the app. Anything anonymous
 * must present this installation's kiosk key, which is generated per machine
 * rather than shipped in the source.
 */
router.get(
  '/getTablesWithActiveOrders',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getTablesWithActiveOrders)
);
router.post(
  '/getTablesWithActiveOrders',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getTablesWithActiveOrders)
);

// --- Kiosk-authenticated routes (use kioskkey header, not JWT) ---
// Must be registered BEFORE router.use(protect)
router.post('/kioskOrder', ensureKioskKey, bindController(salesController.kioskOrder));
router.post(
  '/generateRazorPayQrCodekiosk',
  ensureKioskKey,
  bindController(salesController.generateRazorPayQrCodekiosk)
);
router.post(
  '/getRazorPayQrStatus',
  ensureKioskKey,
  bindController(salesController.getRazorPayQrStatus)
);
router.post(
  '/razorPayQrCodeClose',
  ensureKioskKey,
  bindController(salesController.razorPayQrCodeClose)
);
router.post('/fetchLastSale', ensureKioskKey, bindController(salesController.fetchLastSale));
router.post('/kitchenPrint', ensureKioskKey, bindController(salesController.kitchenPrint));
router.post(
  '/multiKitchenPrint',
  ensureKioskKey,
  bindController(salesController.multiKitchenPrint)
);
router.post(
  '/markKitchenPrinted',
  ensureKioskKey,
  bindController(salesController.markKitchenPrinted)
);

// ── Kiosk / mobile-app routes (no JWT auth required, branch_id in body) ──
router.post('/qrOrder', bindController(salesController.qrOrder));
router.get('/getNewSale', bindController(salesController.getNewSale));
router.post(
  '/getOrderHistory',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getOrderHistory)
);
router.post(
  '/updateOrder',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.updateOrder)
);
router.put(
  '/updateOrder',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.updateOrder)
);
router.post(
  '/searchProducts',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.searchProducts)
);
router.post(
  '/getFrequentItems',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getFrequentItems)
);
router.get(
  '/getListKot',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getListKot)
);

// ── Public customer receipt link ──
// customersMailPrint.html?id=<encrypted> is opened by customers from an SMS/email
// link, so it must work WITHOUT a JWT. Access is gated by the encrypted id itself
// (PHP served getCustomerPrint publicly too). Registered before router.use(protect).
router.get(
  '/getCustomerPrint',
  optionalProtect,
  protectOrKioskKey,
  bindController(salesController.getCustomerPrint)
);

router.use(protect);

// POST /api/sales - Create a new sale
router.post(
  '/',
  validateCreateSale,
  handleValidationErrors,
  prepareCreateSalePayload,
  bindController(salesController.create)
);

// GET /api/sales - Get all sales with pagination
router.get('/', bindController(salesController.getAll));

// GET /api/sales/dailySalesReports - Legacy daily sales report endpoint
router.get(
  '/dailySalesReports',
  validateDailyReportQuery,
  bindController(salesController.dailySalesReports)
);

// GET /api/sales/dailyReportPdf - Daily sales report PDF generation
router.get(
  '/dailyReportPdf',
  validateDailyReportQuery,
  bindController(salesController.dailyReportPdf)
);

// Legacy sales chart endpoint
router.get('/salesGraphicalReports', bindController(salesController.salesGraphicalReports));
router.get(
  '/itemGraphicalReports',
  preparePaginatedDateRangeQuery,
  bindController(salesController.itemGraphicalReports)
);

// Legacy sales report listing endpoint
router.get(
  '/salesReports',
  validateSalesReportsQuery,
  bindController(salesController.salesReports)
);
router.get(
  '/itemSalesReportTable',
  preparePaginatedDateRangeQuery,
  bindController(salesController.itemSalesReportTable)
);
// T3: the generic tax filing report - totals per rate class over a period.
router.get('/taxSummaryReportTable', bindController(salesController.taxSummaryReportTable));
router.get(
  '/categorySalesReportTable',
  preparePaginatedDateRangeQuery,
  bindController(salesController.categorySalesReportTable)
);
router.get(
  '/supplierSalesReportTable',
  preparePaginatedDateRangeQuery,
  bindController(salesController.supplierSalesReportTable)
);
router.get(
  '/customerSalesReportTable',
  preparePaginatedDateRangeQuery,
  bindController(salesController.customerSalesReportTable)
);
router.get(
  '/salesSummaryReports',
  validateSalesSummaryReportQuery,
  bindController(salesController.salesSummaryReports)
);

// Instant sales reports endpoints
router.get(
  '/instantSalesReports',
  preparePaginatedDateRangeQuery,
  bindController(salesController.instantSalesReports)
);
router.get(
  '/instantSaleDetails',
  validateInstantSaleDetailsQuery,
  bindController(salesController.instantSaleDetails)
);

// Legacy endpoint: GET /sales/getLatestSales
router.get('/getLatestSales', bindController(salesController.getLatestSales));

// Legacy user report routes that frontend still requests under /sales
router.get(
  '/userReportTable',
  prepareUserReportTableQuery,
  bindController(salesController.userReportTable)
);
router.get('/userGraphicalReports', bindController(salesController.userGraphicalReports));

// Legacy return report routes that frontend still requests under /sales
router.get(
  '/returnSalesReportTable',
  prepareBranchPaginatedReportQuery,
  bindController(salesController.returnSalesReportTable)
);
router.get('/productBasedReturnDetails', bindController(salesController.productBasedReturnDetails));

// Legacy pending report routes that frontend still requests under /sales
router.get(
  '/pendingSalesReportTable',
  prepareBranchPaginatedReportQuery,
  bindController(salesController.pendingSalesReportTable)
);
router.get(
  '/pendingCustomerReportTable',
  prepareBranchPaginatedReportQuery,
  bindController(salesController.pendingCustomerReportTable)
);

// Legacy tax report route that frontend still requests under /sales
router.get(
  '/taxSalesReports',
  prepareBranchReportQuery,
  bindController(salesController.taxSalesReports)
);

// Legacy payment report routes that frontend still requests under /sales
router.get(
  '/paymentSalesTranscationReportTable',
  preparePaymentPaginatedReportQuery,
  bindController(salesController.paymentSalesTranscationReportTable)
);
router.get(
  '/paymentSaleTypeReport',
  prepareBranchReportQuery,
  bindController(salesController.paymentSaleTypeReport)
);
router.get(
  '/paymentReturnSalesTranscationReportTable',
  preparePaymentPaginatedReportQuery,
  bindController(salesController.paymentReturnSalesTranscationReportTable)
);
router.get(
  '/paymentGraphicalReports',
  prepareBranchReportQuery,
  bindController(salesController.paymentGraphicalReports)
);

// PHP: salesReceipt() - Email sales receipt
router.post('/salesReceipt', bindController(salesController.salesReceipt));

// PHP: getCustomerPrint() - registered above router.use(protect) as a PUBLIC route
// (customer receipt link needs no JWT). See "Public customer receipt link" section.

// Frontend: sales_view.js expects this endpoint for PDF open
router.get('/salesPdf', bindController(salesController.salesPdf));

// Permanent S3 invoice link (cloud): the key is the secret.
router.post('/:id/invoiceLink', bindController(salesController.createInvoiceLink));

// PHP: salesMailPdf() - Generate and email PDF invoice
router.get('/salesMailPdf', bindController(salesController.salesMailPdf));

// PHP: returnSales() - Process sales return
router.post('/returnSales', bindController(salesController.returnSales));

// PHP: exportSales() - Export sales data
router.post('/exportSales', bindController(salesController.exportSales));

// Frontend POSTs to lowercase /exportsales (from PosnicPro.getExportValue)
router.post('/exportsales', bindController(salesController.exportSales));

// Frontend sometimes opens this legacy path in a new tab
// Controller now handles both GET (with query params) and POST (with body)
router.get('/exportsales', bindController(salesController.exportSales));

// PHP: getDataChanges() - Get data changes for sync
router.get('/getDataChanges', bindController(salesController.getDataChanges));

// PHP: getReturnSalesDetails() - Get return sales details
router.get('/getReturnSalesDetails', bindController(salesController.getReturnSalesDetails));

// PHP: returnPrintDetails() - Get return print details
router.get('/returnPrintDetails', bindController(salesController.returnPrintDetails));

// PHP: getSalesAjaxList() - Get sales list for autocomplete
router.get('/getSalesAjaxList', bindController(salesController.getSalesAjaxList));

// PHP: getSaleQtyDetail() - Get sale quantity detail
router.get('/getSaleQtyDetail', bindController(salesController.getSaleQtyDetail));

// PHP: ServerStatus() - Server status check
router.get('/ServerStatus', bindController(salesController.ServerStatus));

// PHP: customerSaleDetails() - Get customer sale details
router.get('/customerSaleDetails', bindController(salesController.customerSaleDetails));

// PHP: customerCategorySaleDetails() - Get customer category sale details
router.get(
  '/customerCategorySaleDetails',
  bindController(salesController.customerCategorySaleDetails)
);

// PHP: itemSaleDetails() - Get item sale details
router.get('/itemSaleDetails', bindController(salesController.itemSaleDetails));

// PHP: categorySaleDetails() - Get category sale details
router.get('/categorySaleDetails', bindController(salesController.categorySaleDetails));

// PHP: userSalesDetails() - Get user sales details
router.get('/userSalesDetails', bindController(salesController.userSalesDetails));

// PHP: returnProductDetails() - Get return product details
router.get('/returnProductDetails', bindController(salesController.returnProductDetails));

// PHP: returnProductView() - Get return product view
router.get('/returnProductView', bindController(salesController.returnProductView));

// PHP: pendingProductDetails() - Get pending product details
router.get('/pendingProductDetails', bindController(salesController.pendingProductDetails));

// PHP: gstOneReportTable() - Get GST-1 report
router.get(
  '/gstOneReportTable',
  prepareGstOneReportContext,
  bindController(salesController.gstOneReportTable)
);

// PHP: gstThreeReportTable() - Get GST-3 report
router.get(
  '/gstThreeReportTable',
  prepareGstThreeReportContext,
  bindController(salesController.gstThreeReportTable)
);

// PHP: gstOneReportTableJson() - Get GST-1 report JSON
router.get(
  '/gstOneReportTableJson',
  prepareGstOneReportContext,
  bindController(salesController.gstOneReportTableJson)
);

// PHP: dailySalesMail() - Send daily sales email
router.post('/dailySalesMail', bindController(salesController.dailySalesMail));

// PHP: salesPaymentClose() - Close sales payment
router.post('/salesPaymentClose', bindController(salesController.salesPaymentClose));

// PHP: qrCodeClose() - Close QR code
router.get('/qrCodeClose', bindController(salesController.qrCodeClose));

// PHP: qrSalePayementUpdate() - Update QR sale payment
router.get('/qrSalePayementUpdate', bindController(salesController.qrSalePayementUpdate));

// PHP: generateQrCode() - Generate QR code
router.get('/generateQrCode', bindController(salesController.generateQrCode));

// PHP: getQrStatus() - Get QR status
router.get('/getQrStatus', bindController(salesController.getQrStatus));

// PHP: phonepeQr() - Generate PhonePe QR
router.get('/phonepeQr', bindController(salesController.phonepeQr));

// PHP: phonepeQrStatus() - Get PhonePe QR status
router.get('/phonepeQrStatus', bindController(salesController.phonepeQrStatus));

// PHP: createRazorPayMobile() - Create RazorPay for mobile
router.post('/createRazorPayMobile', bindController(salesController.createRazorPayMobile));

// PHP: fetchRazorPayQrStatusMobile() - Fetch RazorPay QR status for mobile
router.post(
  '/fetchRazorPayQrStatusMobile',
  bindController(salesController.fetchRazorPayQrStatusMobile)
);

// (qrOrder, getNewSale, getOrderHistory, updateOrder, searchProducts, getFrequentItems moved before protect above)

// PHP: kotDiscountReports() - Get KOT discount reports
router.get('/kotDiscountReports', bindController(salesController.kotDiscountReports));

// PHP: kotTablewiseDetails() - Get KOT table-wise detailed item report
router.get('/kotTablewiseDetails', bindController(salesController.kotTablewiseDetails));

// PHP: getListKot() - (moved before protect for kiosk access — see above)

// PHP: pendingCustomerCategoryReportTable() - Get pending customer category report
router.get(
  '/pendingCustomerCategoryReportTable',
  bindController(salesController.pendingCustomerCategoryReportTable)
);

// PHP: kioskReports() - Get kiosk reports
router.get(
  '/kioskReports',
  prepareKioskPaginatedReportQuery,
  bindController(salesController.kioskReports)
);

// PHP: kiosksSummaryReports() - Get kiosk summary reports
router.get(
  '/kiosksSummaryReports',
  prepareKioskReportQuery,
  bindController(salesController.kiosksSummaryReports)
);

// PHP: kiosksGraphicalReports() - Get kiosk graphical reports
router.get(
  '/kiosksGraphicalReports',
  prepareKioskReportQuery,
  bindController(salesController.kiosksGraphicalReports)
);

// PHP: itemExpiryReportTable() - Get item expiry report
router.get(
  '/itemExpiryReportTable',
  prepareItemExpiryReportQuery,
  bindController(salesController.itemExpiryReportTable)
);

// Legacy bulk delete endpoint used by frontend: DELETE /sales/delete
router.delete('/delete', bindController(salesController.delete));

// Legacy hold endpoint - support creating and updating hold sales
router
  .route('/hold')
  .post(prepareCreateSalePayload, bindController(salesController.holdSale))
  .put(prepareCreateSalePayload, bindController(salesController.holdSale));

// KOT cancel endpoint - must be before generic /:id routes
// Frontend: PosnicPro.get('sales/cancel/' + saleId)
router.get('/cancel/:id', ensureValidSaleIdParam, bindController(salesController.cancel));

// Single sale routes
// Legacy edit screens request /sales/:id/edit expecting same payload as /sales/:id
router.get('/:id/edit', ensureValidSaleIdParam, bindController(salesController.getOne));
router.get('/:id', ensureValidSaleIdParam, bindController(salesController.getOne));
router.put(
  '/:id',
  ensureValidSaleIdParam,
  validateUpdateSale,
  handleValidationErrors,
  prepareUpdateSalePayload,
  bindController(salesController.update)
);
// router.delete("/:id", salesController.delete);

module.exports = router;
