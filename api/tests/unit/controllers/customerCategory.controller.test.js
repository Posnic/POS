/**
 * Unit tests for customerCategory.controller.js  (LEGACY / INACTIVE)
 *
 * ACTIVE STATUS: This controller is NOT used by any route.
 * The active controller is customer-categories.controller.js (kebab-case).
 * The route file (src/routes/customer-categories.routes.js) imports
 * the kebab-case version. This camelCase file is legacy code.
 *
 * ─── CRITICAL PRODUCTION BUG ─────────────────────────────────────────────────
 * getAll() calls  this.MongoIDFilter(result.data.list)  (capital M)
 * BaseController only defines  mongoIDFilter  (lowercase m).
 * Calling undefined throws "TypeError: this.MongoIDFilter is not a function".
 * The outer try/catch catches it and returns HTTP 500.
 * Therefore getAll() CAN NEVER return 200 in production.
 *
 * Smallest safe fix (one character): change to  this.mongoIDFilter  (lowercase).
 *
 * In these tests we add  ctrl.MongoIDFilter = ctrl.mongoIDFilter.bind(ctrl)
 * in beforeAll so we can test the rest of getAll's logic without changing
 * any production file.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Key differences from customer-categories.controller.js (active):
 *   - Uses CustomerCategoryModel directly (no service layer)
 *   - Instantiates  new CustomerCategoryModel()  INSIDE each method
 *   - Uses express-validator's validationResult for create/update
 *   - Uses this.checkPermission() from BaseController
 *   - getDataChanges returns this.error(...,200,...) for false case
 *   - importCustomerCategory returns this.error(...,200,...) for false case
 *   - exportCustomerCategory expects req.body to be an array directly
 */

// =============================================================================
// Mocks (hoisted)
// =============================================================================

jest.mock('../../../src/models/customer-category.model', () => jest.fn());

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

jest.mock('express-validator', () => ({
  validationResult: jest.fn().mockReturnValue({
    isEmpty: jest.fn().mockReturnValue(true),
    array: jest.fn().mockReturnValue([]),
  }),
}));

// =============================================================================
// Imports
// =============================================================================

const ctrl = require('../../../src/controllers/customerCategory.controller');
const CustomerCategoryModel = require('../../../src/models/customer-category.model');
const { validationResult } = require('express-validator');

// =============================================================================
// Constants & helpers
// =============================================================================

const VALID_ID = '65240175dce9a65f7b446633';
const VALID_ID_2 = '65240175dce9a65f7b446634';

const adminUser = { _id: VALID_ID, role: 'admin' };
const lowUser = { _id: VALID_ID, role: 'cashier' }; // read=true, write=false, delete=false
const noReadUser = { _id: VALID_ID, role: 'cashier', access: { category: { read: false } } }; // read=false

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: adminUser,
  ...overrides,
});

// Shared mock model methods — replaced into every new CustomerCategoryModel()
const mockModelMethods = {
  categoryPage: jest.fn(),
  categoryInsertUpdate: jest.fn(),
  getCustomerCategoryTableRow: jest.fn(),
  deleteCustomerCategoryCollectionData: jest.fn(),
  getDataChanges: jest.fn(),
  importCustomerCategoryModel: jest.fn(),
  exportCustomerCategoriesOrder: jest.fn(),
  getSelectCustomerCategoryAjaxList: jest.fn(),
};

// Fix production bug for test scope: MongoIDFilter (capital M) → mongoIDFilter (lowercase m)
beforeAll(() => {
  ctrl.MongoIDFilter = ctrl.mongoIDFilter.bind(ctrl);
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  CustomerCategoryModel.mockImplementation(() => mockModelMethods);
  validationResult.mockReturnValue({
    isEmpty: jest.fn().mockReturnValue(true),
    array: jest.fn().mockReturnValue([]),
  });
});

afterEach(() => jest.restoreAllMocks());

// =============================================================================
// Helpers for validation error simulation
// =============================================================================

const withValidationErrors = (errors = [{ path: 'name', msg: 'Required' }]) => {
  validationResult.mockReturnValueOnce({
    isEmpty: jest.fn().mockReturnValue(false),
    array: jest.fn().mockReturnValue(errors),
  });
};

// =============================================================================
// getAll
// =============================================================================

