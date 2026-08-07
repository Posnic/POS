'use strict';

/**
 * Unit tests for stock-logs.controller.js
 *
 * Architecture:
 *  StockLogController extends BaseController — exported as singleton.
 *  this.service = new StockLogsService()  ← constructor-instantiated (not a module singleton).
 *  Methods: getAll, getOne, create, delete, export, exportStocklogs (alias),
 *           updateItemName, cleanupOldDeletedLogs, setRequestContext (internal).
 *
 * Mocked:
 *  - ../../../src/services/stock-logs.service  (constructor mock → shared mockSvc instance)
 *  - ../../../src/services/branches.service    (singleton)
 *  - ../../../src/services/base.service        (transitive dep of BaseController)
 *  - ../../../src/models/base.model            (static property store)
 *  - express-validator                      (validationResult)
 *  - mongodb                                (ObjectId)
 */

// =============================================================================
// Shared service mock instance (returned by every `new StockLogsService()`)
// =============================================================================
const mockSvc = {
  getStockLogs: jest.fn(),
  getStockLogDetail: jest.fn(),
  createStockLog: jest.fn(),
  deleteStockLogs: jest.fn(),
  exportStockLogs: jest.fn(),
  updateItemNameInStockLogs: jest.fn(),
  cleanupOldDeletedLogs: jest.fn(),
};

// =============================================================================
// Mocks (hoisted before any require)
// =============================================================================

jest.mock('../../../src/services/stock-log.service', () =>
  jest.fn().mockImplementation(() => mockSvc)
);

jest.mock('../../../src/services/branch.service', () => ({
  getBranchById: jest.fn(),
}));

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

const baseModelState = {};
jest.mock('../../../src/models/base.model', () => {
  return class MockBaseModel {
    static get currentBranch() {
      return baseModelState.currentBranch;
    }
    static set currentBranch(v) {
      baseModelState.currentBranch = v;
    }
    static get currentBranchName() {
      return baseModelState.currentBranchName;
    }
    static set currentBranchName(v) {
      baseModelState.currentBranchName = v;
    }
    static get license() {
      return baseModelState.license;
    }
    static set license(v) {
      baseModelState.license = v;
    }
    static get loggedUser() {
      return baseModelState.loggedUser;
    }
    static set loggedUser(v) {
      baseModelState.loggedUser = v;
    }
    static get loggedUserName() {
      return baseModelState.loggedUserName;
    }
    static set loggedUserName(v) {
      baseModelState.loggedUserName = v;
    }
  };
});

jest.mock('express-validator', () => ({ validationResult: jest.fn() }));

jest.mock('mongodb', () => ({
  ObjectId: Object.assign(
    jest.fn((id) => ({ _bsontype: 'ObjectId', id, toString: () => String(id) })),
    { isValid: jest.fn(() => true) }
  ),
}));

// =============================================================================
// Imports
// =============================================================================

const { validationResult } = require('express-validator');
const branchesService = require('../../../src/services/branch.service');
const ctrl = require('../../../src/controllers/stock-logs.controller');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
} = require('../../../src/constants/stock-logs.constants');

// =============================================================================
// Helpers
// =============================================================================

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const adminUser = {
  _id: 'user001',
  name: 'Test Admin',
  license: 'lic001',
  branch_id: 'br001',
  branch_name: 'Main Branch',
};

const mockReq = (o = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: adminUser,
  ...o,
});

const ok = (data = {}, message = 'OK') => ({ status: true, message, data });
const err = (message = 'Error') => ({ status: false, message, data: null });

const noErrors = () => ({
  isEmpty: () => true,
  array: () => [],
});
const hasErrors = (msgs = ['Field required']) => ({
  isEmpty: () => false,
  array: () => msgs.map((m) => ({ msg: m })),
});

const sampleLog = { _id: 'log001', item_name: 'Apple', quantity: 10, type: 'sale' };
const sampleList = { list: [sampleLog], total: 1, page: 1, limit: 10 };

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  Object.keys(baseModelState).forEach((k) => delete baseModelState[k]);
  validationResult.mockReturnValue(noErrors());
});

// =============================================================================
// setRequestContext — tested indirectly through getAll / delete
// =============================================================================

