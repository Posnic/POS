/**
 * Unit tests for customer-categories.controller.js
 *
 * CustomerCategoryController extends BaseController and is a SINGLETON.
 * this.service  = new CustomerCategoryService()  (mocked)
 * this.model    = new CustomerCategoryModel()     (mocked)
 *
 * Permission: req.user?.access?.category?.read/write/delete === true
 *   (direct property check — NOT BaseController.checkPermission)
 *
 * express-async-handler is mocked as a passthrough so arrow-function
 * class properties are called directly without the Express middleware wrapper.
 */

// =============================================================================
// Mocks (hoisted)
// =============================================================================

jest.mock('express-async-handler', () => (fn) => fn);

jest.mock('../../../src/services/customer-category.service', () =>
  jest.fn().mockImplementation(() => ({
    getAllCustomerCategories: jest.fn(),
    getCustomerCategoryById: jest.fn(),
    createCustomerCategory: jest.fn(),
    updateCustomerCategory: jest.fn(),
    deleteCustomerCategories: jest.fn(),
    bulkImport: jest.fn(),
  }))
);

jest.mock('../../../src/models/customer-category.model', () =>
  jest.fn().mockImplementation(() => ({
    getDataChanges: jest.fn(),
    exportCustomerCategoriesOrder: jest.fn(),
    getSelectCustomerCategoryAjaxList: jest.fn(),
  }))
);

jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {}
  MockBaseModel.currentBranch = null;
  MockBaseModel.license = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = '';
  MockBaseModel.currentBranchName = '';
  return MockBaseModel;
});

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

// =============================================================================
// Imports
// =============================================================================

const ctrl = require('../../../src/controllers/customer-categories.controller');
const BaseModel = require('../../../src/models/base.model');

// =============================================================================
// Test helpers
// =============================================================================

const VALID_ID = '65240175dce9a65f7b446633';
const VALID_ID_2 = '65240175dce9a65f7b446634';
const BRANCH_ID = '65240175dce9a65f7b446635';

const adminUser = {
  _id: VALID_ID,
  name: 'Admin User',
  license: VALID_ID_2,
  branch_id: BRANCH_ID,
  branch_name: 'Main Branch',
  access: { category: { read: true, write: true, delete: true } },
};
const noReadUser = {
  ...adminUser,
  access: { category: { read: false, write: true, delete: true } },
};
const noWriteUser = {
  ...adminUser,
  access: { category: { read: true, write: false, delete: true } },
};
const noDeleteUser = {
  ...adminUser,
  access: { category: { read: true, write: true, delete: false } },
};

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

