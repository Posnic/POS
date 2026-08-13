const express = require('express');
const router = express.Router();
const itemsController = require('../controllers/items.controller');
const { protect } = require('../middleware/auth');
const {
  validateCreateItem,
  validateUpdateItem,
  ensureValidItemIdParam,
} = require('../middleware/items.validation');

const bindController = (handler, controller = itemsController) => {
  if (typeof handler === 'function') {
    return handler.bind(controller);
  }

  return (req, res, next) => {
    if (typeof controller.error === 'function') {
      return controller.error(res, 'Handler not implemented', 501);
    }

    return res.status(501).json({
      success: false,
      message: 'Handler not implemented',
      data: null,
    });
  };
};

// --- Public / self-authenticated routes (kiosk, QR, mobile) ---
// These endpoints authenticate via their own headers (e.g. kioskkey)
// and must be registered BEFORE the protect middleware.
router.post('/accesskiosk', bindController(itemsController.accesskiosk));
router.post('/accessQr', bindController(itemsController.accessQr));
router.post('/accessMobileApp', bindController(itemsController.accessMobileApp));

// Protect all remaining item routes to ensure req.user context is available
router.use(protect);

// GET /api/items - Get paginated items (legacy default endpoint)
router.get('/', bindController(itemsController.getAll));

// Legacy low stock endpoint expected by frontend dashboard
router.get('/itemLowStockTable', bindController(itemsController.itemLowStockTable));

// Legacy autocomplete endpoint for online items
router.get('/getOnlineItemsAjaxList', bindController(itemsController.getOnlineItemsAjaxList));

router.get('/onlineSalesItemsAjaxLists', bindController(itemsController.onlineSalesItemsAjaxLists));

// Legacy instant item creation endpoint
router.post('/instanceItemInsert', bindController(itemsController.instanceItemInsert));

// Legacy instant delete endpoint - support both POST and DELETE verbs
router
  .route('/deleteInstant')
  .post(bindController(itemsController.deleteInstant))
  .delete(bindController(itemsController.deleteInstant));

// Legacy item details endpoint
// GET /api/items/category/:categoryId - Get items by category
router.get('/category/:categoryId', bindController(itemsController.getByCategory));

// GET /api/items/search - Search items by name or barcode
router.get('/search', bindController(itemsController.search));

// GET /api/items/quantityCount - Get count of items by quantity range
router.get('/quantityCount', bindController(itemsController.quantityCount));

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', bindController(itemsController.getDataChanges));

// PHP: itemsImport() - Bulk import
router.post('/itemsImport', bindController(itemsController.itemsImport));

// PHP: exportItems() - Excel export
router.post('/exportItems', bindController(itemsController.exportItems));

// Raise/lower prices across many items at once; and a per-item price history.
router.post('/bulkUpdatePrices', bindController(itemsController.bulkUpdatePrices));
router.post('/bulkPricePreview', bindController(itemsController.bulkPricePreview));
router.post('/bulkSetMargin', bindController(itemsController.bulkSetMargin));
router.post('/marginPreview', bindController(itemsController.marginPreview));
router.get('/priceHistory/:id', bindController(itemsController.getPriceHistory));
router.get('/bulkPriceHistory', bindController(itemsController.getBulkPriceUpdates));

// PHP: categoryItemsReportTable() - Category report
router.get('/categoryItemsReportTable', bindController(itemsController.categoryItemsReportTable));

// PHP: supplierItemsReportTable() - Supplier report
router.get('/supplierItemsReportTable', bindController(itemsController.supplierItemsReportTable));

// PHP: itemReportTable() - Items report
router.get('/itemReportTable', bindController(itemsController.itemReportTable));

// PHP: uploadItemMultiImage() - Upload images
router.post('/uploadItemMultiImage', bindController(itemsController.uploadItemMultiImage));

// PHP: getReceivingItemsAjaxList() - Receiving autocomplete
router.get('/getReceivingItemsAjaxList', bindController(itemsController.getReceivingItemsAjaxList));

// PHP: updateKioskStatus() - Update kiosk status
router.post('/updateKioskStatus', bindController(itemsController.updateKioskStatus));

// PHP: bulkUpdateKioskStatus() - Bulk update kiosk status
router.post('/bulkUpdateKioskStatus', bindController(itemsController.bulkUpdateKioskStatus));

// PHP: getItemsByCategoryId() - Get items by category
router.get('/getItemsByCategoryId', bindController(itemsController.getItemsByCategoryId));

// PHP: itemSearchTable() - Search items with price range
router.get('/itemSearchTable', bindController(itemsController.itemSearchTable));

// PHP: updateItemQuantity() - Update item quantity
router.post('/updateItemQuantity', bindController(itemsController.updateItemQuantity));

// PHP: categoryProductDetails() - Category product details
router.get('/categoryProductDetails', bindController(itemsController.categoryProductDetails));

// PHP: supplierProductDetails() - Supplier product details
router.get('/supplierProductDetails', bindController(itemsController.supplierProductDetails));

// PHP: getCustomerSearchItemsAjaxList() - Customer search autocomplete
router.get(
  '/getCustomerSearchItemsAjaxList',
  bindController(itemsController.getCustomerSearchItemsAjaxList)
);

// PHP: itemStockReportTable() - Item stock report
router.get('/itemStockReportTable', bindController(itemsController.itemStockReportTable));

// PHP: getJSONhsncode() - Get HSN codes
router.get('/getJSONhsncode', bindController(itemsController.getJSONhsncode));

// PHP: add() - Create new item (POST /items)
router.post('/', validateCreateItem, bindController(itemsController.add));

// PHP: delete() - Delete items (DELETE /items)
router.delete('/', bindController(itemsController.delete));

// Legacy bulk delete endpoint used by frontend: DELETE /items/delete
router.delete('/delete', bindController(itemsController.delete));

// Legacy edit endpoint: GET /items/getItemDetails?id={id}
router.get('/getItemDetails', bindController(itemsController.getItemDetails));

// PHP: getOne() - Get single item by ID
router.get('/:id', ensureValidItemIdParam, bindController(itemsController.getOne));

// PHP: edit() - Update existing item (PUT /items/:id)
router.put(
  '/:id',
  ensureValidItemIdParam,
  validateUpdateItem,
  bindController(itemsController.edit)
);

module.exports = router;
