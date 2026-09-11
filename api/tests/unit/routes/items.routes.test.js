'use strict';

jest.mock('../../../src/controllers/items.controller', () => ({
  accessQr: jest.fn(),
  accesskiosk: jest.fn(),
  accessMobileApp: jest.fn(),
  getAll: jest.fn(),
  itemLowStockTable: jest.fn(),
  getOnlineItemsAjaxList: jest.fn(),
  onlineSalesItemsAjaxLists: jest.fn(),
  instanceItemInsert: jest.fn(),
  deleteInstant: jest.fn(),
  getByCategory: jest.fn(),
  search: jest.fn(),
  quantityCount: jest.fn(),
  getDataChanges: jest.fn(),
  itemsImport: jest.fn(),
  exportItems: jest.fn(),
  categoryItemsReportTable: jest.fn(),
  supplierItemsReportTable: jest.fn(),
  itemReportTable: jest.fn(),
  uploadItemMultiImage: jest.fn(),
  getReceivingItemsAjaxList: jest.fn(),
  updateKioskStatus: jest.fn(),
  bulkUpdateKioskStatus: jest.fn(),
  getItemsByCategoryId: jest.fn(),
  itemSearchTable: jest.fn(),
  updateItemQuantity: jest.fn(),
  categoryProductDetails: jest.fn(),
  supplierProductDetails: jest.fn(),
  getCustomerSearchItemsAjaxList: jest.fn(),
  itemStockReportTable: jest.fn(),
  getJSONhsncode: jest.fn(),
  add: jest.fn(),
  delete: jest.fn(),
  getItemDetails: jest.fn(),
  getOne: jest.fn(),
  edit: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  optionalProtect: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../src/middleware/items.validation', () => ({
  validateCreateItem: [],
  validateUpdateItem: [],
  ensureValidItemIdParam: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/items.routes');

describe('items.routes', () => {
  test('exposes key item routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /',
        'post /itemsImport',
        'post /exportItems',
        'post /',
        'get /:id',
        'put /:id',
      ])
    );
  });

  /*
   * The captain app's menu. Deleted once already on the grounds that nobody
   * was using the channel, while signed builds of the app were being installed
   * on phones that cannot be updated from here.
   */
  test('the captain handsets can still load a menu', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toContain('post /accessQr');
  });

  test('and it is NOT anonymous, which is the one thing that changed', () => {
    const { protectOrKioskKey } = require('../../../src/middleware/kiosk-key');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/accessQr' && l.route.methods.post
    );
    const guards = layer.route.stack.map((h) => h.handle);
    expect(guards).toContain(protectOrKioskKey);
    /* It used to take a branch's raw database id - which is in every
       authenticated response and is no secret - from anybody at all, and
       answer with that branch's catalogue. */
    expect(guards.length).toBeGreaterThan(1);
  });
});