let service, model;
beforeAll(() => {
  service = ctrl.service;
  model = ctrl.model;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// =============================================================================
// mongoIDFilter (utility)
// =============================================================================

describe('CustomerCategoryController — mongoIDFilter', () => {
  test('returns null/undefined unchanged', () => {
    expect(ctrl.mongoIDFilter(null)).toBeNull();
    expect(ctrl.mongoIDFilter(undefined)).toBeUndefined();
  });

  test('converts ObjectId _id to hex string', () => {
    const { ObjectId } = require('mongodb');
    const oid = new ObjectId(VALID_ID);
    const result = ctrl.mongoIDFilter({ _id: oid, name: 'Test' });
    expect(result._id).toBe(VALID_ID);
  });

  test('leaves string _id unchanged', () => {
    const result = ctrl.mongoIDFilter({ _id: VALID_ID, name: 'Test' });
    expect(result._id).toBe(VALID_ID);
  });

  test('processes array of documents', () => {
    const { ObjectId } = require('mongodb');
    const items = [
      { _id: new ObjectId(VALID_ID), name: 'A' },
      { _id: VALID_ID_2, name: 'B' },
    ];
    const result = ctrl.mongoIDFilter(items);
    expect(result[0]._id).toBe(VALID_ID);
    expect(result[1]._id).toBe(VALID_ID_2);
  });

  test('preserves non-_id fields', () => {
    const result = ctrl.mongoIDFilter({ _id: VALID_ID, name: 'Test', score: 99 });
    expect(result.name).toBe('Test');
    expect(result.score).toBe(99);
  });

  test('extracts _id from object with $oid property', () => {
    const result = ctrl.mongoIDFilter({ _id: { $oid: VALID_ID }, name: 'Test' });
    expect(result._id).toBe(VALID_ID);
  });

  test('extracts _id from object with nested _id property', () => {
    const result = ctrl.mongoIDFilter({ _id: { _id: VALID_ID }, name: 'Test' });
    expect(result._id).toBe(VALID_ID);
  });

  test('preserves Date values without converting', () => {
    const d = new Date('2026-01-01');
    const result = ctrl.mongoIDFilter({ _id: VALID_ID, createdAt: d });
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  test('extracts _id from object whose toString() returns a valid hex', () => {
    const customId = { toString: () => VALID_ID };
    const result = ctrl.mongoIDFilter({ _id: customId, name: 'Test' });
    expect(result._id).toBe(VALID_ID);
  });
});

// =============================================================================
// resolveIdCandidate (utility)
// =============================================================================

describe('CustomerCategoryController — resolveIdCandidate', () => {
  test('returns null for null/empty value', () => {
    expect(ctrl.resolveIdCandidate(null)).toBeNull();
    expect(ctrl.resolveIdCandidate('')).toBeNull();
    expect(ctrl.resolveIdCandidate(undefined)).toBeNull();
  });

  test('returns the hex string when value is a valid 24-char hex ID', () => {
    expect(ctrl.resolveIdCandidate(VALID_ID)).toBe(VALID_ID);
  });

  test('returns null for non-hex string', () => {
    expect(ctrl.resolveIdCandidate('not-a-valid-id')).toBeNull();
  });

  test('extracts ID from object with _id property', () => {
    expect(ctrl.resolveIdCandidate({ _id: VALID_ID })).toBe(VALID_ID);
  });

  test('extracts ID from first element of an array', () => {
    expect(ctrl.resolveIdCandidate([VALID_ID, VALID_ID_2])).toBe(VALID_ID);
  });

  test('returns null for array with invalid first element', () => {
    expect(ctrl.resolveIdCandidate(['invalid'])).toBeNull();
  });

  test('extracts 24-char hex embedded inside a longer string', () => {
    const result = ctrl.resolveIdCandidate(`prefix-${VALID_ID}-suffix`);
    expect(result).toBe(VALID_ID);
  });

  test('extracts ID from JSON-encoded string (double-quoted hex)', () => {
    const result = ctrl.resolveIdCandidate(JSON.stringify(VALID_ID));
    expect(result).toBe(VALID_ID);
  });

  test('returns null for object with no id/oid fields', () => {
    expect(ctrl.resolveIdCandidate({ foo: 'bar' })).toBeNull();
  });

  test('returns null when JSON-parseable string resolves to no valid ID', () => {
    expect(ctrl.resolveIdCandidate('null')).toBeNull();
  });
});

// =============================================================================
// getAll
// =============================================================================

describe('CustomerCategoryController — getAll', () => {
  test('returns 401 when user lacks category read access', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Unauthorized' });
  });

  test('returns 401 when user has no access object', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ user: { _id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 400 when filters JSON string is invalid', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters: '{invalid json' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/incorrect format/i);
  });

  test('returns paginated list on success', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'Customer categories retrieved successfully',
      data: { data: [{ _id: VALID_ID, name: 'VIP' }], total: 1, limit: 5, page: 1, totalPages: 1 },
    });
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { limit: '5', page: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.data.total).toBe(1);
    expect(body.data.list).toHaveLength(1);
  });

  test('uses default limit=5 and page=1 for invalid pagination values', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { data: [], total: 0, limit: 5, page: 1, totalPages: 0 },
    });
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { limit: '-1', page: '0' } }), res);
    expect(service.getAllCustomerCategories).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 5, page: 1 })
    );
  });

  test('uses custom limit and page from query', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { data: [], total: 0, limit: 20, page: 3, totalPages: 0 },
    });
    await ctrl.getAll(mockReq({ query: { limit: '20', page: '3' } }), mockRes());
    expect(service.getAllCustomerCategories).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 20, page: 3 })
    );
  });

  test('applies additional filters from valid JSON query string', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { data: [], total: 0, limit: 5, page: 1, totalPages: 0 },
    });
    await ctrl.getAll(mockReq({ query: { filters: JSON.stringify({ name: 'Gold' }) } }), mockRes());
    expect(service.getAllCustomerCategories).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gold' }),
      expect.any(Object)
    );
  });

  test('returns 400 when service returns status=false', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: false,
      message: 'DB error',
      data: null,
    });
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('handles empty list correctly (list=[], total=0)', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { data: [], total: 0, limit: 5, page: 1, totalPages: 0 },
    });
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.json.mock.calls[0][0].data.list).toEqual([]);
    expect(res.json.mock.calls[0][0].data.total).toBe(0);
  });

  test('passes sort:{created_date:-1} in options', async () => {
    service.getAllCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { data: [], total: 0 },
    });
    await ctrl.getAll(mockReq(), mockRes());
    expect(service.getAllCustomerCategories).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sort: { created_date: -1 } })
    );
  });
});