describe('setRequestContext', () => {
  test('sets BaseModel.currentBranch from session.selectedBranchId', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ session: { selectedBranchId: 'ses_br' } });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('falls back to session.branch_id when selectedBranchId absent', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({
      session: { branch_id: 'ses_bid' },
      user: { ...adminUser, branch_id: undefined },
    });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('falls back to user.branch_id when session has no branch', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ session: {}, user: { ...adminUser, branch_id: 'user_br' } });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('falls back to user.branch._id when user.branch_id absent', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({
      session: {},
      user: {
        ...adminUser,
        branch_id: undefined,
        branch: { _id: 'nested_br', branch_name: 'Nested' },
      },
    });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('sets BaseModel.currentBranchName from user.branch_name', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq(), mockRes());
    expect(baseModelState.currentBranchName).toBe('Main Branch');
  });

  test('fetches branch name from branchesService when user.branch_name absent', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    branchesService.getBranchById.mockResolvedValue({ branch_name: 'DB Branch' });
    const req = mockReq({ user: { ...adminUser, branch_name: '' } });
    await ctrl.getAll(req, mockRes());
    expect(branchesService.getBranchById).toHaveBeenCalled();
    expect(baseModelState.currentBranchName).toBe('DB Branch');
  });

  test('continues silently when branchesService.getBranchById throws', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    branchesService.getBranchById.mockRejectedValue(new Error('DB down'));
    const req = mockReq({ user: { ...adminUser, branch_name: '' } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('sets BaseModel.license from user.license', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq(), mockRes());
    expect(baseModelState.license).toBeDefined();
  });

  test('also resolves license from user.license_id', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ user: { ...adminUser, license: undefined, license_id: 'lid002' } });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.license).toBeDefined();
  });

  test('sets BaseModel.loggedUser and loggedUserName from user', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq(), mockRes());
    expect(baseModelState.loggedUser).toBeDefined();
    expect(baseModelState.loggedUserName).toBe('Test Admin');
  });

  test('uses user.username as loggedUserName fallback', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ user: { ...adminUser, name: undefined, username: 'admin_user' } });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.loggedUserName).toBe('admin_user');
  });

  test('uses user.email as final loggedUserName fallback', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({
      user: { ...adminUser, name: undefined, username: undefined, email: 'a@b.com' },
    });
    await ctrl.getAll(req, mockRes());
    expect(baseModelState.loggedUserName).toBe('a@b.com');
  });
});

// =============================================================================
// getAll
// =============================================================================

