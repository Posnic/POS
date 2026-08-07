const express = require('express');
const router = express.Router();
const customersController = require('../controllers/customers.controller');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateSearch,
  validateLoyaltyPoints,
  validatePreferences,
  validateImport,
} = require('../middleware/customers.validation');

// Ensure all customer routes require authentication to populate req.user
router.use(protect);

// GET /api/customers - Get all customers with pagination and filters
router.get(
  '/',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomers(req, res);
  })
);

// GET /api/customers/search - Search customers (legacy autocomplete)
router.get(
  '/search',
  validateSearch,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.searchCustomers(req, res);
  })
);

// Legacy endpoint: GET /api/customers/getCustomersAjaxList
router.get(
  '/getCustomersAjaxList',
  validateSearch,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomersAjaxList(req, res);
  })
);

// Legacy customer graphical reports endpoint
router.get(
  '/customerGraphicalReports',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.customerGraphicalReports(req, res);
  })
);

// PHP: getDataChanges() - Data sync
router.get(
  '/getDataChanges',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getDataChanges(req, res);
  })
);

// PHP: customersImport() - Bulk import
router.post(
  '/customersImport',
  validateImport,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.customersImport(req, res);
  })
);

// PHP: customerOutstandingReportTable() - Outstanding report
router.get(
  '/customerOutstandingReportTable',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.customerOutstandingReportTable(req, res);
  })
);

// PHP: exportCustomers() - Export customers
router.post(
  '/exportCustomers',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.exportCustomers(req, res);
  })
);

// Frontend POSTs to lowercase /exportcustomers (from PosnicPro.getExportValue)
router.post(
  '/exportcustomers',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.exportCustomers(req, res);
  })
);

// PHP: customerPaymentDetails() - Get customer payment details
router.get(
  '/customerPaymentDetails',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.customerPaymentDetails(req, res);
  })
);

// PHP: getCustomerDetails() - Legacy endpoint using ?id=
router.get(
  '/getCustomerDetails',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomer(req, res);
  })
);

// PHP: transactionDetails() - Get transaction details
router.get(
  '/transactionDetails',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.transactionDetails(req, res);
  })
);

// PHP: transaction() - Create transaction
router.post(
  '/transaction',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.transaction(req, res);
  })
);

// PHP: deleteTransaction() - Delete transaction
router.delete(
  '/deleteTransaction',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.deleteTransaction(req, res);
  })
);

// PHP: uploadTransactionImage() - Upload transaction image
router.post(
  '/uploadTransactionImage',
  upload.single('ImageTransaction'),
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.uploadTransactionImage(req, res);
  })
);

// GET /api/customers/tier/:tier - Get customers by loyalty tier
router.get(
  '/tier/:tier',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomersByTier(req, res);
  })
);

// GET /api/customers/:id/summary - Get customer summary
router.get(
  '/:id/summary',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomerSummary(req, res);
  })
);

// GET /api/customers/:id - Get customer by ID (keep last to avoid conflicts)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.getCustomer(req, res);
  })
);

// POST /api/customers - Create new customer
router.post(
  '/',
  validateCreateCustomer,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.createCustomer(req, res);
  })
);

// POST /api/customers/:id/loyalty/points - Add loyalty points
router.post(
  '/:id/loyalty/points',
  validateLoyaltyPoints,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.addLoyaltyPoints(req, res);
  })
);

// POST /api/customers/:id/loyalty/redeem - Redeem loyalty points
router.post(
  '/:id/loyalty/redeem',
  validateLoyaltyPoints,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.redeemPoints(req, res);
  })
);

// PUT /api/customers/:id/preferences - Update customer preferences
router.put(
  '/:id/preferences',
  validatePreferences,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.updatePreferences(req, res);
  })
);

// PUT /api/customers/:id - Update customer (define after preferences)
router.put(
  '/:id',
  validateUpdateCustomer,
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.updateCustomer(req, res);
  })
);

// DELETE /customers/delete - Legacy bulk delete endpoint
router.delete(
  '/delete',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.delete(req, res);
  })
);

// DELETE /api/customers/:id - Delete single customer (soft delete)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    customersController.setRequestContext(req);
    return await customersController.deleteCustomer(req, res);
  })
);

module.exports = router;