// =============================================================================
// add — create (no id)
// =============================================================================

describe('CustomerCategoryController — add (create mode, no id)', () => {
  test('returns 401 when user lacks write access', async () => {
    const res = mockRes();
    await ctrl.add(mockReq({ user: noWriteUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Unauthorized' });
  });

  test('calls createCustomerCategory when no id in params/query', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Created',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    await ctrl.add(mockReq({ body: { name: 'Gold', description: 'VIP tier' } }), mockRes());
    expect(service.createCustomerCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gold', description: 'VIP tier' })
    );
    expect(service.updateCustomerCategory).not.toHaveBeenCalled();
  });

  test('trims name and description before calling service', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    await ctrl.add(mockReq({ body: { name: '  Gold  ', description: '  VIP tier  ' } }), mockRes());
    expect(service.createCustomerCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gold', description: 'VIP tier' })
    );
  });

  test('returns 200 with _id from created category on success', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Created',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    const res = mockRes();
    await ctrl.add(mockReq({ body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toBe(VALID_ID);
  });

  test('returns 400 when service returns status=false (e.g., duplicate)', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: false,
      message: 'This category details already exist in our system',
      data: null,
    });
    const res = mockRes();
    await ctrl.add(mockReq({ body: { name: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/already exist/i);
  });

  test('uses empty string for missing name and description', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: false,
      message: 'name required',
      data: null,
    });
    const res = mockRes();
    await ctrl.add(mockReq({ body: {} }), res);
    expect(service.createCustomerCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', description: '' })
    );
  });
});

// =============================================================================
// add — update (with id)
// =============================================================================

describe('CustomerCategoryController — add (update mode, with id)', () => {
  test('calls updateCustomerCategory when valid id is in params', async () => {
    service.updateCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Updated',
      data: { _id: VALID_ID, name: 'Silver' },
    });
    await ctrl.add(mockReq({ params: { id: VALID_ID }, body: { name: 'Silver' } }), mockRes());
    expect(service.updateCustomerCategory).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ name: 'Silver' })
    );
    expect(service.createCustomerCategory).not.toHaveBeenCalled();
  });

  test('calls updateCustomerCategory when valid id is in query string', async () => {
    service.updateCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Updated',
      data: { _id: VALID_ID, name: 'Silver' },
    });
    await ctrl.add(mockReq({ query: { id: VALID_ID }, body: { name: 'Silver' } }), mockRes());
    expect(service.updateCustomerCategory).toHaveBeenCalledWith(VALID_ID, expect.any(Object));
  });

  test('falls back to createCustomerCategory when id is invalid (non-hex)', async () => {
    service.createCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Created',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    await ctrl.add(
      mockReq({ params: { id: 'not-a-valid-id' }, body: { name: 'Gold' } }),
      mockRes()
    );
    expect(service.createCustomerCategory).toHaveBeenCalled();
    expect(service.updateCustomerCategory).not.toHaveBeenCalled();
  });

  test('returns 400 when update service returns status=false', async () => {
    service.updateCustomerCategory.mockResolvedValue({
      status: false,
      message: 'Category not found',
      data: null,
    });
    const res = mockRes();
    await ctrl.add(mockReq({ params: { id: VALID_ID }, body: { name: 'Updated' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// edit
// =============================================================================

describe('CustomerCategoryController — edit', () => {
  test('returns 400 when id is missing from params and query', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Wrong request' });
  });

  test('returns 400 when id is an invalid (non-hex) string', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'bad-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('delegates to add() when id is valid — calls updateCustomerCategory', async () => {
    service.updateCustomerCategory.mockResolvedValue({
      status: true,
      message: 'Updated',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: VALID_ID }, body: { name: 'Gold' } }), res);
    expect(service.updateCustomerCategory).toHaveBeenCalledWith(VALID_ID, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('respects write permission check (via add delegate)', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: VALID_ID }, user: noWriteUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('CustomerCategoryController — getOne', () => {
  test('returns 400 when id is missing', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/category id is mandatory/i);
  });

  test('returns 400 when id is invalid', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'bad-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 401 when user lacks read access (access="yes" default)', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID }, user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 200 with category data on success', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: true,
      message: 'found',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toMatchObject({ name: 'Gold' });
  });

  test('returns 404 when service returns status=false (not found)', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: false,
      message: 'Customer category not found',
      data: null,
    });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/not found/i);
  });

  test('skips permission check when access="no"', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: true,
      message: 'found',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: VALID_ID }, user: noReadUser }), res, 'no');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('calls service with the resolved ID', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { _id: VALID_ID },
    });
    await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), mockRes());
    expect(service.getCustomerCategoryById).toHaveBeenCalledWith(VALID_ID);
  });
});