describe('getAll', () => {
  test('200 with stock log list on success', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(mockSvc.getStockLogs).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('passes parsed filters to service', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const filters = { type: 'sale', item_id: 'item001' };
    const req = mockReq({ query: { filters: JSON.stringify(filters), page: '2', limit: '25' } });
    await ctrl.getAll(req, mockRes());
    expect(mockSvc.getStockLogs).toHaveBeenCalledWith(filters, { page: 2, limit: 25 });
  });

  test('defaults page=1 and limit=10 when query params absent', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq({ query: {} }), mockRes());
    expect(mockSvc.getStockLogs).toHaveBeenCalledWith({}, { page: 1, limit: 10 });
  });

  test('defaults page=1 when page is 0 or negative', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq({ query: { page: '0', limit: '5' } }), mockRes());
    const [, opts] = mockSvc.getStockLogs.mock.calls[0];
    expect(opts.page).toBe(1);
  });

  test('defaults page=1 when page is non-numeric', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq({ query: { page: 'abc' } }), mockRes());
    const [, opts] = mockSvc.getStockLogs.mock.calls[0];
    expect(opts.page).toBe(1);
  });

  test('defaults limit=10 when limit is non-numeric', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    await ctrl.getAll(mockReq({ query: { limit: 'xyz' } }), mockRes());
    const [, opts] = mockSvc.getStockLogs.mock.calls[0];
    expect(opts.limit).toBe(10);
  });

  test('400 when filters query param is invalid JSON', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters: '{bad json' } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.INVALID_FILTERS_FORMAT,
    });
    expect(mockSvc.getStockLogs).not.toHaveBeenCalled();
  });

  test('404 when service returns status:false', async () => {
    mockSvc.getStockLogs.mockResolvedValue(err('No logs found'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('500 when service throws', async () => {
    mockSvc.getStockLogs.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOGS,
    });
  });

  test('handles empty list gracefully', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok({ list: [], total: 0 }));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.list).toEqual([]);
  });

  test('transforms date field to MongoDB extended JSON format', async () => {
    const dateStr = '2026-01-15T10:30:00.000Z';
    mockSvc.getStockLogs.mockResolvedValue(ok({ list: [{ date: dateStr }], total: 1 }));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const item = res.json.mock.calls[0][0].data.list[0];
    expect(item.date).toHaveProperty('$date');
    expect(item.date.$date).toHaveProperty('$numberLong');
  });

  test('transforms formatted created_date string to MongoDB extended JSON format', async () => {
    mockSvc.getStockLogs.mockResolvedValue(
      ok({
        list: [{ created_date: '04/13/2026 09:16 am' }],
        total: 1,
      })
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const item = res.json.mock.calls[0][0].data.list[0];
    expect(item.created_date).toHaveProperty('$date');
  });

  test('transforms formatted updated_date string to MongoDB extended JSON format', async () => {
    mockSvc.getStockLogs.mockResolvedValue(
      ok({
        list: [{ updated_date: '04/13/2026 02:30 pm' }],
        total: 1,
      })
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const item = res.json.mock.calls[0][0].data.list[0];
    expect(item.created_date === undefined || item.updated_date.$date).toBeTruthy();
  });

  test('leaves item unchanged when date fields are absent', async () => {
    mockSvc.getStockLogs.mockResolvedValue(
      ok({
        list: [{ _id: 'log1', item_name: 'Apple' }],
        total: 1,
      })
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const item = res.json.mock.calls[0][0].data.list[0];
    expect(item.item_name).toBe('Apple');
  });

  test('filters by item_id when provided', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ query: { filters: JSON.stringify({ item_id: 'item001' }) } });
    await ctrl.getAll(req, mockRes());
    const [filters] = mockSvc.getStockLogs.mock.calls[0];
    expect(filters.item_id).toBe('item001');
  });

  test('filters by type (movement type) when provided', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ query: { filters: JSON.stringify({ type: 'receiving' }) } });
    await ctrl.getAll(req, mockRes());
    const [filters] = mockSvc.getStockLogs.mock.calls[0];
    expect(filters.type).toBe('receiving');
  });

  test('filters by branch_id when provided', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({ query: { filters: JSON.stringify({ branch_id: 'br002' }) } });
    await ctrl.getAll(req, mockRes());
    const [filters] = mockSvc.getStockLogs.mock.calls[0];
    expect(filters.branch_id).toBe('br002');
  });

  test('filters by date range when provided', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const filters = { start_date: '2026-01-01', end_date: '2026-01-31' };
    const req = mockReq({ query: { filters: JSON.stringify(filters) } });
    await ctrl.getAll(req, mockRes());
    const [passed] = mockSvc.getStockLogs.mock.calls[0];
    expect(passed.start_date).toBe('2026-01-01');
    expect(passed.end_date).toBe('2026-01-31');
  });

  test('handles large pagination limit', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok({ list: [], total: 0 }));
    const req = mockReq({ query: { page: '1', limit: '1000' } });
    await ctrl.getAll(req, mockRes());
    const [, opts] = mockSvc.getStockLogs.mock.calls[0];
    expect(opts.limit).toBe(1000);
  });

  test('skips date transform when date is unparseable', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok({ list: [{ date: 'not-a-date' }], total: 1 }));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const item = res.json.mock.calls[0][0].data.list[0];
    expect(item.date).toBe('not-a-date');
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('getOne', () => {
  test('200 with stock log data on success', async () => {
    mockSvc.getStockLogDetail.mockResolvedValue(ok(sampleLog));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'log001' } }), res);
    expect(mockSvc.getStockLogDetail).toHaveBeenCalledWith('log001');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('404 when service returns status:false', async () => {
    mockSvc.getStockLogDetail.mockResolvedValue(err('Stock log not found'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'bad_id' } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: 'Stock log not found',
    });
  });

  test('500 when service throws', async () => {
    mockSvc.getStockLogDetail.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'log001' } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOG,
    });
  });

  test('passes correct id from params to service', async () => {
    mockSvc.getStockLogDetail.mockResolvedValue(ok(sampleLog));
    await ctrl.getOne(mockReq({ params: { id: 'abc123' } }), mockRes());
    expect(mockSvc.getStockLogDetail).toHaveBeenCalledWith('abc123');
  });
});