describe('CustomerCategoryController (legacy) — getAll', () => {
  test('returns 403 when user lacks category read permission', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Unauthorized' });
  });

  test('returns 200 with paginated list on success', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [{ _id: VALID_ID, name: 'Gold' }], total: 1 },
    });
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { limit: '10', page: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data.list).toHaveLength(1);
  });

  test('uses default limit=5 when limit is not provided', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [], total: 0 },
    });
    await ctrl.getAll(mockReq({ query: {} }), mockRes());
    expect(mockModelMethods.categoryPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 5 })
    );
  });

  test('uses page=1 when page is 0 or negative', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [], total: 0 },
    });
    await ctrl.getAll(mockReq({ query: { page: '0' } }), mockRes());
    expect(mockModelMethods.categoryPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ page: 1 })
    );
  });

  test('passes custom limit and page from query', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [], total: 0 },
    });
    await ctrl.getAll(mockReq({ query: { limit: '20', page: '3' } }), mockRes());
    expect(mockModelMethods.categoryPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 20, page: 3 })
    );
  });

  test('parses filters from JSON query string and passes to model', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [], total: 0 },
    });
    await ctrl.getAll(mockReq({ query: { filters: JSON.stringify({ name: 'Gold' }) } }), mockRes());
    expect(mockModelMethods.categoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gold' }),
      expect.any(Object)
    );
  });

  test('returns 404 when model returns status=false', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: false,
      message: 'not found',
      data: null,
    });
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.categoryPage.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('DB crash');
  });

  test('uses sort:{_id:-1} in options', async () => {
    mockModelMethods.categoryPage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { list: [], total: 0 },
    });
    await ctrl.getAll(mockReq(), mockRes());
    expect(mockModelMethods.categoryPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sort: { _id: -1 } })
    );
  });
});

// =============================================================================
// create
// =============================================================================

describe('CustomerCategoryController (legacy) — create', () => {
  test('returns 400 when express-validator finds errors', async () => {
    withValidationErrors([{ path: 'name', msg: 'name is required' }]);
    const res = mockRes();
    await ctrl.create(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Validation Error' });
  });

  test('validation check runs BEFORE permission check', async () => {
    withValidationErrors();
    const res = mockRes();
    await ctrl.create(mockReq({ user: lowUser, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockModelMethods.categoryInsertUpdate).not.toHaveBeenCalled();
  });

  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ user: lowUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Unauthorized' });
  });

  test('calls categoryInsertUpdate with name, description, and empty id', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Created',
    });
    await ctrl.create(mockReq({ body: { name: 'Gold', description: 'Top tier' } }), mockRes());
    expect(mockModelMethods.categoryInsertUpdate).toHaveBeenCalledWith(
      { name: 'Gold', description: 'Top tier' },
      ''
    );
  });

  test('returns 200 on successful creation', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'Gold' },
      message: 'Created',
    });
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Gold', description: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 406 when status="exist" (duplicate name)', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: 'exist',
      data: { _id: VALID_ID },
      message: 'Category already exists',
    });
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(406);
    expect(res.json.mock.calls[0][0].message).toMatch(/already exists/i);
  });

  test('returns 404 when status=false', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: false,
      data: null,
      message: 'Insert failed',
    });
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.categoryInsertUpdate.mockRejectedValue(new Error('Connection lost'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Connection lost');
  });
});

// =============================================================================
// update
// =============================================================================