// =============================================================================
// getCategoryDetails
// =============================================================================

describe('CustomerCategoryController — getCategoryDetails', () => {
  test('returns 400 when id is missing', async () => {
    const res = mockRes();
    await ctrl.getCategoryDetails(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/category id not found/i);
  });

  test('returns 400 when id is invalid', async () => {
    const res = mockRes();
    await ctrl.getCategoryDetails(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 200 even when user lacks read access (no permission check)', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: true,
      message: 'found',
      data: { _id: VALID_ID, name: 'Gold' },
    });
    const res = mockRes();
    await ctrl.getCategoryDetails(mockReq({ params: { id: VALID_ID }, user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when category not found', async () => {
    service.getCustomerCategoryById.mockResolvedValue({
      status: false,
      message: 'Customer category not found',
      data: null,
    });
    const res = mockRes();
    await ctrl.getCategoryDetails(mockReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('CustomerCategoryController — delete', () => {
  test('returns 400 when body.data is missing', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/uid is missing/i);
  });

  test('returns 400 when body.data is not an array', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 401 when user lacks delete access', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ user: noDeleteUser, body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('calls deleteCustomerCategories with provided ids', async () => {
    service.deleteCustomerCategories.mockResolvedValue({
      status: true,
      message: 'Deleted',
      data: { deletedCount: 2 },
    });
    await ctrl.delete(mockReq({ body: { data: [VALID_ID, VALID_ID_2] } }), mockRes());
    expect(service.deleteCustomerCategories).toHaveBeenCalledWith([VALID_ID, VALID_ID_2]);
  });

  test('returns 200 with deletedCount on success', async () => {
    service.deleteCustomerCategories.mockResolvedValue({
      status: true,
      message: 'Customer category deleted successfully',
      data: { deletedCount: 1 },
    });
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ deletedCount: 1 });
  });

  test('returns 400 when service returns status=false', async () => {
    service.deleteCustomerCategories.mockResolvedValue({
      status: false,
      message: 'Error',
      data: null,
    });
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('handles delete of empty array — still passes array to service', async () => {
    service.deleteCustomerCategories.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { deletedCount: 0 },
    });
    await ctrl.delete(mockReq({ body: { data: [] } }), mockRes());
    expect(service.deleteCustomerCategories).toHaveBeenCalledWith([]);
  });
});

// =============================================================================
// getDataChanges
// =============================================================================

describe('CustomerCategoryController — getDataChanges', () => {
  test('returns 200 with data when model returns status=true', async () => {
    model.getDataChanges.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID }],
    });
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: { from: '2024-01-01' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toEqual([{ _id: VALID_ID }]);
  });

  test('returns 200 with error type when model returns status=false', async () => {
    model.getDataChanges.mockResolvedValue({ status: false, data: [] });
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(res.json.mock.calls[0][0].message).toBe('Not valid Input');
  });

  test('uses empty string when from query param is missing', async () => {
    model.getDataChanges.mockResolvedValue({ status: true, data: [] });
    await ctrl.getDataChanges(mockReq({ query: {} }), mockRes());
    expect(model.getDataChanges).toHaveBeenCalledWith('customercategory', '');
  });

  test('returns 500 when model throws', async () => {
    model.getDataChanges.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('DB error');
  });
});

// =============================================================================
// customercategoryImport
// =============================================================================

