'use strict';

jest.mock('../../../src/controllers/items.controller', () => ({
  accesskiosk: jest.fn(),
  accessQr: jest.fn(),
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

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
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
        'post /accesskiosk',
        'get /',
        'post /itemsImport',
        'post /exportItems',
        'post /',
        'get /:id',
        'put /:id',
      ])
    );
  });
});
