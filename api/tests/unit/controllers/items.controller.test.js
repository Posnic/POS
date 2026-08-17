/**
 * Unit tests for items.controller.js
 *
 * Architecture:
 *  - ItemsController extends BaseController (singleton export — module.exports = new ItemsController())
 *  - 2004 lines / ~37 instance methods
 *  - CRITICAL BUG: 4 methods are DUPLICATED in the class body (last definition wins in JS):
 *      delete (line 398 → overridden by line 1618)
 *      getReceivingItemsAjaxList (line 308 → overridden by line 1675)
 *      categoryItemsReportTable (line 975 → overridden by line 1754)
 *      supplierItemsReportTable (line 1037 → overridden by line 1860)
 *  - 'search' and 'getDataChanges' are referenced in routes but NOT defined → routes return 501 via bindController
 *  - Uses mongoose.Types.ObjectId (not mongodb ObjectId like other controllers)
 *  - Three access-check patterns:
 *      === false  → only block explicit false (getAll, exportItems, itemsImport, itemLowStockTable)
 *      !== true   → block everything except explicit true (delete, categoryItemsReportTable, supplierItemsReportTable)
 *      checkPermission() → BaseController role bypass (first/overridden versions — not reachable)
 *
 * Mocks: ItemService, base.service, base.model, session-filter.util, helpers (real)
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../../src/services/item.service', () =>
  jest.fn().mockImplementation(() => ({
    resolveBranchContext: jest.fn().mockResolvedValue({}),
    getAllItems: jest.fn(),
    getLowStockItems: jest.fn(),
    getReceivingItemsAjaxList: jest.fn(),
    addItem: jest.fn(),
    deleteItems: jest.fn(),
    getItemsByCategory: jest.fn(),
    updateItem: jest.fn(),
    accessKiosk: jest.fn(),
    createInstantItem: jest.fn(),
    deleteInstantItem: jest.fn(),
    updateKioskStatus: jest.fn(),
    getItemsByCategoryId: jest.fn(),
    getItemById: jest.fn(),
    itemSearchPage: jest.fn(),
    getOnlineSalesItems: jest.fn(),
    getOnlineItemsAjaxList: jest.fn(),
    accessQr: jest.fn(),
    accessMobileApp: jest.fn(),
    updateItemQuantity: jest.fn(),
    categoryItemsReportTable: jest.fn(),
    supplierItemsReportTable: jest.fn(),
    categoryProductDetails: jest.fn(),
    supplierProductDetails: jest.fn(),
    getCustomerSearchItems: jest.fn(),
    getBranchNotificationRange: jest.fn(),
    quantityCount: jest.fn(),
    itemStockReportTable: jest.fn(),
    exportItems: jest.fn(),
    importItems: jest.fn(),
    getHsnCodes: jest.fn(),
    uploadItemImages: jest.fn(),
    itemReportTable: jest.fn(),
    bulkUpdatePrices: jest.fn(),
    previewBulkUpdatePrices: jest.fn(),
    bulkUpdateStock: jest.fn(),
    previewBulkUpdateStock: jest.fn(),
    getBulkStockUpdates: jest.fn(),
    getPriceHistory: jest.fn(),
  }))
);

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => {
  const s = {};
  return class MockBaseModel {
    static get currentBranch() {
      return s.currentBranch;
    }
    static set currentBranch(v) {
      s.currentBranch = v;
    }
    static get license() {
      return s.license;
    }
    static set license(v) {
      s.license = v;
    }
    static get loggedUser() {
      return s.loggedUser;
    }
    static set loggedUser(v) {
      s.loggedUser = v;
    }
    static get loggedUserName() {
      return s.loggedUserName;
    }
    static set loggedUserName(v) {
      s.loggedUserName = v;
    }
  };
});

jest.mock('../../../src/utils/session-filter.util', () => ({
  applySessionFilter: jest.fn().mockResolvedValue({
    start_date: new Date('2025-01-01'),
    end_date: new Date('2025-12-31'),
    session_applied: false,
  }),
  applySessionFilterToPipeline: jest.fn(),
  applySessionFilterToSalesFilters: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const sessionFilterUtil = require('../../../src/utils/session-filter.util');
const { ERROR_MESSAGES } = require('../../../src/constants/items.constants');

let ctrl;
let svc;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
const VALID_BRANCH = '64f8f2f4c2b9c0a1e4b22222';
const VALID_LIC = '64f8f2f4c2b9c0a1e4b11111';

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  ...overrides,
});

const adminUser = (overrides = {}) => ({
  _id: VALID_ID,
  name: 'Admin',
  username: 'admin',
  email: 'admin@test.com',
  usertype: 'super_admin',
  license: VALID_LIC,
  branch_id: VALID_BRANCH,
  access: {
    item: { read: true, write: true, delete: true },
    report: { read: true },
  },
  ...overrides,
});

const restrictedUser = (overrides = {}) => ({
  _id: VALID_ID,
  usertype: 'cashier',
  license: VALID_LIC,
  branch_id: VALID_BRANCH,
  access: {
    item: { read: false, write: false, delete: false },
    report: { read: false },
  },
  ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  ctrl = require('../../../src/controllers/items.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Reset singleton model context between tests
  ctrl.model = {};
  // Replace service with fresh mock instance
  svc = ctrl.service;
  // Default resolveBranchContext returns empty (no-op)
  svc.resolveBranchContext.mockResolvedValue({});
});

// =============================================================================
// Utility Methods
// =============================================================================

describe('parseFilters', () => {
  test('returns {} for null/undefined input', () => {
    expect(ctrl.parseFilters(null)).toEqual({});
    expect(ctrl.parseFilters(undefined)).toEqual({});
  });

  test('returns object input unchanged', () => {
    const f = { category: 'food' };
    expect(ctrl.parseFilters(f)).toBe(f);
  });

  test('parses valid JSON string', () => {
    expect(ctrl.parseFilters('{"name":"test"}')).toEqual({ name: 'test' });
  });

  test('returns {} for invalid JSON string (array)', () => {
    expect(ctrl.parseFilters('[1,2,3]')).toEqual({});
  });

  test('returns {} for non-string/non-object input', () => {
    expect(ctrl.parseFilters(42)).toEqual({});
  });
});

describe('normalizeBranchesInput', () => {
  test('returns [] for null', () => {
    expect(ctrl.normalizeBranchesInput(null)).toEqual([]);
  });

  test('returns array unchanged', () => {
    expect(ctrl.normalizeBranchesInput([VALID_ID])).toEqual([VALID_ID]);
  });

  test('splits comma-separated string into array', () => {
    expect(ctrl.normalizeBranchesInput(`${VALID_ID},${VALID_BRANCH}`)).toEqual([
      VALID_ID,
      VALID_BRANCH,
    ]);
  });

  test('wraps single string into array', () => {
    expect(ctrl.normalizeBranchesInput(VALID_ID)).toEqual([VALID_ID]);
  });
});

// =============================================================================
// getAll
// =============================================================================

describe('getAll', () => {
  test('returns 200 with data on success', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: { list: [] }, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 403 when access.item.read is explicitly false', async () => {
    const req = mockReq({ query: {}, user: adminUser({ access: { item: { read: false } } }) });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(svc.getAllItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when service status is false', async () => {
    svc.getAllItems.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('passes parsed filters to service', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { filters: '{"name":"rice"}' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledArgs] = svc.getAllItems.mock.calls[0];
    expect(calledArgs.filters).toEqual({ name: 'rice' });
  });

  test('caps limit at 100', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { limit: '999', page: '2' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledArgs] = svc.getAllItems.mock.calls[0];
    expect(calledArgs.options.limit).toBe(100);
    expect(calledArgs.options.page).toBe(2);
  });

  test('defaults limit=5 and page=1 for invalid query params', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { limit: '0', page: '-1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledArgs] = svc.getAllItems.mock.calls[0];
    expect(calledArgs.options.limit).toBe(5);
    expect(calledArgs.options.page).toBe(1);
  });

  test('returns 500 when service throws', async () => {
    svc.getAllItems.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// add
// =============================================================================

describe('add', () => {
  const itemBody = { name: 'Rice 1kg', selling_price: 50 };

  test('returns 200 with created item on success', async () => {
    svc.addItem.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, ...itemBody },
      message: 'ok',
    });
    const req = mockReq({ body: itemBody, user: adminUser() });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('passes branchId, licenseId, user, and body to service', async () => {
    svc.addItem.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const user = adminUser();
    const req = mockReq({ body: itemBody, user });
    const res = mockRes();
    await ctrl.add(req, res);
    const [calledArgs] = svc.addItem.mock.calls[0];
    expect(calledArgs.data).toEqual(itemBody);
    expect(calledArgs.user).toBe(user);
  });

  test('uses the active session branch and authenticated license, ignoring payload scope', async () => {
    svc.addItem.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const user = adminUser();
    const req = mockReq({
      session: { selectedBranchId: VALID_BRANCH },
      body: { ...itemBody, branch_id: VALID_ID, license_id: VALID_ID },
      user,
    });
    const res = mockRes();

    await ctrl.add(req, res);

    const [calledArgs] = svc.addItem.mock.calls[0];
    expect(calledArgs.branchId.toString()).toBe(VALID_BRANCH);
    expect(calledArgs.licenseId.toString()).toBe(VALID_LIC);
  });

  test('returns 400 with the service message when creation is rejected', async () => {
    svc.addItem.mockResolvedValue({ status: false, data: null, message: 'failed' });
    const req = mockReq({ body: itemBody, user: adminUser() });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'failed' })
    );
  });

  test('returns 409 when the item already exists', async () => {
    svc.addItem.mockResolvedValue({
      status: 'exist',
      data: null,
      message: 'This item details already exist in our system',
    });
    const req = mockReq({ body: itemBody, user: adminUser() });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'This item details already exist in our system',
      })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.addItem.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: itemBody, user: adminUser() });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// delete  (LAST DEFINITION — line 1618: requires access.item.delete === true)
// =============================================================================

describe('delete', () => {
  test('returns 200 with deleted count when ids provided via body.data', async () => {
    svc.deleteItems.mockResolvedValue({ status: true, data: 2 });
    const req = mockReq({ body: { data: [VALID_ID, VALID_BRANCH] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 400 when body.data is missing', async () => {
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(svc.deleteItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when body.data is empty array', async () => {
    const req = mockReq({ body: { data: [] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 403 when access.item.delete is not explicitly true', async () => {
    svc.deleteItems.mockResolvedValue({ status: true, data: 1 });
    const req = mockReq({
      body: { data: [VALID_ID] },
      user: adminUser({ access: { item: { delete: false } } }),
    });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(svc.deleteItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when service returns status false', async () => {
    svc.deleteItems.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.deleteItems.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// edit
// =============================================================================

describe('edit', () => {
  test('returns 200 on successful update', async () => {
    svc.updateItem.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const req = mockReq({ params: { id: VALID_ID }, body: { name: 'Updated' }, user: adminUser() });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 400 when id param is missing', async () => {
    const req = mockReq({ params: {}, body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(svc.updateItem).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when service returns status false', async () => {
    svc.updateItem.mockResolvedValue({ status: false, data: null, message: 'fail' });
    const req = mockReq({ params: { id: VALID_ID }, body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 when service throws', async () => {
    svc.updateItem.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ params: { id: VALID_ID }, body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('getOne', () => {
  test('returns 200 with item data when found via params.id', async () => {
    svc.getItemById.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when no id is provided', async () => {
    const req = mockReq({ params: {}, query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(svc.getItemById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when item not found', async () => {
    svc.getItemById.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.getItemById.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getItemDetails
// =============================================================================

describe('getItemDetails', () => {
  test('returns 200 when item found via query.id', async () => {
    svc.getItemById.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when query.id is missing', async () => {
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemDetails(req, res);
    expect(svc.getItemById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when item not found', async () => {
    svc.getItemById.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// getByCategory
// =============================================================================

describe('getByCategory', () => {
  test('returns 200 with items list on success', async () => {
    svc.getItemsByCategory.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ params: { categoryId: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getByCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when service returns status false', async () => {
    svc.getItemsByCategory.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ params: { categoryId: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getByCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 when service throws', async () => {
    svc.getItemsByCategory.mockRejectedValue(new Error('crash'));
    const req = mockReq({ params: { categoryId: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getByCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getItemsByCategoryId
// =============================================================================

describe('getItemsByCategoryId', () => {
  test('returns 200 with items on success', async () => {
    svc.getItemsByCategoryId.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ query: { category_id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemsByCategoryId(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when category_id is missing', async () => {
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemsByCategoryId(req, res);
    expect(svc.getItemsByCategoryId).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when service fails', async () => {
    svc.getItemsByCategoryId.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ query: { category_id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getItemsByCategoryId(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// instanceItemInsert
// =============================================================================

describe('instanceItemInsert', () => {
  test('returns 200 with created item', async () => {
    ctrl.model = { branchId: VALID_BRANCH, licenseId: VALID_LIC };
    svc.createInstantItem.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'ok',
    });
    const req = mockReq({ body: { name: 'Instant' }, user: adminUser() });
    const res = mockRes();
    await ctrl.instanceItemInsert(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when branchId/licenseId missing after context resolution', async () => {
    ctrl.model = {};
    svc.resolveBranchContext.mockResolvedValue({});
    const req = mockReq({ body: {}, user: {} });
    const res = mockRes();
    await ctrl.instanceItemInsert(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED,
      })
    );
  });

  test('returns 500 when service returns status false', async () => {
    ctrl.model = { branchId: VALID_BRANCH, licenseId: VALID_LIC };
    svc.createInstantItem.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.instanceItemInsert(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 when service throws', async () => {
    ctrl.model = { branchId: VALID_BRANCH, licenseId: VALID_LIC };
    svc.createInstantItem.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.instanceItemInsert(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// deleteInstant
// =============================================================================

describe('deleteInstant', () => {
  test('returns 200 on successful deletion', async () => {
    svc.deleteInstantItem.mockResolvedValue({ status: true, data: 1 });
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.deleteInstant(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when no id provided', async () => {
    const req = mockReq({ body: {}, query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.deleteInstant(req, res);
    expect(svc.deleteInstantItem).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when service returns status false', async () => {
    svc.deleteInstantItem.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.deleteInstant(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('also reads id from query.id', async () => {
    svc.deleteInstantItem.mockResolvedValue({ status: true, data: 1 });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.deleteInstant(req, res);
    expect(svc.deleteInstantItem).toHaveBeenCalledWith(expect.objectContaining({ id: VALID_ID }));
  });
});

// =============================================================================
// itemLowStockTable
// =============================================================================

describe('itemLowStockTable', () => {
  test('returns 200 with data on success', async () => {
    svc.getLowStockItems.mockResolvedValue({ status: true, data: { list: [] }, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemLowStockTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when access.item.read is explicitly false', async () => {
    const req = mockReq({ query: {}, user: adminUser({ access: { item: { read: false } } }) });
    const res = mockRes();
    await ctrl.itemLowStockTable(req, res);
    expect(svc.getLowStockItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 500 when service returns status false', async () => {
    svc.getLowStockItems.mockResolvedValue({ status: false, data: null, message: 'error' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemLowStockTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('passes notificationRange to service', async () => {
    svc.getLowStockItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { notificationrange: '10' }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemLowStockTable(req, res);
    const [calledParams] = svc.getLowStockItems.mock.calls[0];
    expect(calledParams.notificationRange).toBe(10);
  });
});

// =============================================================================
// accesskiosk
// =============================================================================

describe('accesskiosk', () => {
  /*
   * Any value serves, because the key is no longer a constant in the source.
   * It is generated per installation and passed in through the environment, so
   * what matters is that the header must match whatever this install was
   * given - not that it equals one particular published string.
   */
  const KIOSK_KEY = 'kiosk-key-for-this-test-run';
  const previousKey = process.env.KIOSK_API_KEY;

  beforeEach(() => {
    process.env.KIOSK_API_KEY = KIOSK_KEY;
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.KIOSK_API_KEY;
    else process.env.KIOSK_API_KEY = previousKey;
  });

  test('refuses when this install has no kiosk key configured', async () => {
    delete process.env.KIOSK_API_KEY;
    const req = mockReq({ headers: { kioskkey: KIOSK_KEY }, body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accesskiosk(req, res);
    // 401, not 403: a kiosk key is device AUTHENTICATION, not a permission.
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 200 on valid kiosk key + service success', async () => {
    svc.accessKiosk.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ headers: { kioskkey: KIOSK_KEY }, body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accesskiosk(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 401 for invalid kiosk key', async () => {
    const req = mockReq({ headers: { kioskkey: 'wrongkey' }, body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accesskiosk(req, res);
    expect(svc.accessKiosk).not.toHaveBeenCalled();
    // 401, not 403: a kiosk key is device AUTHENTICATION, not a permission.
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 when service reports failure', async () => {
    svc.accessKiosk.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ headers: { kioskkey: KIOSK_KEY }, body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accesskiosk(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.accessKiosk.mockRejectedValue(new Error('crash'));
    const req = mockReq({ headers: { kioskkey: KIOSK_KEY }, body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accesskiosk(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// accessQr
// =============================================================================

describe('accessQr', () => {
  test('returns 200 on success', async () => {
    svc.accessQr.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ body: { project_type: 'stock', branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accessQr(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service fails', async () => {
    svc.accessQr.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accessQr(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.accessQr.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.accessQr(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// accessMobileApp
// =============================================================================

describe('accessMobileApp', () => {
  test('returns 200 on success', async () => {
    svc.accessMobileApp.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accessMobileApp(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service fails', async () => {
    svc.accessMobileApp.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accessMobileApp(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.accessMobileApp.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: { branch: VALID_BRANCH } });
    const res = mockRes();
    await ctrl.accessMobileApp(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// updateKioskStatus
// =============================================================================

describe('updateKioskStatus', () => {
  test('returns 200 on success', async () => {
    svc.updateKioskStatus.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ body: { id: VALID_ID, status: true } });
    const res = mockRes();
    await ctrl.updateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service fails', async () => {
    svc.updateKioskStatus.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ body: { id: VALID_ID, status: false } });
    const res = mockRes();
    await ctrl.updateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.updateKioskStatus.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: { id: VALID_ID, status: true } });
    const res = mockRes();
    await ctrl.updateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// bulkUpdateKioskStatus
// =============================================================================

describe('bulkUpdateKioskStatus', () => {
  test('returns 200 with results array on success', async () => {
    svc.updateKioskStatus.mockResolvedValue({ status: true });
    const req = mockReq({ body: { items: [VALID_ID, VALID_BRANCH], status: true } });
    const res = mockRes();
    await ctrl.bulkUpdateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data).toHaveLength(2);
  });

  test('returns 400 when items array is empty', async () => {
    const req = mockReq({ body: { items: [], status: true } });
    const res = mockRes();
    await ctrl.bulkUpdateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when items is not provided', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.bulkUpdateKioskStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('marks individual item as failed when updateKioskStatus throws for it', async () => {
    svc.updateKioskStatus
      .mockResolvedValueOnce({ status: true })
      .mockRejectedValueOnce(new Error('item error'));
    const req = mockReq({ body: { items: [VALID_ID, VALID_BRANCH], status: true } });
    const res = mockRes();
    await ctrl.bulkUpdateKioskStatus(req, res);
    const results = res.json.mock.calls[0][0].data;
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBe('item error');
  });
});

// =============================================================================
// updateItemQuantity
// =============================================================================

describe('updateItemQuantity', () => {
  test('returns 200 on success', async () => {
    svc.updateItemQuantity.mockResolvedValue({ status: true });
    const req = mockReq({ body: { id: VALID_ID, value: 10 } });
    const res = mockRes();
    await ctrl.updateItemQuantity(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when id is missing', async () => {
    const req = mockReq({ body: { value: 5 } });
    const res = mockRes();
    await ctrl.updateItemQuantity(req, res);
    expect(svc.updateItemQuantity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when value is undefined', async () => {
    const req = mockReq({ body: { id: VALID_ID } });
    const res = mockRes();
    await ctrl.updateItemQuantity(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when service returns status !== true', async () => {
    svc.updateItemQuantity.mockResolvedValue({ status: false, message: 'failed' });
    const req = mockReq({ body: { id: VALID_ID, value: 5 } });
    const res = mockRes();
    await ctrl.updateItemQuantity(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('accepts zero as valid quantity', async () => {
    svc.updateItemQuantity.mockResolvedValue({ status: true });
    const req = mockReq({ body: { id: VALID_ID, value: 0 } });
    const res = mockRes();
    await ctrl.updateItemQuantity(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =============================================================================
// exportItems
// =============================================================================

describe('exportItems', () => {
  test('returns 200 with exported data', async () => {
    svc.exportItems.mockResolvedValue({ status: true, data: [{ _id: VALID_ID }], message: 'ok' });
    const req = mockReq({ body: [VALID_ID], user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when access.item.read is explicitly false', async () => {
    const req = mockReq({
      body: [VALID_ID],
      user: adminUser({ access: { item: { read: false } } }),
    });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(svc.exportItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when no ids provided', async () => {
    const req = mockReq({ body: [], user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when service fails', async () => {
    svc.exportItems.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ body: [VALID_ID], user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.exportItems.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: [VALID_ID], user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('normalizes object body with data array key', async () => {
    svc.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(svc.exportItems).toHaveBeenCalledWith([VALID_ID], expect.anything());
  });
});

// =============================================================================
// itemsImport
// =============================================================================

describe('itemsImport', () => {
  test('returns 200 when import succeeds', async () => {
    svc.importItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ body: { result: [{ name: 'Rice' }] }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when access.item.write is explicitly false', async () => {
    const req = mockReq({
      body: { result: [{ name: 'X' }] },
      user: adminUser({ access: { item: { write: false } } }),
    });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(svc.importItems).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when result array is empty', async () => {
    const req = mockReq({ body: { result: [] }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('accepts items via body.items key', async () => {
    svc.importItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ body: { items: [{ name: 'Rice' }] }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(svc.importItems).toHaveBeenCalled();
  });

  test('returns 500 when service throws', async () => {
    svc.importItems.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: { result: [{ name: 'Rice' }] }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getJSONhsncode
// =============================================================================

describe('getJSONhsncode', () => {
  test('returns 200 with HSN codes on success', async () => {
    svc.getHsnCodes.mockResolvedValue({ status: true, data: [{ code: '1001' }], message: '' });
    const req = mockReq({});
    const res = mockRes();
    await ctrl.getJSONhsncode(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when service returns status false', async () => {
    svc.getHsnCodes.mockResolvedValue({ status: false, message: 'HSN file not found' });
    const req = mockReq({});
    const res = mockRes();
    await ctrl.getJSONhsncode(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 when service throws', async () => {
    svc.getHsnCodes.mockRejectedValue(new Error('file missing'));
    const req = mockReq({});
    const res = mockRes();
    await ctrl.getJSONhsncode(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// uploadItemMultiImage
// =============================================================================

describe('uploadItemMultiImage', () => {
  test('returns 200 with uploaded image URLs on success', async () => {
    svc.uploadItemImages.mockResolvedValue({
      status: true,
      data: ['https://example.com/img.jpg'],
      message: 'ok',
    });
    const req = mockReq({
      body: { items_image: ['data:image/png;base64,abc'] },
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadItemMultiImage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when no files provided', async () => {
    const req = mockReq({ body: {}, protocol: 'http', get: jest.fn() });
    const res = mockRes();
    await ctrl.uploadItemMultiImage(req, res);
    expect(svc.uploadItemImages).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when items_image is empty array', async () => {
    const req = mockReq({ body: { items_image: [] }, protocol: 'http', get: jest.fn() });
    const res = mockRes();
    await ctrl.uploadItemMultiImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns error code from service when upload fails', async () => {
    svc.uploadItemImages.mockResolvedValue({ status: false, code: 413, message: 'Too large' });
    const req = mockReq({
      body: { items_image: ['data'] },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadItemMultiImage(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  test('returns 500 on service throw', async () => {
    svc.uploadItemImages.mockRejectedValue(new Error('crash'));
    const req = mockReq({
      body: { items_image: ['data'] },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadItemMultiImage(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// quantityCount
// =============================================================================

describe('quantityCount', () => {
  test('returns 200 with count and list on success', async () => {
    svc.quantityCount.mockResolvedValue({ status: true, data: { count: 3, listDocs: [] } });
    const req = mockReq({ query: { notificationrange: '10' }, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns count=0 and list=[] when no notification range configured', async () => {
    svc.getBranchNotificationRange.mockResolvedValue(NaN);
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual({ count: 0, list: [] });
  });

  test('fetches branch notification range when query param missing', async () => {
    svc.getBranchNotificationRange.mockResolvedValue(5);
    svc.quantityCount.mockResolvedValue({ status: true, data: { count: 1, listDocs: [] } });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(svc.getBranchNotificationRange).toHaveBeenCalled();
    expect(svc.quantityCount).toHaveBeenCalled();
  });

  test('returns 500 when quantityCount service fails', async () => {
    svc.quantityCount.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { notificationrange: '10' }, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// itemSearchTable
// =============================================================================

describe('itemSearchTable', () => {
  test('returns 200 on success', async () => {
    svc.itemSearchPage.mockResolvedValue({ status: true, list: [], total: 0 });
    const req = mockReq({ query: { filter: 'rice' }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemSearchTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service returns status false', async () => {
    svc.itemSearchPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemSearchTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.itemSearchPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemSearchTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// onlineSalesItemsAjaxLists
// =============================================================================

describe('onlineSalesItemsAjaxLists', () => {
  test('returns 200 with items on success', async () => {
    svc.getOnlineSalesItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ query: { limit: '10' }, user: adminUser() });
    const res = mockRes();
    await ctrl.onlineSalesItemsAjaxLists(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service fails', async () => {
    svc.getOnlineSalesItems.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.onlineSalesItemsAjaxLists(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// getOnlineItemsAjaxList
// =============================================================================

describe('getOnlineItemsAjaxList', () => {
  test('returns 200 with { query, suggestions } on success', async () => {
    svc.getOnlineItemsAjaxList.mockResolvedValue({ status: true, data: ['item1'] });
    const req = mockReq({ query: { query: 'rice', type: 'normal' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOnlineItemsAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ suggestions: ['item1'] }));
  });

  test('returns 404 when service fails', async () => {
    svc.getOnlineItemsAjaxList.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getOnlineItemsAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// getReceivingItemsAjaxList  (LAST DEFINITION — line 1675)
// =============================================================================

describe('getReceivingItemsAjaxList', () => {
  test('returns { query, suggestions } on success', async () => {
    svc.getReceivingItemsAjaxList.mockResolvedValue({ status: true, data: [{ name: 'Rice' }] });
    const req = mockReq({ query: { query: 'rice', type: 'normal' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getReceivingItemsAjaxList(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'rice',
        suggestions: [{ name: 'Rice' }],
      })
    );
  });

  test('returns 404 when service fails', async () => {
    svc.getReceivingItemsAjaxList.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { query: 'x' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getReceivingItemsAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.getReceivingItemsAjaxList.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getReceivingItemsAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getCustomerSearchItemsAjaxList
// =============================================================================

describe('getCustomerSearchItemsAjaxList', () => {
  test('returns { query, suggestions } on success', async () => {
    svc.getCustomerSearchItems.mockResolvedValue({ status: true, data: [{ name: 'Oil' }] });
    const req = mockReq({ query: { query: 'oil' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getCustomerSearchItemsAjaxList(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'oil',
        suggestions: [{ name: 'Oil' }],
      })
    );
  });

  test('returns 404 when service fails', async () => {
    svc.getCustomerSearchItems.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { query: '' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getCustomerSearchItemsAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// categoryItemsReportTable  (LAST DEFINITION — line 1754, uses access.report.read !== true)
// =============================================================================

describe('categoryItemsReportTable', () => {
  test('returns 200 with report data when permission granted', async () => {
    svc.categoryItemsReportTable.mockResolvedValue({
      status: true,
      data: { list: [], total: 0 },
    });
    const req = mockReq({
      query: { limit: '5', page: '1' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.categoryItemsReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 403 when access.report.read is not true', async () => {
    const req = mockReq({ query: {}, user: restrictedUser() });
    const res = mockRes();
    await ctrl.categoryItemsReportTable(req, res);
    expect(svc.categoryItemsReportTable).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when service returns status false', async () => {
    svc.categoryItemsReportTable.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.categoryItemsReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('applies session filter when dates provided', async () => {
    svc.categoryItemsReportTable.mockResolvedValue({ status: true, data: {} });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.categoryItemsReportTable(req, res);
    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
  });

  test('returns 500 when service throws', async () => {
    svc.categoryItemsReportTable.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.categoryItemsReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// supplierItemsReportTable  (LAST DEFINITION — line 1860, uses access.report.read !== true)
// =============================================================================

describe('supplierItemsReportTable', () => {
  test('returns 200 with report data when permission granted', async () => {
    svc.supplierItemsReportTable.mockResolvedValue({
      status: true,
      data: { list: [], total: 0 },
    });
    const req = mockReq({ query: { limit: '5', page: '1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierItemsReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 403 when access.report.read is not true', async () => {
    const req = mockReq({ query: {}, user: restrictedUser() });
    const res = mockRes();
    await ctrl.supplierItemsReportTable(req, res);
    expect(svc.supplierItemsReportTable).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('applies session filter when dates provided', async () => {
    svc.supplierItemsReportTable.mockResolvedValue({ status: true, data: {} });
    const req = mockReq({
      query: { starting_date: '2025-02-01', ending_date: '2025-11-30' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierItemsReportTable(req, res);
    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
  });

  test('returns 404 when service returns status false', async () => {
    svc.supplierItemsReportTable.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierItemsReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// itemStockReportTable
// =============================================================================

describe('itemStockReportTable', () => {
  test('returns 200 with stock report on success', async () => {
    svc.itemStockReportTable.mockResolvedValue({
      status: true,
      total: 10,
      current_page: 1,
      total_pages: 1,
      per_page: 5,
      list: [],
      selling_total: 500,
      company_total: 300,
    });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemStockReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when service returns status false', async () => {
    svc.itemStockReportTable.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemStockReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.itemStockReportTable.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemStockReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// itemReportTable
// =============================================================================

describe('itemReportTable', () => {
  test('returns 200 on success', async () => {
    svc.itemReportTable.mockResolvedValue({ status: true, data: { list: [] }, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 404 when service returns status false', async () => {
    svc.itemReportTable.mockResolvedValue({ status: false, data: null, message: 'not found' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    svc.itemReportTable.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.itemReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// categoryProductDetails
// =============================================================================

describe('categoryProductDetails', () => {
  test('returns 200 on success', async () => {
    svc.categoryProductDetails.mockResolvedValue({ data: { list: [] }, message: 'ok' });
    const req = mockReq({ query: { category_id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.categoryProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when service throws', async () => {
    svc.categoryProductDetails.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.categoryProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// supplierProductDetails
// =============================================================================

describe('supplierProductDetails', () => {
  test('returns 200 on success', async () => {
    svc.supplierProductDetails.mockResolvedValue({ data: { list: [] }, message: 'ok' });
    const req = mockReq({ query: { supplier_id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when service throws', async () => {
    svc.supplierProductDetails.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// Additional coverage — reachable uncovered branches
// =============================================================================

describe('getAll — additional branches', () => {
  test('accepts filter as plain object in query', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { filters: { name: 'rice' } }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [calledArgs] = svc.getAllItems.mock.calls[0];
    expect(calledArgs.filters).toEqual({ name: 'rice' });
  });

  test('ignores filter when it is an array', async () => {
    svc.getAllItems.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { filters: ['a', 'b'] }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledArgs] = svc.getAllItems.mock.calls[0];
    expect(calledArgs.filters).toEqual({});
  });
});

describe('exportItems — normalizeIds additional paths', () => {
  test('normalizes JSON string array body', async () => {
    svc.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ body: `["${VALID_ID}"]`, user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(svc.exportItems).toHaveBeenCalledWith([VALID_ID], expect.anything());
  });

  test('normalizes plain string id body', async () => {
    svc.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({ body: VALID_ID, user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(svc.exportItems).toHaveBeenCalledWith([VALID_ID], expect.anything());
  });

  test('normalizes object body with data string key', async () => {
    svc.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockReq({
      body: { data: `["${VALID_ID}"]` },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(svc.exportItems).toHaveBeenCalledWith([VALID_ID], expect.anything());
  });

  test('returns 400 when object body has only empty string values', async () => {
    const req = mockReq({ body: { a: '' }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportItems(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('itemsImport — service failure path', () => {
  test('returns 400 when service returns status false', async () => {
    svc.importItems.mockResolvedValue({ status: false, data: null, message: 'Import failed' });
    const req = mockReq({ body: { result: [{ name: 'Rice' }] }, user: adminUser() });
    const res = mockRes();
    await ctrl.itemsImport(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Import failed' })
    );
  });
});

describe('quantityCount — listDocs formatting', () => {
  test('formats listDocs with dates from created_date', async () => {
    svc.quantityCount.mockResolvedValue({
      status: true,
      data: {
        count: 1,
        listDocs: [{ _id: VALID_ID, created_date: '2025-06-01', name: 'Rice' }],
      },
    });
    const req = mockReq({ query: { notificationrange: '5' }, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(Array.isArray(payload.data.list)).toBe(true);
    expect(payload.data.count).toBe(1);
  });

  test('handles negative notification range by fetching branch range', async () => {
    svc.getBranchNotificationRange.mockResolvedValue(NaN);
    const req = mockReq({ query: { notificationrange: '-1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.quantityCount(req, res);
    expect(svc.getBranchNotificationRange).toHaveBeenCalled();
  });
});

describe('itemStockReportTable — session filter with dates', () => {
  test('applies session filter when starting_date is provided', async () => {
    svc.itemStockReportTable.mockResolvedValue({
      status: true,
      total: 0,
      current_page: 1,
      total_pages: 1,
      per_page: 5,
      list: [],
      selling_total: 0,
      company_total: 0,
    });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.itemStockReportTable(req, res);
    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getOne — reads id from query.id when no params.id', () => {
  test('returns 200 using query.id fallback', async () => {
    svc.getItemById.mockResolvedValue({ status: true, data: { _id: VALID_ID }, message: 'ok' });
    const req = mockReq({ params: {}, query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(svc.getItemById).toHaveBeenCalledWith(VALID_ID, expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteInstant — reads id from body._id', () => {
  test('accepts body._id as item id', async () => {
    svc.deleteInstantItem.mockResolvedValue({ status: true, data: 1 });
    const req = mockReq({ body: { _id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.deleteInstant(req, res);
    expect(svc.deleteInstantItem).toHaveBeenCalledWith(expect.objectContaining({ id: VALID_ID }));
  });
});

// =============================================================================
// bulkUpdatePrices
// =============================================================================

describe('bulkUpdatePrices', () => {
  const body = {
    scope: 'all',
    field: 'selling_price',
    op: 'percent',
    value: 10,
    direction: 'increase',
    skipViolations: true,
  };

  test('returns 200 and forwards params, incl. skipViolations, to the service', async () => {
    svc.bulkUpdatePrices.mockResolvedValue({
      status: true,
      data: { updated: 3, total: 5, skipped: 1 },
      message: 'ok',
    });
    const req = mockReq({ body, user: adminUser() });
    const res = mockRes();
    await ctrl.bulkUpdatePrices(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [params] = svc.bulkUpdatePrices.mock.calls[0];
    expect(params.field).toBe('selling_price');
    expect(params.skipViolations).toBe(true);
  });

  test('returns 403 when access.item.write is explicitly false', async () => {
    const req = mockReq({ body, user: adminUser({ access: { item: { write: false } } }) });
    const res = mockRes();
    await ctrl.bulkUpdatePrices(req, res);
    expect(svc.bulkUpdatePrices).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when the service rejects the request', async () => {
    svc.bulkUpdatePrices.mockResolvedValue({ status: false, message: 'Unknown price field' });
    const req = mockReq({ body: { field: 'x' }, user: adminUser() });
    const res = mockRes();
    await ctrl.bulkUpdatePrices(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// bulkPricePreview
// =============================================================================

describe('bulkPricePreview', () => {
  test('returns 200 with the feasibility numbers', async () => {
    svc.previewBulkUpdatePrices.mockResolvedValue({
      status: true,
      data: {
        total: 5,
        willChange: 5,
        exceedsMrpCount: 2,
        belowCostCount: 0,
        exceedsMrp: [],
        belowCost: [],
      },
      message: 'Preview ready',
    });
    const req = mockReq({
      body: {
        scope: 'all',
        field: 'selling_price',
        op: 'percent',
        value: 10,
        direction: 'increase',
      },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.bulkPricePreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.exceedsMrpCount).toBe(2);
  });

  test('returns 403 when access.item.read is explicitly false', async () => {
    const req = mockReq({ body: {}, user: adminUser({ access: { item: { read: false } } }) });
    const res = mockRes();
    await ctrl.bulkPricePreview(req, res);
    expect(svc.previewBulkUpdatePrices).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// =============================================================================
// bulkUpdateStock
// =============================================================================

describe('bulkUpdateStock', () => {
  const body = {
    scope: 'all',
    op: 'amount',
    value: 5,
    direction: 'increase',
    note: 'new delivery',
  };

  test('returns 200 and forwards params, incl. the note, to the service', async () => {
    svc.bulkUpdateStock.mockResolvedValue({
      status: true,
      data: { updated: 3, total: 5, skipped: 0 },
      message: 'ok',
    });
    const req = mockReq({ body, user: adminUser() });
    const res = mockRes();
    await ctrl.bulkUpdateStock(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [params] = svc.bulkUpdateStock.mock.calls[0];
    expect(params.op).toBe('amount');
    expect(params.note).toBe('new delivery');
  });

  test('returns 403 when access.item.write is explicitly false', async () => {
    const req = mockReq({ body, user: adminUser({ access: { item: { write: false } } }) });
    const res = mockRes();
    await ctrl.bulkUpdateStock(req, res);
    expect(svc.bulkUpdateStock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when the service rejects the request', async () => {
    svc.bulkUpdateStock.mockResolvedValue({ status: false, message: 'Enter a valid quantity' });
    const req = mockReq({ body: { value: -1 }, user: adminUser() });
    const res = mockRes();
    await ctrl.bulkUpdateStock(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// bulkStockPreview
// =============================================================================

describe('bulkStockPreview', () => {
  test('returns 200 with the change count', async () => {
    svc.previewBulkUpdateStock.mockResolvedValue({
      status: true,
      data: { total: 5, willChange: 3, sample: [] },
      message: 'Preview ready',
    });
    const req = mockReq({
      body: { scope: 'all', op: 'amount', value: 5, direction: 'increase' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.bulkStockPreview(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.willChange).toBe(3);
  });

  test('returns 403 when access.item.read is explicitly false', async () => {
    const req = mockReq({ body: {}, user: adminUser({ access: { item: { read: false } } }) });
    const res = mockRes();
    await ctrl.bulkStockPreview(req, res);
    expect(svc.previewBulkUpdateStock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
