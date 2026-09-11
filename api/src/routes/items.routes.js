const express = require('express');
const router = express.Router();
const itemsController = require('../controllers/items.controller');
const { protect, optionalProtect } = require('../middleware/auth');
const { ensureKioskKey, protectOrKioskKey } = require('../middleware/kiosk-key');
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
router.post('/accessMobileApp', bindController(itemsController.accessMobileApp));

/*
 * The self-service MACHINES in shops, which are a live channel taking real
 * money, and which this route was briefly deleted out from under.
 *
 * The storefront moved to `GET /online-ordering/:storeId/device`, and that is
 * the endpoint to build against. This one stays because the machines are
 * already deployed and cannot be updated from here: they place orders through
 * `POST /sales/kioskOrder`, which never moved, and they read their menu
 * through this. Removing it left them able to sell but unable to load a menu.
 *
 * It answers in the OLD shape on purpose. A machine parsing `kiosk_images`
 * would be no better off receiving a correctly-named `store` it has never
 * heard of. The query underneath is the new one, so there is still only a
 * single storefront implementation.
 */
router.post('/accesskiosk', ensureKioskKey, bindController(itemsController.accesskiosk));

/*
 * The menu, for a waiter's phone - the captain app.
 *
 * Deleted with the rest of the old online-ordering shapes on the grounds that
 * nobody was using the channel. The kiosk route came back a commit later
 * because the machines in shops could not load a menu; this is the same fact
 * about a different device. Captain builds are signed, published and already
 * installed on phones, and a phone cannot be updated from here.
 *
 * TWO THINGS CHANGED WHILE IT WAS AWAY, and both are kept.
 *
 * It is no longer anonymous. It never should have been: it took a branch's raw
 * database id, which is in every authenticated response and is no secret, and
 * answered with that branch's catalogue. Now it is a signed-in user or the
 * shop's own equipment - which every captain handset already is, because it
 * sends the token it logged in with to every other route it calls.
 *
 * And it asks for the TABLESIDE channel, not the customer one. A line a shop
 * will not put in front of a stranger's phone can be perfectly fine for a
 * waiter standing at the table, and until now those were the same list.
 *
 * `GET /online-ordering/:storeId/device` is what to build new work against.
 * This is that query wearing the old field names, so there is still one
 * storefront implementation rather than two that drift.
 */
router.post(
  '/accessQr',
  optionalProtect,
  protectOrKioskKey,
  bindController(itemsController.accessQr)
);

// Protect all remaining item routes to ensure req.user context is available
router.use(protect);

// GET /api/items - Get paginated items (legacy default endpoint)
/*
 * The catalogue seen from one channel, and the two ways a shop changes it.
 *
 * Declared before '/' and before '/:id' so neither swallows them. Behind the
 * normal session: deciding what a channel sells is a shop decision made by a
 * person who is signed in, never by the anonymous storefront.
 */
/*
 * The emoji a name suggests, for the item form's live preview.
 *
 * A round trip rather than the same keyword table shipped twice. The guess
 * decides what a CUSTOMER sees on the menu; a second copy in the browser is a
 * second copy that can drift, and the drift shows up as a shopkeeper being
 * shown one picture while their customers are shown another - which is the
 * kind of bug nobody reports because nobody can see both screens at once.
 *
 * Declared before '/:id' so that route does not swallow it.
 */
router.get('/icon-suggestion', bindController(itemsController.iconSuggestion));

router.get('/channel', bindController(itemsController.channelItems));
router.post('/channel', bindController(itemsController.setChannelForItems));
router.post('/:id/channel-hours', bindController(itemsController.setChannelHours));

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

// POST /api/items/aiDescription - draft a description for an item being
// filled in. Writes nothing; the text lands in the form for a person to
// edit and save. Gated on item.write because it spends the shop's own
// AI balance. Availability lives here too, so the screen can decide
// whether to show the button at all; it moves to its own route when a
// second screen needs it.
router.post('/aiDescription', bindController(itemsController.aiDescription));
router.get('/aiAvailability', bindController(itemsController.aiAvailability));
router.get('/aiSpend', bindController(itemsController.aiSpend));

// PHP: exportItems() - Excel export
router.post('/exportItems', bindController(itemsController.exportItems));

// GET /api/items/export/jsonld - the catalogue as schema.org JSON-LD.
// A different SHAPE of what /items already returns, gated on the same
// item:read. See docs PRODUCT_EXPORT_FORMATS.md.
router.get('/export/jsonld', bindController(itemsController.exportCatalogueJsonLd));

// DELETE /api/items/demo - remove the sample products for good.
// Separate from the Demo Data switch, which only hides them: this one
// destroys, and refuses anything sold, received or edited.
router.delete('/demo', bindController(itemsController.purgeDemoData));

// POST /api/items/demo - put the sample data back, for a shop that removed
// it and later wants it. Refuses if it is already there. An optional
// businessType installs a DIFFERENT trade's catalogue, for the shop that
// signed up as one thing and turned out to be another.
router.post('/demo', bindController(itemsController.reseedDemoData));

// GET /api/items/demo/packs - the trades a shop can pick from, and which one
// it is on. Declared BEFORE any '/demo/:something' route would be: Express
// matches in order, and a parameterised sibling added later would otherwise
// swallow this path and answer it with the wrong handler.
router.get('/demo/packs', bindController(itemsController.listDemoPacks));

// Raise/lower prices across many items at once; and a per-item price history.
// V1 variant families: all-or-nothing creation of linked variant items,
// and the members of one family for the edit page's strip.
router.post('/createFamily', bindController(itemsController.createFamily));
router.get('/family', bindController(itemsController.getFamily));
router.post('/bulkUpdatePrices', bindController(itemsController.bulkUpdatePrices));
router.post('/bulkPricePreview', bindController(itemsController.bulkPricePreview));
router.post('/bulkSetMargin', bindController(itemsController.bulkSetMargin));
router.post('/marginPreview', bindController(itemsController.marginPreview));
router.get('/priceHistory/:id', bindController(itemsController.getPriceHistory));
router.get('/bulkPriceHistory', bindController(itemsController.getBulkPriceUpdates));

// Add/remove stock across many items at once, with a note, audited to stocklogs.
router.post('/bulkUpdateStock', bindController(itemsController.bulkUpdateStock));
router.post('/bulkStockPreview', bindController(itemsController.bulkStockPreview));
router.get('/bulkStockHistory', bindController(itemsController.getBulkStockUpdates));

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

// All (or only low-stock) items of one supplier - the receiving autofill.
router.get('/bySupplier', bindController(itemsController.getItemsBySupplier));

// Reasoned per-item stock adjustment: count sets, loss/damage subtract.
router.post('/stockAdjustment', bindController(itemsController.stockAdjustment));

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

// Sale-screen inline edit: targeted money-field patch (write ACL)
router.post('/quickPatch', bindController(itemsController.quickPatch));

// GST 2.0 readiness checklist - read-only, report ACL. Declared before the
// /:id route so 'gstReadiness' is not read as an item id.
router.get('/gstReadiness', bindController(itemsController.gstReadiness));

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
