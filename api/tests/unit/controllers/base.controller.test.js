/**
 * Unit tests for base.controller.js
 *
 * BaseController is a plain ES6 class (no catchAsync, no singleton).
 * It is instantiated directly in tests — no mock child controller needed.
 *
 * External dependencies mocked:
 *  - ../services/base.service  (singleton instance)
 *  - ../utils/helpers           (formatDate — required lazily inside mongoDateFilter)
 */

// ─── Mocks (before imports) ───────────────────────────────────────────────────

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn((d) => `formatted:${d}`),
  isValidObjectId: jest.fn(),
  toObjectId: jest.fn(),
  generateRandomString: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const BaseController = require('../../../src/controllers/base.controller');
const baseService = require('../../../src/services/base.service');
const { formatDate } = require('../../../src/utils/helpers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  cookies: {},
  user: { _id: 'user_123', role: 'admin', license: 'lic_abc' },
  ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// constructor / setModel / getModel
// =============================================================================

describe('BaseController — constructor and model', () => {
  test('default model is null when no argument given', () => {
    const ctrl = new BaseController();
    expect(ctrl.model).toBeNull();
  });

  test('constructor stores provided model', () => {
    const fakeModel = { findById: jest.fn() };
    const ctrl = new BaseController(fakeModel);
    expect(ctrl.model).toBe(fakeModel);
  });

  test('setModel stores model and returns `this` for chaining', () => {
    const ctrl = new BaseController();
    const fakeModel = { find: jest.fn() };
    const returned = ctrl.setModel(fakeModel);
    expect(ctrl.model).toBe(fakeModel);
    expect(returned).toBe(ctrl);
  });

  test('getModel returns the currently stored model', () => {
    const fakeModel = { findOne: jest.fn() };
    const ctrl = new BaseController(fakeModel);
    expect(ctrl.getModel()).toBe(fakeModel);
  });

  test('getModel returns null before setModel is called', () => {
    const ctrl = new BaseController();
    expect(ctrl.getModel()).toBeNull();
  });
});

// =============================================================================
// checkPermission
// =============================================================================

describe('BaseController — checkPermission', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('returns false when user is null', () => {
    expect(ctrl.checkPermission('sales', 'read', null)).toBe(false);
  });

  test('returns false when user is undefined', () => {
    expect(ctrl.checkPermission('sales', 'read', undefined)).toBe(false);
  });

  test('returns true for super_admin regardless of resource/action', () => {
    expect(ctrl.checkPermission('sales', 'delete', { usertype: 'super_admin' })).toBe(true);
  });

  test('returns true for admin role', () => {
    expect(ctrl.checkPermission('item', 'write', { role: 'admin' })).toBe(true);
  });

  test('returns true for manager role', () => {
    expect(ctrl.checkPermission('branch', 'delete', { role: 'manager' })).toBe(true);
  });

  test('returns true for api role', () => {
    expect(ctrl.checkPermission('users', 'write', { role: 'api' })).toBe(true);
  });

  test('role matching is case-insensitive (ADMIN → admin)', () => {
    expect(ctrl.checkPermission('sales', 'delete', { role: 'ADMIN' })).toBe(true);
  });

  test('returns false for low-privilege user with no access property (write)', () => {
    expect(ctrl.checkPermission('sales', 'write', { role: 'cashier' })).toBe(false);
  });

  test('returns true for low-privilege user with no access property (read fallback)', () => {
    expect(ctrl.checkPermission('sales', 'read', { role: 'cashier' })).toBe(true);
  });

  test('returns true when user.access.sales.read is true', () => {
    expect(
      ctrl.checkPermission('sales', 'read', {
        role: 'cashier',
        access: { sales: { read: true } },
      })
    ).toBe(true);
  });

  test('returns false when user.access.sales.read is false', () => {
    expect(
      ctrl.checkPermission('sales', 'read', {
        role: 'cashier',
        access: { sales: { read: false } },
      })
    ).toBe(false);
  });

  test('returns true when user.access.sales.write is true', () => {
    expect(
      ctrl.checkPermission('sales', 'write', {
        role: 'cashier',
        access: { sales: { write: true } },
      })
    ).toBe(true);
  });

  test('returns false when user.access.sales.write is false', () => {
    expect(
      ctrl.checkPermission('sales', 'write', {
        role: 'cashier',
        access: { sales: { write: false } },
      })
    ).toBe(false);
  });

  test('returns true when user.access.sales.delete is true', () => {
    expect(
      ctrl.checkPermission('sales', 'delete', {
        role: 'cashier',
        access: { sales: { delete: true } },
      })
    ).toBe(true);
  });

  test('resource alias: customers → customer ACL key', () => {
    expect(
      ctrl.checkPermission('customers', 'read', {
        role: 'cashier',
        access: { customer: { read: true } },
      })
    ).toBe(true);
  });

  test('resource alias: expenses → expense ACL key', () => {
    expect(
      ctrl.checkPermission('expenses', 'write', {
        role: 'cashier',
        access: { expense: { write: true } },
      })
    ).toBe(true);
  });

  test('resource alias: invoices → sales ACL key', () => {
    expect(
      ctrl.checkPermission('invoices', 'write', {
        role: 'cashier',
        access: { sales: { write: true } },
      })
    ).toBe(true);
  });

  test('resource alias: easytable → report ACL key', () => {
    expect(
      ctrl.checkPermission('easytable', 'read', {
        role: 'cashier',
        access: { report: { read: true } },
      })
    ).toBe(true);
  });

  test('action alias: view → read', () => {
    expect(
      ctrl.checkPermission('sales', 'view', {
        role: 'cashier',
        access: { sales: { read: true } },
      })
    ).toBe(true);
  });

  test('action alias: create → write', () => {
    expect(
      ctrl.checkPermission('item', 'create', {
        role: 'cashier',
        access: { item: { write: true } },
      })
    ).toBe(true);
  });

  test('action alias: update → write', () => {
    expect(
      ctrl.checkPermission('item', 'update', {
        role: 'cashier',
        access: { item: { write: true } },
      })
    ).toBe(true);
  });

  test('action alias: remove → delete', () => {
    expect(
      ctrl.checkPermission('item', 'remove', {
        role: 'cashier',
        access: { item: { delete: true } },
      })
    ).toBe(true);
  });

  test('reads access from user._doc.access when user.access is absent', () => {
    expect(
      ctrl.checkPermission('sales', 'write', {
        role: 'cashier',
        _doc: { access: { sales: { write: true } } },
      })
    ).toBe(true);
  });

  test('returns false for write when access exists but has empty moduleAcl', () => {
    expect(
      ctrl.checkPermission('sales', 'write', {
        role: 'cashier',
        access: { sales: {} },
      })
    ).toBe(false);
  });

  // ── Fallthrough ACL branches (lines 79/82/85) ───────────────────────────
  // These run when the ACL value is present but INHERITED (not own property),
  // so hasOwnProperty returns false and the fallthrough checks fire.

  test('returns true via fallthrough when moduleAcl.read is inherited (line 79)', () => {
    const inheritedAcl = Object.create({ read: true }); // read is inherited, not own
    expect(
      ctrl.checkPermission('sales', 'read', {
        role: 'cashier',
        access: { sales: inheritedAcl },
      })
    ).toBe(true);
  });

  test('returns true via fallthrough when moduleAcl.write is inherited (line 82)', () => {
    const inheritedAcl = Object.create({ write: true }); // write is inherited
    expect(
      ctrl.checkPermission('sales', 'create', {
        role: 'cashier',
        access: { sales: inheritedAcl },
      })
    ).toBe(true);
  });

  test('returns true via fallthrough when moduleAcl.delete is inherited (line 85)', () => {
    const inheritedAcl = Object.create({ delete: true }); // delete is inherited
    expect(
      ctrl.checkPermission('sales', 'delete', {
        role: 'cashier',
        access: { sales: inheritedAcl },
      })
    ).toBe(true);
  });
});