describe('CustomerCategoryController — customercategoryImport', () => {
  test('returns 401 when user lacks write access', async () => {
    const res = mockRes();
    await ctrl.customercategoryImport(mockReq({ user: noWriteUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 400 when no data is provided', async () => {
    const res = mockRes();
    await ctrl.customercategoryImport(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/no data to import/i);
  });

  test('returns 400 when rows array is empty', async () => {
    const res = mockRes();
    await ctrl.customercategoryImport(mockReq({ body: { result: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('reads rows from body.result if available', async () => {
    service.bulkImport.mockResolvedValue({ status: true, message: 'ok', data: [] });
    const rows = [{ name: 'Gold' }, { name: 'Silver' }];
    await ctrl.customercategoryImport(mockReq({ body: { result: rows } }), mockRes());
    expect(service.bulkImport).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Gold' })])
    );
  });

  test('reads rows from body.data if body.result is absent', async () => {
    service.bulkImport.mockResolvedValue({ status: true, message: 'ok', data: [] });
    const rows = [{ name: 'Bronze' }];
    await ctrl.customercategoryImport(mockReq({ body: { data: rows } }), mockRes());
    expect(service.bulkImport).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Bronze' })])
    );
  });

  test('attaches branch context fields to each row', async () => {
    service.bulkImport.mockResolvedValue({ status: true, message: 'ok', data: [] });
    const rows = [{ name: 'Gold' }];
    await ctrl.customercategoryImport(mockReq({ body: { result: rows } }), mockRes());
    expect(service.bulkImport).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Gold',
          branch_id: BaseModel.currentBranch,
          created_by: BaseModel.loggedUserName,
        }),
      ])
    );
  });

  test('returns 200 on successful import', async () => {
    service.bulkImport.mockResolvedValue({
      status: true,
      message: 'Imported successfully',
      data: [{ name: 'Gold', description: '' }],
    });
    const res = mockRes();
    await ctrl.customercategoryImport(mockReq({ body: { result: [{ name: 'Gold' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 400 when all rows already exist (bulkImport status=false)', async () => {
    service.bulkImport.mockResolvedValue({
      status: false,
      message: 'Customer category data already imported',
      data: [{ name: 'Gold', description: '' }],
    });
    const res = mockRes();
    await ctrl.customercategoryImport(mockReq({ body: { result: [{ name: 'Gold' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/already imported/i);
  });
});

// =============================================================================
// exportCustomerCategory
// =============================================================================

describe('CustomerCategoryController — exportCustomerCategory', () => {
  test('returns 401 when user lacks read access', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 400 when body is empty object (no ids)', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/no ids provided/i);
  });

  test('returns 400 when body is a non-JSON string (parse fails, ids stay empty)', async () => {
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: 'not-valid-json{{' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('parses JSON string body and calls model', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({ status: true, data: [] });
    const res = mockRes();
    await ctrl.exportCustomerCategory(
      mockReq({ body: JSON.stringify([VALID_ID, VALID_ID_2]) }),
      res
    );
    expect(model.exportCustomerCategoriesOrder).toHaveBeenCalledWith([VALID_ID, VALID_ID_2]);
  });

  test('handles array body directly', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({ status: true, data: [] });
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), mockRes());
    expect(model.exportCustomerCategoriesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('handles body with nested data property', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({ status: true, data: [] });
    await ctrl.exportCustomerCategory(mockReq({ body: { data: [VALID_ID] } }), mockRes());
    expect(model.exportCustomerCategoriesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('handles object with numeric keys (Express array-to-object conversion)', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({ status: true, data: [] });
    await ctrl.exportCustomerCategory(mockReq({ body: { 0: VALID_ID, 1: VALID_ID_2 } }), mockRes());
    expect(model.exportCustomerCategoriesOrder).toHaveBeenCalled();
  });

  test('returns 200 with exported data on success', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, name: 'Gold' }],
    });
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].message).toContain('Exported Successfully');
  });

  test('returns 404 when model returns status=false', async () => {
    model.exportCustomerCategoriesOrder.mockResolvedValue({
      status: false,
      data: null,
    });
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 when model throws', async () => {
    model.exportCustomerCategoriesOrder.mockRejectedValue(new Error('Model crash'));
    const res = mockRes();
    await ctrl.exportCustomerCategory(mockReq({ body: [VALID_ID] }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Model crash');
  });
});

// =============================================================================
// getCustomerCategoryAjaxList
// =============================================================================

describe('CustomerCategoryController — getCustomerCategoryAjaxList', () => {
  test('returns 200 with query and suggestions on success', async () => {
    model.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: true,
      data: [{ value: VALID_ID, label: 'Gold' }],
      message: 'ok',
    });
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: { query: 'Gold' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      query: 'Gold',
      suggestions: [{ value: VALID_ID, label: 'Gold' }],
    });
  });

  test('uses empty string when query param is absent', async () => {
    model.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: true,
      data: [],
      message: 'ok',
    });
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: {} }), mockRes());
    expect(model.getSelectCustomerCategoryAjaxList).toHaveBeenCalledWith('');
  });

  test('returns 404 when model returns status=false', async () => {
    model.getSelectCustomerCategoryAjaxList.mockResolvedValue({
      status: false,
      data: [],
      message: 'Not found',
    });
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq({ query: { query: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 when model throws', async () => {
    model.getSelectCustomerCategoryAjaxList.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.getCustomerCategoryAjaxList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('DB crash');
  });
});