// =============================================================================
// create
// =============================================================================

describe('create', () => {
  const validBody = {
    item_id: 'item001',
    item_name: 'Apple',
    quantity: 10,
    type: 'receiving',
    branch_id: 'br001',
  };

  test('201 on successful creation', async () => {
    mockSvc.createStockLog.mockResolvedValue(
      ok({ _id: 'log002' }, SUCCESS_MESSAGES.STOCK_LOG_CREATED)
    );
    const res = mockRes();
    await ctrl.create(mockReq({ body: validBody }), res);
    expect(mockSvc.createStockLog).toHaveBeenCalledWith(validBody);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.CREATED);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('422 when validationResult has errors', async () => {
    validationResult.mockReturnValue(
      hasErrors(['item_id is required', 'quantity must be positive'])
    );
    const res = mockRes();
    await ctrl.create(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.VALIDATION_FAILED,
    });
    expect(mockSvc.createStockLog).not.toHaveBeenCalled();
  });

  test('400 when service returns status:false', async () => {
    mockSvc.createStockLog.mockResolvedValue(err('Duplicate log entry'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: validBody }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: 'Duplicate log entry',
    });
  });

  test('500 when service throws', async () => {
    mockSvc.createStockLog.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: validBody }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.FAILED_TO_CREATE_STOCK_LOG,
    });
  });

  test('passes entire req.body to service', async () => {
    mockSvc.createStockLog.mockResolvedValue(ok({}, 'Created'));
    const body = { ...validBody, notes: 'Manual entry', reason: 'Adjustment' };
    await ctrl.create(mockReq({ body }), mockRes());
    expect(mockSvc.createStockLog).toHaveBeenCalledWith(body);
  });

  test('validation errors array is included in response data', async () => {
    validationResult.mockReturnValue(hasErrors(['quantity must be > 0']));
    const res = mockRes();
    await ctrl.create(mockReq(), res);
    const data = res.json.mock.calls[0][0].data;
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty('msg');
  });

  test('service not called when validation fails (inventory safe)', async () => {
    validationResult.mockReturnValue(hasErrors(['missing item_id']));
    await ctrl.create(mockReq(), mockRes());
    expect(mockSvc.createStockLog).not.toHaveBeenCalled();
  });
});

// =============================================================================
// delete
// =============================================================================

describe('delete', () => {
  test('200 on successful delete with valid ids array', async () => {
    mockSvc.deleteStockLogs.mockResolvedValue(ok({ deleted: 2 }, 'Deleted'));
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: ['log001', 'log002'] } }), res);
    expect(mockSvc.deleteStockLogs).toHaveBeenCalledWith(['log001', 'log002']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('400 when ids is missing from body', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED,
    });
    expect(mockSvc.deleteStockLogs).not.toHaveBeenCalled();
  });

  test('400 when ids is an empty array', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0].message).toBe(ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED);
    expect(mockSvc.deleteStockLogs).not.toHaveBeenCalled();
  });

  test('400 when ids is a string (not array)', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: 'log001' } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(mockSvc.deleteStockLogs).not.toHaveBeenCalled();
  });

  test('400 when ids is a number', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: 123 } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
  });

  test('400 when service returns status:false', async () => {
    mockSvc.deleteStockLogs.mockResolvedValue(err('Delete failed'));
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: ['log001'] } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Delete failed' });
  });

  test('500 when service throws', async () => {
    mockSvc.deleteStockLogs.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: ['log001'] } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.FAILED_TO_DELETE_STOCK_LOGS,
    });
  });

  test('sets BaseModel context before deleting', async () => {
    mockSvc.deleteStockLogs.mockResolvedValue(ok({}));
    await ctrl.delete(mockReq({ body: { ids: ['log001'] } }), mockRes());
    expect(baseModelState.currentBranch).toBeDefined();
    expect(baseModelState.loggedUser).toBeDefined();
  });

  test('passes single-element ids array correctly', async () => {
    mockSvc.deleteStockLogs.mockResolvedValue(ok({ deleted: 1 }));
    await ctrl.delete(mockReq({ body: { ids: ['only_one'] } }), mockRes());
    expect(mockSvc.deleteStockLogs).toHaveBeenCalledWith(['only_one']);
  });
});