// =============================================================================
// success
// =============================================================================

describe('BaseController — success', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('sends 200 with PHP-compatible shape by default', () => {
    const res = mockRes();
    ctrl.success(res, { id: 1 }, 'Done');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      status: true,
      message: 'Done',
      data: { id: 1 },
    });
  });

  test('uses custom statusCode', () => {
    const res = mockRes();
    ctrl.success(res, null, 'Created', 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('data defaults to null', () => {
    const res = mockRes();
    ctrl.success(res);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toBeNull();
  });

  test('delegates to res.success() when that method exists', () => {
    const res = { success: jest.fn() };
    ctrl.success(res, { a: 1 }, 'ok', 200);
    expect(res.success).toHaveBeenCalledWith('ok', { a: 1 }, 200);
  });

  test('does NOT call res.status if res.success() exists', () => {
    const res = { success: jest.fn(), status: jest.fn() };
    ctrl.success(res, null, 'ok', 200);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// =============================================================================
// created
// =============================================================================

describe('BaseController — created', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('sends 201 with provided message and data', () => {
    const res = mockRes();
    ctrl.created(res, 'Item created', { id: 99 });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        status: true,
        message: 'Item created',
        data: { id: 99 },
      })
    );
  });

  test('defaults to 201 status code', () => {
    const res = mockRes();
    ctrl.created(res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// =============================================================================
// sendResponse (legacy alias)
// =============================================================================

describe('BaseController — sendResponse', () => {
  test('delegates to success with identical arguments', () => {
    const ctrl = new BaseController();
    const res = mockRes();
    ctrl.sendResponse(res, { x: 1 }, 'OK', 200);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', data: { x: 1 } })
    );
  });
});

// =============================================================================
// error
// =============================================================================

describe('BaseController — error', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('sends 400 with PHP-compatible error shape by default', () => {
    const res = mockRes();
    ctrl.error(res, 'Bad input');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      status: false,
      message: 'Bad input',
      data: null,
    });
  });

  test('uses custom statusCode', () => {
    const res = mockRes();
    ctrl.error(res, 'Not found', 404);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('includes errors in data field', () => {
    const res = mockRes();
    const errs = [{ field: 'email', msg: 'Required' }];
    ctrl.error(res, 'Validation failed', 422, errs);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual(errs);
  });

  test('data is null when no errors provided', () => {
    const res = mockRes();
    ctrl.error(res, 'Oops');
    const json = res.json.mock.calls[0][0];
    expect(json.data).toBeNull();
  });

  test('delegates to res.error() when that method exists', () => {
    const res = { error: jest.fn() };
    ctrl.error(res, 'Forbidden', 403, null);
    expect(res.error).toHaveBeenCalledWith('Forbidden', null, 403);
  });

  test('does NOT call res.status if res.error() exists', () => {
    const res = { error: jest.fn(), status: jest.fn() };
    ctrl.error(res, 'err', 400);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// =============================================================================
// validationError
// =============================================================================

describe('BaseController — validationError', () => {
  test('sends 422 with provided message and errors array', () => {
    const ctrl = new BaseController();
    const res = mockRes();
    const errs = [{ field: 'name', msg: 'Required' }];
    ctrl.validationError(res, 'Validation failed', errs);
    expect(res.status).toHaveBeenCalledWith(422);
    const json = res.json.mock.calls[0][0];
    expect(json.type).toBe('error');
    expect(json.data).toEqual(errs);
  });

  test('defaults to empty errors array', () => {
    const ctrl = new BaseController();
    const res = mockRes();
    ctrl.validationError(res);
    const json = res.json.mock.calls[0][0];
    expect(json.data).toEqual([]);
  });
});

// =============================================================================
// sendError (legacy alias)
// =============================================================================

describe('BaseController — sendError', () => {
  test('delegates to error with same arguments', () => {
    const ctrl = new BaseController();
    const res = mockRes();
    ctrl.sendError(res, 'DB failure', 500, null);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

// =============================================================================
// notFound / unauthorized / forbidden
// =============================================================================

describe('BaseController — notFound / unauthorized / forbidden', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('notFound sends 404 with default message', () => {
    const res = mockRes();
    ctrl.notFound(res);
    expect(res.status).toHaveBeenCalledWith(404);
    const json = res.json.mock.calls[0][0];
    expect(json.message).toBe('Resource not found');
  });

  test('notFound sends 404 with custom message', () => {
    const res = mockRes();
    ctrl.notFound(res, 'Item not found');
    expect(res.json.mock.calls[0][0].message).toBe('Item not found');
  });

  test('unauthorized sends 401 with default message', () => {
    const res = mockRes();
    ctrl.unauthorized(res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].message).toBe('Unauthorized');
  });

  test('unauthorized sends 401 with custom message', () => {
    const res = mockRes();
    ctrl.unauthorized(res, 'Token expired');
    expect(res.json.mock.calls[0][0].message).toBe('Token expired');
  });

  test('forbidden sends 403 with default message', () => {
    const res = mockRes();
    ctrl.forbidden(res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe('Forbidden');
  });

  test('forbidden sends 403 with custom message', () => {
    const res = mockRes();
    ctrl.forbidden(res, 'Admin only');
    expect(res.json.mock.calls[0][0].message).toBe('Admin only');
  });
});

// =============================================================================
// mongoIDFilter
// =============================================================================

describe('BaseController — mongoIDFilter', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('returns null input unchanged', () => {
    expect(ctrl.mongoIDFilter(null)).toBeNull();
  });

  test('returns undefined input unchanged', () => {
    expect(ctrl.mongoIDFilter(undefined)).toBeUndefined();
  });

  test('converts ObjectId-like _id to string', () => {
    const input = { _id: { toString: () => 'abc123', someOtherProp: true } };
    const result = ctrl.mongoIDFilter(input);
    expect(result._id).toBe('abc123');
  });

  test('leaves plain string _id unchanged', () => {
    const input = { _id: 'already-string', name: 'Test' };
    const result = ctrl.mongoIDFilter(input);
    expect(result._id).toBe('already-string');
  });

  test('does not modify the original object', () => {
    const objectId = { toString: () => 'id1', someFlag: true };
    const input = { _id: objectId, name: 'Original' };
    ctrl.mongoIDFilter(input);
    expect(input._id).toBe(objectId); // original untouched
  });

  test('preserves Date instances without spreading them', () => {
    const date = new Date('2024-01-15');
    const input = { createdAt: date };
    const result = ctrl.mongoIDFilter(input);
    expect(result.createdAt).toBe(date);
  });

  test('preserves BSON type objects (_bsontype property)', () => {
    const bsonObj = { _bsontype: 'ObjectId', toString: () => 'bsonId' };
    const result = ctrl.mongoIDFilter(bsonObj);
    expect(result).toBe(bsonObj); // returned as-is
  });

  test('processes arrays of objects', () => {
    const input = [
      { _id: { toString: () => 'id1' }, name: 'A' },
      { _id: { toString: () => 'id2' }, name: 'B' },
    ];
    const result = ctrl.mongoIDFilter(input);
    expect(result[0]._id).toBe('id1');
    expect(result[1]._id).toBe('id2');
  });

  test('recursively converts nested ObjectId-like _id', () => {
    const input = {
      _id: { toString: () => 'parent' },
      child: { _id: { toString: () => 'child' }, label: 'c' },
    };
    const result = ctrl.mongoIDFilter(input);
    expect(result.child._id).toBe('child');
  });

  test('passes through primitive values untouched', () => {
    const input = { count: 5, active: true, name: 'Test' };
    const result = ctrl.mongoIDFilter(input);
    expect(result).toEqual(input);
  });
});

// =============================================================================
// mongoDateFilter
// =============================================================================

describe('BaseController — mongoDateFilter', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
    formatDate.mockImplementation((d) => `formatted:${d}`);
  });

  test('returns null input unchanged', () => {
    expect(ctrl.mongoDateFilter(null)).toBeNull();
  });

  test('returns undefined input unchanged', () => {
    expect(ctrl.mongoDateFilter(undefined)).toBeUndefined();
  });

  test('adds string_date from updated_date (highest priority)', () => {
    const d = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter({ updated_date: d, updatedAt: new Date() });
    expect(formatDate).toHaveBeenCalledWith(d);
    expect(result.string_date).toBe(`formatted:${d}`);
  });

  test('falls back to updatedAt when updated_date absent', () => {
    const d = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter({ updatedAt: d });
    expect(formatDate).toHaveBeenCalledWith(d);
  });

  test('falls back to date field', () => {
    const d = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter({ date: d });
    expect(formatDate).toHaveBeenCalledWith(d);
  });

  test('falls back to created_date', () => {
    const d = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter({ created_date: d });
    expect(formatDate).toHaveBeenCalledWith(d);
  });

  test('falls back to createdAt (lowest priority)', () => {
    const d = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter({ createdAt: d });
    expect(formatDate).toHaveBeenCalledWith(d);
  });

  test('sets string_date to empty string when no date field found', () => {
    const result = ctrl.mongoDateFilter({ name: 'Test' });
    expect(result.string_date).toBe('');
    expect(formatDate).not.toHaveBeenCalled();
  });

  test('processes arrays by mapping each item', () => {
    const d1 = new Date('2024-01-01');
    const d2 = new Date('2024-06-01');
    const result = ctrl.mongoDateFilter([{ updatedAt: d1 }, { updatedAt: d2 }]);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].string_date).toBe(`formatted:${d1}`);
    expect(result[1].string_date).toBe(`formatted:${d2}`);
  });

  test('does not mutate original object', () => {
    const input = { updatedAt: new Date() };
    ctrl.mongoDateFilter(input);
    expect(input.string_date).toBeUndefined();
  });
});

// =============================================================================
// formatReportResponse
// =============================================================================

describe('BaseController — formatReportResponse', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('returns success with list, total, total_pages, current_page, per_page', () => {
    const res = mockRes();
    const result = { status: true, list: [{ id: 1 }], pagination: { total: 10, page: 1 } };
    ctrl.formatReportResponse(res, result, { limit: 5, page: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.list).toHaveLength(1);
    expect(json.data.total).toBe(10);
    expect(json.data.total_pages).toBe(2); // ceil(10/5)
    expect(json.data.current_page).toBe(1);
    expect(json.data.per_page).toBe(5);
  });

  test('total_pages is at least 1 when total=0', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, list: [], pagination: { total: 0 } },
      { limit: 5, page: 1 }
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.total_pages).toBe(1); // Math.max(ceil(0/5), 1) = 1
  });

  test('uses options defaults when not provided (limit=5, page=1)', () => {
    const res = mockRes();
    ctrl.formatReportResponse(res, { status: true, list: [], pagination: { total: 0 } });
    const json = res.json.mock.calls[0][0];
    expect(json.data.per_page).toBe(5);
    expect(json.data.current_page).toBe(1);
  });

  test('returns "No records found" message when list is empty', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, list: [], pagination: { total: 0 } },
      { limit: 10, page: 1 }
    );
    const json = res.json.mock.calls[0][0];
    expect(json.message).toBe('No records found');
  });

  test('returns result.message when list has items', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, list: [{ id: 1 }], pagination: { total: 1 }, message: 'Records fetched' },
      { limit: 10, page: 1 }
    );
    const json = res.json.mock.calls[0][0];
    expect(json.message).toBe('Records fetched');
  });

  test('falls back to "success" when list has items but no message', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, list: [{ id: 1 }], pagination: { total: 1 } },
      { limit: 10, page: 1 }
    );
    expect(res.json.mock.calls[0][0].message).toBe('success');
  });

  test('returns empty list with status:true when result.status is false', () => {
    const res = mockRes();
    ctrl.formatReportResponse(res, { status: false }, { limit: 5, page: 2 });
    const json = res.json.mock.calls[0][0];
    expect(json.type).toBe('success');
    expect(json.data.list).toEqual([]);
    expect(json.data.total).toBe(0);
    expect(json.data.total_pages).toBe(1);
    expect(json.data.current_page).toBe(2);
  });

  test('treats result.status === undefined as success', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { list: [{ id: 1 }], pagination: { total: 1 } },
      { limit: 10, page: 1 }
    );
    const json = res.json.mock.calls[0][0];
    expect(json.type).toBe('success');
    expect(json.data.list).toHaveLength(1);
  });

  test('reads list from result.data.list when result.list is absent', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, data: { list: [{ id: 5 }], pagination: { total: 1 } } },
      { limit: 10, page: 1 }
    );
    expect(res.json.mock.calls[0][0].data.list).toHaveLength(1);
  });

  test('handles result with no list or data (defaults to [])', () => {
    const res = mockRes();
    ctrl.formatReportResponse(res, { status: true }, { limit: 5, page: 1 });
    const json = res.json.mock.calls[0][0];
    expect(json.data.list).toEqual([]);
  });

  test('calculates total_pages correctly with large total', () => {
    const res = mockRes();
    ctrl.formatReportResponse(
      res,
      { status: true, list: Array(10).fill({}), pagination: { total: 100 } },
      { limit: 10, page: 3 }
    );
    expect(res.json.mock.calls[0][0].data.total_pages).toBe(10); // ceil(100/10)
  });
});