describe('CustomerCategoryController (legacy) — update', () => {
  test('returns 400 when express-validator finds errors', async () => {
    withValidationErrors([{ path: 'name', msg: 'name is required' }]);
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: VALID_ID }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.update(mockReq({ user: lowUser, params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when id is missing from params', async () => {
    const res = mockRes();
    await ctrl.update(mockReq({ params: {}, body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Wrong request');
  });

  test('calls categoryInsertUpdate with name, description, and the provided id', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Updated',
    });
    await ctrl.update(
      mockReq({ params: { id: VALID_ID }, body: { name: 'Silver', description: 'Mid tier' } }),
      mockRes()
    );
    expect(mockModelMethods.categoryInsertUpdate).toHaveBeenCalledWith(
      { name: 'Silver', description: 'Mid tier' },
      VALID_ID
    );
  });

  test('returns 200 on successful update', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'Silver' },
      message: 'Updated',
    });
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: VALID_ID }, body: { name: 'Silver' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 406 when status="exist" (duplicate name on update)', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: 'exist',
      data: null,
      message: 'Category already exists',
    });
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: VALID_ID }, body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(406);
  });

  test('returns 404 when status=false', async () => {
    mockModelMethods.categoryInsertUpdate.mockResolvedValue({
      status: false,
      data: null,
      message: 'Not found',
    });
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: VALID_ID }, body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.categoryInsertUpdate.mockRejectedValue(new Error('Timeout'));
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: VALID_ID }, body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('CustomerCategoryController (legacy) — getOne', () => {
  test('returns 400 when id is missing from params and query', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Category Id is mandatory');
  });

  test('returns 403 when user lacks read permission (access control applied by default)', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ user: noReadUser, params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('skips access control when req.query.access === "no"', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'Gold' },
      message: 'Found',
    });
    const res = mockRes();
    await ctrl.getOne(
      mockReq({ user: noReadUser, params: { id: VALID_ID }, query: { access: 'no' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('reads id from params', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Found',
    });
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), mockRes());
    expect(mockModelMethods.getCustomerCategoryTableRow).toHaveBeenCalledWith(VALID_ID);
  });

  test('reads id from query when params.id is absent', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Found',
    });
    await ctrl.getOne(mockReq({ params: {}, query: { id: VALID_ID } }), mockRes());
    expect(mockModelMethods.getCustomerCategoryTableRow).toHaveBeenCalledWith(VALID_ID);
  });

  test('returns 200 with category data on success', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'Gold' },
      message: 'Found',
    });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ name: 'Gold' });
  });

  test('returns 404 when model returns status=false', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockResolvedValue({
      status: false,
      data: null,
      message: 'Not found',
    });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('Customer category not found');
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.getCustomerCategoryTableRow.mockRejectedValue(new Error('Query failed'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('CustomerCategoryController (legacy) — delete', () => {
  test('returns 400 when body.data is missing', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('UID is missing');
  });

  test('returns 400 when body.data is not an array', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 403 when user lacks delete permission', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ user: lowUser, body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('calls deleteCustomerCategoryCollectionData with provided ids', async () => {
    mockModelMethods.deleteCustomerCategoryCollectionData.mockResolvedValue({
      status: true,
      data: { deletedCount: 2 },
    });
    await ctrl.delete(mockReq({ body: { data: [VALID_ID, VALID_ID_2] } }), mockRes());
    expect(mockModelMethods.deleteCustomerCategoryCollectionData).toHaveBeenCalledWith([
      VALID_ID,
      VALID_ID_2,
    ]);
  });

  test('returns 200 with success message on successful delete', async () => {
    mockModelMethods.deleteCustomerCategoryCollectionData.mockResolvedValue({
      status: true,
      data: { deletedCount: 1 },
    });
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe('Customer category deleted successfully');
  });

  test('returns 404 when model returns status=false', async () => {
    mockModelMethods.deleteCustomerCategoryCollectionData.mockResolvedValue({
      status: false,
      data: null,
    });
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/not deleted/i);
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.deleteCustomerCategoryCollectionData.mockRejectedValue(
      new Error('Write lock')
    );
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getDataChanges
// =============================================================================

describe('CustomerCategoryController (legacy) — getDataChanges', () => {
  test('returns 200 success with data when model returns status=true', async () => {
    mockModelMethods.getDataChanges.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID }],
    });
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: { from: '2024-01-01' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].message).toBe('Changes Retrieved');
  });

  test('returns 200 with ERROR type when model returns status=false (legacy behaviour)', async () => {
    mockModelMethods.getDataChanges.mockResolvedValue({ status: false, data: null });
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(res.json.mock.calls[0][0].message).toBe('Not valid Input');
  });

  test('passes "customercategory" as collection and from value to model', async () => {
    mockModelMethods.getDataChanges.mockResolvedValue({ status: true, data: [] });
    await ctrl.getDataChanges(mockReq({ query: { from: '2025-06-01' } }), mockRes());
    expect(mockModelMethods.getDataChanges).toHaveBeenCalledWith('customercategory', '2025-06-01');
  });

  test('uses empty string for from when query param is absent', async () => {
    mockModelMethods.getDataChanges.mockResolvedValue({ status: true, data: [] });
    await ctrl.getDataChanges(mockReq({ query: {} }), mockRes());
    expect(mockModelMethods.getDataChanges).toHaveBeenCalledWith('customercategory', '');
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.getDataChanges.mockRejectedValue(new Error('Timeout'));
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Timeout');
  });
});