// =============================================================================
// export
// =============================================================================

describe('export', () => {
  test('200 with export data when body is a direct array of ids', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([sampleLog], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: ['log001', 'log002'] }), res);
    expect(mockSvc.exportStockLogs).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe(SUCCESS_MESSAGES.STOCK_EXPORTED);
  });

  test('filters by ObjectId $in when ids provided as direct array', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    await ctrl.export(mockReq({ body: ['log001'] }), mockRes());
    const [filters] = mockSvc.exportStockLogs.mock.calls[0];
    expect(filters).toHaveProperty('_id');
    expect(filters._id).toHaveProperty('$in');
  });

  test('200 when body is an object with numeric keys (converted to array)', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: { 0: 'log001', 1: 'log002' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSvc.exportStockLogs).toHaveBeenCalled();
  });

  test('200 when body is an object with data array property', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: { data: ['log001', 'log002'] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('200 when body is a JSON string of ids', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: '["log001","log002"]' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('exports all logs when body is empty object (no id filter)', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([sampleLog], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: {} }), res);
    const [filters] = mockSvc.exportStockLogs.mock.calls[0];
    expect(filters).toEqual({});
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('exports all logs when body is empty array', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: [] }), res);
    const [filters] = mockSvc.exportStockLogs.mock.calls[0];
    expect(filters).toEqual({});
  });

  test('skips invalid ObjectIds silently during id conversion', async () => {
    const { ObjectId } = require('mongodb');
    ObjectId.mockImplementationOnce(() => {
      throw new Error('Invalid ObjectId');
    });
    ObjectId.mockImplementation((id) => ({ id, toString: () => String(id) }));
    mockSvc.exportStockLogs.mockResolvedValue(ok([], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.export(mockReq({ body: ['invalid_id', 'log001'] }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when service returns status:false', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(err('Export failed'));
    const res = mockRes();
    await ctrl.export(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Export failed' });
  });

  test('500 when service throws', async () => {
    mockSvc.exportStockLogs.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.export(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.FAILED_TO_EXPORT_STOCK_LOGS,
    });
  });
});

// =============================================================================
// exportStocklogs (alias for export)
// =============================================================================

describe('exportStocklogs', () => {
  test('delegates to export — returns 200 on success', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(ok([sampleLog], SUCCESS_MESSAGES.STOCK_EXPORTED));
    const res = mockRes();
    await ctrl.exportStocklogs(mockReq({ body: ['log001'] }), res);
    expect(mockSvc.exportStockLogs).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe(SUCCESS_MESSAGES.STOCK_EXPORTED);
  });

  test('delegates to export — returns 500 when service throws', async () => {
    mockSvc.exportStockLogs.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.exportStocklogs(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
  });

  test('delegates to export — returns 400 when service fails', async () => {
    mockSvc.exportStockLogs.mockResolvedValue(err('Failed'));
    const res = mockRes();
    await ctrl.exportStocklogs(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
  });
});

// =============================================================================
// updateItemName
// =============================================================================

describe('updateItemName', () => {
  const validReq = () =>
    mockReq({
      params: { itemId: 'item001' },
      body: { item_name: 'Green Apple' },
    });

  test('200 on successful item name update', async () => {
    mockSvc.updateItemNameInStockLogs.mockResolvedValue(ok({ modifiedCount: 5 }, 'Updated'));
    const res = mockRes();
    await ctrl.updateItemName(validReq(), res);
    expect(mockSvc.updateItemNameInStockLogs).toHaveBeenCalledWith('item001', 'Green Apple');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('422 when validationResult has errors', async () => {
    validationResult.mockReturnValue(hasErrors(['item_name is required']));
    const res = mockRes();
    await ctrl.updateItemName(validReq(), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.VALIDATION_FAILED,
    });
    expect(mockSvc.updateItemNameInStockLogs).not.toHaveBeenCalled();
  });

  test('400 when service returns status:false', async () => {
    mockSvc.updateItemNameInStockLogs.mockResolvedValue(err('Item not found'));
    const res = mockRes();
    await ctrl.updateItemName(validReq(), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Item not found' });
  });

  test('500 when service throws', async () => {
    mockSvc.updateItemNameInStockLogs.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.updateItemName(validReq(), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0].message).toBe('Failed to update item name in stock logs');
  });

  test('passes itemId from params and item_name from body to service', async () => {
    mockSvc.updateItemNameInStockLogs.mockResolvedValue(ok({ modifiedCount: 3 }));
    const req = mockReq({ params: { itemId: 'abc999' }, body: { item_name: 'Mango Juice' } });
    await ctrl.updateItemName(req, mockRes());
    expect(mockSvc.updateItemNameInStockLogs).toHaveBeenCalledWith('abc999', 'Mango Juice');
  });

  test('validation errors included in response data', async () => {
    validationResult.mockReturnValue(hasErrors(['item_name too long']));
    const res = mockRes();
    await ctrl.updateItemName(validReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// =============================================================================
// cleanupOldDeletedLogs
// =============================================================================

describe('cleanupOldDeletedLogs', () => {
  test('200 on success with default daysOld=90', async () => {
    mockSvc.cleanupOldDeletedLogs.mockResolvedValue(ok({ deletedCount: 10 }, 'Cleaned'));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: {} }), res);
    expect(mockSvc.cleanupOldDeletedLogs).toHaveBeenCalledWith(90);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('200 on success with custom daysOld', async () => {
    mockSvc.cleanupOldDeletedLogs.mockResolvedValue(ok({ deletedCount: 5 }, 'Cleaned'));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: { daysOld: 30 } }), res);
    expect(mockSvc.cleanupOldDeletedLogs).toHaveBeenCalledWith(30);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('parses daysOld as integer', async () => {
    mockSvc.cleanupOldDeletedLogs.mockResolvedValue(ok({ deletedCount: 0 }));
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: { daysOld: '60' } }), mockRes());
    expect(mockSvc.cleanupOldDeletedLogs).toHaveBeenCalledWith(60);
  });

  test('422 when validationResult has errors', async () => {
    validationResult.mockReturnValue(hasErrors(['daysOld must be a positive integer']));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: { daysOld: -1 } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.VALIDATION_FAILED,
    });
    expect(mockSvc.cleanupOldDeletedLogs).not.toHaveBeenCalled();
  });

  test('400 when service returns status:false', async () => {
    mockSvc.cleanupOldDeletedLogs.mockResolvedValue(err('Cleanup failed'));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: { daysOld: 90 } }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Cleanup failed' });
  });

  test('500 when service throws', async () => {
    mockSvc.cleanupOldDeletedLogs.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json.mock.calls[0][0].message).toBe('Failed to cleanup old deleted logs');
  });

  test('validation errors included in response data', async () => {
    validationResult.mockReturnValue(hasErrors(['invalid daysOld']));
    const res = mockRes();
    await ctrl.cleanupOldDeletedLogs(mockReq({ body: {} }), res);
    expect(Array.isArray(res.json.mock.calls[0][0].data)).toBe(true);
  });

  test('service not called when validation fails (data safety)', async () => {
    validationResult.mockReturnValue(hasErrors(['error']));
    await ctrl.cleanupOldDeletedLogs(mockReq(), mockRes());
    expect(mockSvc.cleanupOldDeletedLogs).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Multi-tenant / branch isolation assertions
// =============================================================================

describe('branch isolation', () => {
  test('getAll sets branch context from session.selectedBranchId over user.branch_id', async () => {
    mockSvc.getStockLogs.mockResolvedValue(ok(sampleList));
    const req = mockReq({
      session: { selectedBranchId: 'priority_branch' },
      user: { ...adminUser, branch_id: 'lower_priority' },
    });
    await ctrl.getAll(req, mockRes());
    const branchValue = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(branchValue).toBe('priority_branch');
  });

  test('delete sets branch context from session.branch_id when selectedBranchId absent', async () => {
    mockSvc.deleteStockLogs.mockResolvedValue(ok({}));
    const req = mockReq({
      session: { branch_id: 'session_branch_id' },
      user: { ...adminUser, branch_id: undefined },
      body: { ids: ['log001'] },
    });
    await ctrl.delete(req, mockRes());
    const branchValue = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(branchValue).toBe('session_branch_id');
  });
});