// =============================================================================
// autoSuggestionReportTableField
// =============================================================================

describe('BaseController — autoSuggestionReportTableField', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('calls baseService.getReportAutoSuggestions with correct args', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({
      status: true,
      data: ['Suggestion A'],
    });
    const req = mockReq({
      query: { query: 'Jo', field: 'name', module: 'customers', branch: ['b1', 'b2'] },
    });
    const res = mockRes();

    await ctrl.autoSuggestionReportTableField(req, res);

    expect(baseService.getReportAutoSuggestions).toHaveBeenCalledWith(
      'Jo',
      'name',
      'customers',
      ['b1', 'b2'],
      req.user
    );
  });

  test('returns 200 with query and suggestions on success', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({ status: true, data: ['Result'] });
    const req = mockReq({ query: { query: 'test', field: 'name', module: 'items' } });
    const res = mockRes();

    await ctrl.autoSuggestionReportTableField(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ query: 'test', suggestions: ['Result'] });
  });

  test('returns 404 error when service returns status:false', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { query: 'x', field: 'name', module: 'items' } });
    const res = mockRes();

    await ctrl.autoSuggestionReportTableField(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const json = res.json.mock.calls[0][0];
    expect(json.type).toBe('error');
  });

  test('returns 500 error when service throws', async () => {
    baseService.getReportAutoSuggestions.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ query: { query: 'x', field: 'name', module: 'items' } });
    const res = mockRes();

    await ctrl.autoSuggestionReportTableField(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const json = res.json.mock.calls[0][0];
    expect(json.message).toBe('DB crash');
  });

  test('defaults query to "" and field to "name" when not provided', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ query: { module: 'sales' } });

    await ctrl.autoSuggestionReportTableField(req, mockRes());

    expect(baseService.getReportAutoSuggestions).toHaveBeenCalledWith(
      '',
      'name',
      'sales',
      [],
      req.user
    );
  });

  test('wraps single string branch param in array', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({
      query: { query: 'a', field: 'name', module: 'sales', branch: 'branch1' },
    });

    await ctrl.autoSuggestionReportTableField(req, mockRes());

    expect(baseService.getReportAutoSuggestions).toHaveBeenCalledWith(
      'a',
      'name',
      'sales',
      ['branch1'],
      req.user
    );
  });

  test('uses branch[] query param as branch filter', async () => {
    baseService.getReportAutoSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ query: { 'branch[]': ['b1', 'b2'], module: 'sales' } });

    await ctrl.autoSuggestionReportTableField(req, mockRes());

    const [, , , branchArg] = baseService.getReportAutoSuggestions.mock.calls[0];
    expect(branchArg).toEqual(['b1', 'b2']);
  });
});