// =============================================================================
// importCustomerCategory
// =============================================================================

describe('CustomerCategoryController (legacy) — importCustomerCategory', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ user: lowUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when body.result is missing', async () => {
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Import data is missing');
  });

  test('returns 400 when body.result is null/falsy', async () => {
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ body: { result: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls importCustomerCategoryModel with body.result', async () => {
    const rows = [{ name: 'Gold' }, { name: 'Silver' }];
    mockModelMethods.importCustomerCategoryModel.mockResolvedValue({
      status: true,
      data: rows,
      message: 'Imported',
    });
    await ctrl.importCustomerCategory(mockReq({ body: { result: rows } }), mockRes());
    expect(mockModelMethods.importCustomerCategoryModel).toHaveBeenCalledWith(rows);
  });

  test('returns 200 on successful import', async () => {
    mockModelMethods.importCustomerCategoryModel.mockResolvedValue({
      status: true,
      data: [{ name: 'Gold' }],
      message: 'Imported',
    });
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ body: { result: [{ name: 'Gold' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 200 with ERROR type when status=false (legacy behaviour)', async () => {
    mockModelMethods.importCustomerCategoryModel.mockResolvedValue({
      status: false,
      data: [],
      message: 'Already imported',
    });
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ body: { result: [{ name: 'Gold' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(res.json.mock.calls[0][0].message).toBe('Already imported');
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.importCustomerCategoryModel.mockRejectedValue(new Error('Parse failed'));
    const res = mockRes();
    await ctrl.importCustomerCategory(mockReq({ body: { result: [{ name: 'X' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// exportCustomerCategory
// =============================================================================

describe('CustomerCategoryController (legacy) — exportCustomerCategory', () => {
  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when body is not an array (object body)', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: { ids: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Category IDs are required');
  });

  test('returns 400 when body is empty/undefined', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when body is a string (not array)', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: 'not-an-array' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls exportCustomerCategoriesOrder with body array directly', async () => {
    mockModelMethods.exportCustomerCategoriesOrder.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, name: 'Gold' }],
    });
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID, VALID_ID_2] }), mockRes());
    expect(mockModelMethods.exportCustomerCategoriesOrder).toHaveBeenCalledWith([
      VALID_ID,
      VALID_ID_2,
    ]);
  });

  test('returns 200 with export data on success', async () => {
    mockModelMethods.exportCustomerCategoriesOrder.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, name: 'Gold' }],
    });
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toContain('Exported Successfully');
  });

  test('returns 404 when model returns status=false', async () => {
    mockModelMethods.exportCustomerCategoriesOrder.mockResolvedValue({
      status: false,
      data: null,
    });
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/unsuccessfully/i);
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.exportCustomerCategoriesOrder.mockRejectedValue(new Error('IO error'));
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getCustomerCategoryAjaxList
// =============================================================================

describe('CustomerCategoryController (legacy) — getCustomerCategoryAjaxList', () => {
  test('returns query+suggestions directly via res.json on success', async () => {
    mockModelMethods.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: true,
      data: [{ value: VALID_ID, label: 'Gold' }],
    });
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: { query: 'Gold' } }), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Gold',
        suggestions: [{ value: VALID_ID, label: 'Gold' }],
      })
    );
  });

  test('does NOT use this.success wrapper (calls res.json directly)', async () => {
    mockModelMethods.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: true,
      data: [],
    });
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: { query: 'x' } }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ query: 'x', suggestions: [] });
  });

  test('uses empty string when query param is absent', async () => {
    mockModelMethods.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: true,
      data: [],
    });
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: {} }), mockRes());
    expect(mockModelMethods.getSelectCustomerCategoryAjaxList).toHaveBeenCalledWith('');
  });

  test('returns 404 when model returns status=false', async () => {
    mockModelMethods.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: false,
      data: [],
      message: 'No results',
    });
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: { query: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 on thrown error', async () => {
    mockModelMethods.getSelectCustomerCategoryAjaxList.mockRejectedValue(new Error('Index error'));
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Index error');
  });
});