// =============================================================================
// autoSuggestionTableField
// =============================================================================

describe('BaseController — autoSuggestionTableField', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('calls baseService.getAutoSuggestions with correct args', async () => {
    baseService.getAutoSuggestions.mockResolvedValue({ status: true, data: ['ItemA'] });
    const req = mockReq({ query: { query: 'it', field: 'name', module: 'item' } });
    const res = mockRes();

    await ctrl.autoSuggestionTableField(req, res);

    expect(baseService.getAutoSuggestions).toHaveBeenCalledWith('name', 'item', 'it', req.user);
  });

  test('returns 200 with query and suggestions on success', async () => {
    baseService.getAutoSuggestions.mockResolvedValue({ status: true, data: ['A', 'B'] });
    const req = mockReq({ query: { query: 'ab', field: 'name', module: 'item' } });
    const res = mockRes();

    await ctrl.autoSuggestionTableField(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ query: 'ab', suggestions: ['A', 'B'] });
  });

  test('returns 404 when service returns status:false', async () => {
    baseService.getAutoSuggestions.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { query: 'x', field: 'name', module: 'item' } });
    const res = mockRes();

    await ctrl.autoSuggestionTableField(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    baseService.getAutoSuggestions.mockRejectedValue(new Error('Timeout'));
    const res = mockRes();

    await ctrl.autoSuggestionTableField(mockReq({ query: { module: 'item' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Timeout');
  });

  test('defaults query to "" and field to "name"', async () => {
    baseService.getAutoSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ query: { collection: 'categories' } });

    await ctrl.autoSuggestionTableField(req, mockRes());

    expect(baseService.getAutoSuggestions).toHaveBeenCalledWith('name', 'categories', '', req.user);
  });

  test('uses collection param when module is not provided', async () => {
    baseService.getAutoSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ query: { collection: 'suppliers', query: 'x' } });

    await ctrl.autoSuggestionTableField(req, mockRes());

    expect(baseService.getAutoSuggestions).toHaveBeenCalledWith('name', 'suppliers', 'x', req.user);
  });
});

// =============================================================================
// getDefaultSuggest
// =============================================================================

describe('BaseController — getDefaultSuggest', () => {
  let ctrl;
  beforeEach(() => {
    ctrl = new BaseController();
  });

  test('returns 400 when module query param is missing', async () => {
    const res = mockRes();
    await ctrl.getDefaultSuggest(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const json = res.json.mock.calls[0][0];
    expect(json.type).toBe('error');
    expect(json.message).toMatch(/module parameter is required/i);
  });

  test('does NOT call service when module is missing', async () => {
    await ctrl.getDefaultSuggest(mockReq({ query: {} }), mockRes());
    expect(baseService.getDefaultSuggestions).not.toHaveBeenCalled();
  });

  test('calls baseService.getDefaultSuggestions with correct args', async () => {
    baseService.getDefaultSuggestions.mockResolvedValue({ status: true, data: ['CustA'] });
    const req = mockReq({ query: { module: 'customers', query: 'Ali' } });

    await ctrl.getDefaultSuggest(req, mockRes());

    expect(baseService.getDefaultSuggestions).toHaveBeenCalledWith('customers', 'Ali', req.user);
  });

  test('returns 200 with query and suggestions on success', async () => {
    baseService.getDefaultSuggestions.mockResolvedValue({ status: true, data: ['CustA'] });
    const req = mockReq({ query: { module: 'customers', query: 'Ali' } });
    const res = mockRes();

    await ctrl.getDefaultSuggest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ query: 'Ali', suggestions: ['CustA'] });
  });

  test('returns 404 when service returns status:false', async () => {
    baseService.getDefaultSuggestions.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ query: { module: 'customers', query: 'x' } });
    const res = mockRes();

    await ctrl.getDefaultSuggest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    baseService.getDefaultSuggestions.mockRejectedValue(new Error('DB error'));
    const res = mockRes();

    await ctrl.getDefaultSuggest(mockReq({ query: { module: 'customers' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('DB error');
  });

  test('defaults query to "" when not provided', async () => {
    baseService.getDefaultSuggestions.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ query: { module: 'suppliers' } });

    await ctrl.getDefaultSuggest(req, mockRes());

    expect(baseService.getDefaultSuggestions).toHaveBeenCalledWith('suppliers', '', req.user);
  });
});
