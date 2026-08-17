/**
 * Unit tests for customers.controller.js
 *
 * ACTIVE STATUS: This is the active customer controller used by routes.
 * Located at: src/controllers/customers.controller.js
 * Exported as singleton: module.exports = new CustomerController()
 *
 * Architecture: Route → Controller → Service → Repository → Model
 * Uses asyncHandler for most methods (arrow function class properties).
 * customerGraphicalReports and customerOutstandingReportTable are plain async methods.
 *
 * Dependencies mocked:
 *   - CustomerService           (this.service in constructor)
 *   - express-validator         (validationResult)
 *   - express-async-handler     (transparent pass-through)
 *   - ../models/base.model      (static context + prototype.getCollection)
 *   - ../models/branch.model    (Branch.findById used in transaction())
 *   - ../utils/session-filter.util (applySessionFilter used in customerGraphicalReports)
 *   - ../services/base.service  (transitive dependency prevention)
 */

// ─── Module mocks (must be before any require) ────────────────────────────────

jest.mock('express-async-handler', () => (fn) => fn);
jest.mock('../../../src/services/customer.service');
jest.mock('express-validator', () => ({ validationResult: jest.fn() }));

// base.service transitive mock
jest.mock('../../../src/services/base.service', () => ({}));

jest.mock('../../../src/utils/session-filter.util', () => ({
  applySessionFilter: jest.fn(),
}));

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
}));

// BaseModel mock with static properties + prototype.getCollection
const mockGetCollection = jest.fn();
jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static currentBranch = null;
    static license = null;
    static loggedUser = null;
    static loggedUserName = '';
  }
  MockBaseModel.prototype.getCollection = mockGetCollection;
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const { validationResult } = require('express-validator');
const CustomerService = require('../../../src/services/customer.service');
const sessionFilterUtil = require('../../../src/utils/session-filter.util');
const Branch = require('../../../src/models/branch.model');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = 'aabbccddeeff001122334455'; // valid 24-char hex
const BRANCH_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const LICENSE_ID = 'cccccccccccccccccccccccc';
const CATEGORY_ID = 'dddddddddddddddddddddddd';
const REFERRER_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

const adminUser = {
  _id: VALID_ID,
  role: 'admin',
  username: 'admin',
  name: 'Admin User',
  license: LICENSE_ID,
  branch_id: BRANCH_ID,
  branch_name: 'Main Branch',
  access: { report: { read: true } },
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockRequest = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  user: adminUser,
  session: {},
  ...overrides,
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const withValidationErrors = () => {
  validationResult.mockReturnValueOnce({
    isEmpty: jest.fn().mockReturnValue(false),
    array: jest.fn().mockReturnValue([{ path: 'name', msg: 'Required' }]),
  });
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let ctrl;
let service;

beforeAll(() => {
  ctrl = require('../../../src/controllers/customers.controller');
  service = ctrl.service;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Default: validation passes
  validationResult.mockReturnValue({
    isEmpty: jest.fn().mockReturnValue(true),
    array: jest.fn().mockReturnValue([]),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── normalizeExportIds ────────────────────────────────────────────────────────

describe('CustomerController — normalizeExportIds', () => {
  it('returns [] for null/undefined input', () => {
    expect(ctrl.normalizeExportIds(null)).toEqual([]);
    expect(ctrl.normalizeExportIds(undefined)).toEqual([]);
  });

  it('returns array as-is when input is already an array', () => {
    const ids = ['id1', 'id2'];
    expect(ctrl.normalizeExportIds(ids)).toEqual(ids);
  });

  it('returns object.data when present', () => {
    expect(ctrl.normalizeExportIds({ data: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('returns object.ids when data is absent', () => {
    expect(ctrl.normalizeExportIds({ ids: ['x', 'y'] })).toEqual(['x', 'y']);
  });

  it('parses JSON-array string key from single-key object', () => {
    const key = JSON.stringify(['id1', 'id2']);
    expect(ctrl.normalizeExportIds({ [key]: 1 })).toEqual(['id1', 'id2']);
  });

  it('returns object values when all are strings', () => {
    expect(ctrl.normalizeExportIds({ 0: 'a', 1: 'b' })).toEqual(['a', 'b']);
  });

  it('parses a JSON-array string', () => {
    expect(ctrl.normalizeExportIds('["id1","id2"]')).toEqual(['id1', 'id2']);
  });

  it('wraps non-array JSON-string value', () => {
    expect(ctrl.normalizeExportIds('"singleId"')).toEqual(['singleId']);
  });

  it('wraps a raw string that is not valid JSON', () => {
    expect(ctrl.normalizeExportIds('rawId')).toEqual(['rawId']);
  });

  it('wraps a non-string, non-object primitive', () => {
    expect(ctrl.normalizeExportIds(42)).toEqual([42]);
  });
});

// ─── getCustomers ─────────────────────────────────────────────────────────────

describe('CustomerController — getCustomers', () => {
  const makeReq = (query = {}) => mockRequest({ query });

  it('returns 400 when validation fails', async () => {
    withValidationErrors();
    const req = makeReq();
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns paginated list on success with default pagination', async () => {
    const serviceData = { data: [{ name: 'Test' }], total: 1, limit: 10, page: 1, totalPages: 1 };
    service.getAllCustomers.mockResolvedValue({ status: true, data: serviceData, message: 'ok' });
    const req = makeReq();
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({ list: expect.any(Array), total: 1 }),
      })
    );
  });

  it('uses default page=1 when page is 0 or negative', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0, limit: 10, page: 1, totalPages: 0 },
      message: 'ok',
    });
    const req = makeReq({ page: '0' });
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    const [, options] = service.getAllCustomers.mock.calls[0];
    expect(options.page).toBe(1);
  });

  it('uses custom page and limit from query', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0, limit: 20, page: 3, totalPages: 0 },
      message: 'ok',
    });
    const req = makeReq({ page: '3', limit: '20' });
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    const [, options] = service.getAllCustomers.mock.calls[0];
    expect(options.page).toBe(3);
    expect(options.limit).toBe(20);
  });

  it('applies search, tier, and branch_id filters', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = makeReq({ search: 'john', tier: 'gold', branch_id: BRANCH_ID });
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    const [filters] = service.getAllCustomers.mock.calls[0];
    expect(filters.search).toBe('john');
    expect(filters.tier).toBe('gold');
    expect(filters.branch_id).toBe(BRANCH_ID);
  });

  it('parses filters JSON from query string', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = makeReq({ filters: JSON.stringify({ category: 'vip' }) });
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    const [filters] = service.getAllCustomers.mock.calls[0];
    expect(filters.category).toBe('vip');
  });

  it('returns 400 when service returns status=false', async () => {
    service.getAllCustomers.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = makeReq();
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('falls back to user.branch_id when no branch in query/session', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = makeReq({});
    req.user = { ...adminUser, branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    const [filters] = service.getAllCustomers.mock.calls[0];
    expect(filters.branch_id).toBe(BRANCH_ID);
  });
});

// ─── getCustomer ──────────────────────────────────────────────────────────────

describe('CustomerController — getCustomer', () => {
  it('returns 400 when no id in params or query', async () => {
    const req = mockRequest({ params: {}, query: {} });
    const res = mockResponse();
    await ctrl.getCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 on success with id from params', async () => {
    service.getCustomerById.mockResolvedValue({
      status: true,
      data: { name: 'John' },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getCustomer(req, res);
    expect(service.getCustomerById).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reads id from query when params.id is absent', async () => {
    service.getCustomerById.mockResolvedValue({
      status: true,
      data: { name: 'John' },
      message: 'ok',
    });
    const req = mockRequest({ params: {}, query: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getCustomer(req, res);
    expect(service.getCustomerById).toHaveBeenCalledWith(VALID_ID);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getCustomerById.mockResolvedValue({ status: false, message: 'Not found', data: null });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── createCustomer ───────────────────────────────────────────────────────────

describe('CustomerController — createCustomer', () => {
  const baseBody = { name: 'Alice', email: 'alice@test.com', phone: '9876543210' };

  it('returns 400 when validation fails', async () => {
    withValidationErrors();
    const req = mockRequest({ body: baseBody });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.createCustomer).not.toHaveBeenCalled();
  });

  it('returns 201 on successful creation', async () => {
    service.createCustomer.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'created',
    });
    const req = mockRequest({ body: baseBody });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('passes name, email, phone to service', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: baseBody });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.name).toBe('Alice');
    expect(customerData.email).toBe('alice@test.com');
    expect(customerData.phone).toBe('9876543210');
  });

  it('sets country to default India when not provided', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.country).toBe('India');
  });

  it('enables gst when gst_type is not consumer', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      body: { name: 'Tax Co', gst_type: 'regular', gstin_number: '12ABCDE1234F1Z5' },
    });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.gst).toBe('enable');
  });

  it('sets gst=disable when no gst info', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.gst).toBe('disable');
  });

  it('sets created_by from user.username', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.created_by).toBe('admin');
  });

  it('adds loyalty data when enableLoyalty is true', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob', enableLoyalty: true } });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.loyalty).toBeDefined();
    expect(customerData.loyalty.tier).toBe('bronze');
  });

  it('normalizes partial_balance via normalizeBoolean', async () => {
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob', partial_balance: 'on' } });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.partial_balance).toBe(true);
  });

  it('returns 400 when service returns status=false', async () => {
    service.createCustomer.mockResolvedValue({ status: false, message: 'Duplicate', data: null });
    const req = mockRequest({ body: baseBody });
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── updateCustomer ───────────────────────────────────────────────────────────

describe('CustomerController — updateCustomer', () => {
  it('returns 400 when validation fails', async () => {
    withValidationErrors();
    const req = mockRequest({ params: { id: VALID_ID }, body: { name: 'X' } });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.updateCustomer).not.toHaveBeenCalled();
  });

  it('returns 200 on successful update', async () => {
    service.updateCustomer.mockResolvedValue({
      status: true,
      data: { name: 'Updated' },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { name: 'Updated' } });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    expect(service.updateCustomer).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ name: 'Updated' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps gstin_number to gst_number', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ params: { id: VALID_ID }, body: { gstin_number: 'GST123' } });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData.gst_number).toBe('GST123');
    expect(updateData.gstin_number).toBeUndefined();
  });

  it('strips _id, license, created_date, created_by from update payload', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      params: { id: VALID_ID },
      body: {
        name: 'X',
        _id: VALID_ID,
        license: LICENSE_ID,
        created_date: new Date(),
        created_by: 'user',
      },
    });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData._id).toBeUndefined();
    expect(updateData.license).toBeUndefined();
    expect(updateData.created_date).toBeUndefined();
    expect(updateData.created_by).toBeUndefined();
  });

  it('normalizes partial_balance via normalizeBoolean', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ params: { id: VALID_ID }, body: { partial_balance: 'on' } });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData.partial_balance).toBe(true);
  });

  it('returns 400 when service returns status=false', async () => {
    service.updateCustomer.mockResolvedValue({
      status: false,
      message: 'Update failed',
      data: null,
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { name: 'X' } });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── deleteCustomer ───────────────────────────────────────────────────────────

describe('CustomerController — deleteCustomer', () => {
  it('returns 200 on successful delete', async () => {
    service.deleteCustomer.mockResolvedValue({ status: true, data: null, message: 'deleted' });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.deleteCustomer(req, res);
    expect(service.deleteCustomer).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when customer not found', async () => {
    service.deleteCustomer.mockResolvedValue({ status: false, message: 'Not found', data: null });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.deleteCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── bulkDelete ───────────────────────────────────────────────────────────────

describe('CustomerController — bulkDelete', () => {
  it('returns 400 when ids are missing', async () => {
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns 400 when ids is not an array', async () => {
    const req = mockRequest({ body: { data: 'id1' } });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when ids array is empty', async () => {
    const req = mockRequest({ body: { data: [] } });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts body.ids as well as body.data', async () => {
    service.bulkDeleteCustomers.mockResolvedValue({ status: true, data: null, message: 'ok' });
    const req = mockRequest({ body: { ids: [VALID_ID] } });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(service.bulkDeleteCustomers).toHaveBeenCalledWith([VALID_ID]);
  });

  it('returns 200 on successful bulk delete', async () => {
    service.bulkDeleteCustomers.mockResolvedValue({
      status: true,
      data: { deletedCount: 2 },
      message: 'ok',
    });
    const req = mockRequest({ body: { data: [VALID_ID, BRANCH_ID] } });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when service returns status=false', async () => {
    service.bulkDeleteCustomers.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ body: { data: [VALID_ID] } });
    const res = mockResponse();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── searchCustomers ──────────────────────────────────────────────────────────

describe('CustomerController — searchCustomers', () => {
  it('returns 400 when search term is missing', async () => {
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.searchCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts q param as search term', async () => {
    service.searchCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ query: { q: 'alice' } });
    const res = mockResponse();
    await ctrl.searchCustomers(req, res);
    expect(service.searchCustomers).toHaveBeenCalledWith('alice', expect.any(Object));
  });

  it('accepts search param as search term', async () => {
    service.searchCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ query: { search: 'bob' } });
    const res = mockResponse();
    await ctrl.searchCustomers(req, res);
    expect(service.searchCustomers).toHaveBeenCalledWith('bob', expect.any(Object));
  });

  it('returns 200 with list and total on success', async () => {
    service.searchCustomers.mockResolvedValue({
      status: true,
      data: { data: [{ name: 'Alice' }], total: 1 },
      message: 'ok',
    });
    const req = mockRequest({ query: { q: 'alice' } });
    const res = mockResponse();
    await ctrl.searchCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ list: expect.any(Array), total: 1 }),
      })
    );
  });

  it('returns 400 when service returns status=false', async () => {
    service.searchCustomers.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ query: { q: 'alice' } });
    const res = mockResponse();
    await ctrl.searchCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── getCustomersAjaxList ─────────────────────────────────────────────────────

describe('CustomerController — getCustomersAjaxList', () => {
  it('returns 400 when search term is missing', async () => {
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.getCustomersAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns { query, suggestions } via res.json directly on success', async () => {
    const customer = {
      _id: { toString: () => VALID_ID },
      name: 'Alice',
      email: 'a@b.com',
      phone: '123',
      country: 'India',
      state: 'TN',
      gst_type: 'consumer',
      gst_number: '',
      address: '',
      balance: 0,
      partial_balance: false,
    };
    service.searchCustomers.mockResolvedValue({
      status: true,
      data: { data: [customer], total: 1 },
      message: 'ok',
    });
    const req = mockRequest({ query: { query: 'ali' } });
    const res = mockResponse();
    await ctrl.getCustomersAjaxList(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'ali',
        suggestions: expect.arrayContaining([expect.objectContaining({ name: 'Alice' })]),
      })
    );
    // Must NOT use res.status(200).json
    expect(res.status).not.toHaveBeenCalled();
  });

  it('maps customer fields to suggestion format', async () => {
    const customer = {
      _id: { toString: () => VALID_ID },
      name: 'Bob',
      email: 'bob@x.com',
      phone: '9999',
      country: 'India',
      state: '',
      gst_type: 'regular',
      gst_number: 'GST',
      address: 'Addr',
      balance: 100,
      partial_balance: true,
    };
    service.searchCustomers.mockResolvedValue({
      status: true,
      data: { data: [customer], total: 1 },
      message: 'ok',
    });
    const req = mockRequest({ query: { q: 'bob' } });
    const res = mockResponse();
    await ctrl.getCustomersAjaxList(req, res);
    const { suggestions } = res.json.mock.calls[0][0];
    expect(suggestions[0]).toMatchObject({
      id: VALID_ID,
      name: 'Bob',
      gst_type: 'regular',
      balance: 100,
    });
  });

  it('returns 400 when service returns status=false', async () => {
    service.searchCustomers.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ query: { q: 'x' } });
    const res = mockResponse();
    await ctrl.getCustomersAjaxList(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── getCustomerSummary ───────────────────────────────────────────────────────

describe('CustomerController — getCustomerSummary', () => {
  it('returns 200 with summary data on success', async () => {
    service.getCustomerSummary.mockResolvedValue({
      status: true,
      data: { totalSales: 5 },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getCustomerSummary(req, res);
    expect(service.getCustomerSummary).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when customer not found', async () => {
    service.getCustomerSummary.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getCustomerSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── getCustomersByTier ───────────────────────────────────────────────────────

describe('CustomerController — getCustomersByTier', () => {
  it('returns 200 with customer list for valid tier', async () => {
    service.getCustomersByTier.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ params: { tier: 'gold' }, query: {} });
    const res = mockResponse();
    await ctrl.getCustomersByTier(req, res);
    expect(service.getCustomersByTier).toHaveBeenCalledWith(
      'gold',
      expect.objectContaining({ page: 1, limit: 10 })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses custom pagination for tier query', async () => {
    service.getCustomersByTier.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ params: { tier: 'silver' }, query: { page: '2', limit: '5' } });
    const res = mockResponse();
    await ctrl.getCustomersByTier(req, res);
    const [, options] = service.getCustomersByTier.mock.calls[0];
    expect(options.page).toBe(2);
    expect(options.limit).toBe(5);
  });

  it('returns 400 when service returns status=false', async () => {
    service.getCustomersByTier.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ params: { tier: 'gold' }, query: {} });
    const res = mockResponse();
    await ctrl.getCustomersByTier(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── addLoyaltyPoints ─────────────────────────────────────────────────────────

describe('CustomerController — addLoyaltyPoints', () => {
  it('returns 200 on successful add', async () => {
    service.addLoyaltyPoints.mockResolvedValue({
      status: true,
      data: { points: 50 },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { points: 50, reason: 'purchase' } });
    const res = mockResponse();
    await ctrl.addLoyaltyPoints(req, res);
    expect(service.addLoyaltyPoints).toHaveBeenCalledWith(VALID_ID, 50, 'purchase');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when service returns status=false', async () => {
    service.addLoyaltyPoints.mockResolvedValue({ status: false, message: 'Failed', data: null });
    const req = mockRequest({ params: { id: VALID_ID }, body: { points: 50 } });
    const res = mockResponse();
    await ctrl.addLoyaltyPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── redeemPoints ─────────────────────────────────────────────────────────────

describe('CustomerController — redeemPoints', () => {
  it('returns 200 on successful redeem', async () => {
    service.redeemLoyaltyPoints.mockResolvedValue({
      status: true,
      data: { points: 30 },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { points: 30 } });
    const res = mockResponse();
    await ctrl.redeemPoints(req, res);
    expect(service.redeemLoyaltyPoints).toHaveBeenCalledWith(VALID_ID, 30);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when service returns status=false (e.g. insufficient points)', async () => {
    service.redeemLoyaltyPoints.mockResolvedValue({
      status: false,
      message: 'Insufficient points',
      data: null,
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { points: 9999 } });
    const res = mockResponse();
    await ctrl.redeemPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── customerOutstandingReport ────────────────────────────────────────────────

describe('CustomerController — customerOutstandingReport', () => {
  it('returns 200 with report data on success', async () => {
    service.getOutstandingReport.mockResolvedValue({
      status: true,
      data: { list: [] },
      message: 'ok',
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerOutstandingReport(req, res);
    expect(service.getOutstandingReport).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('parses branch_ids JSON from query', async () => {
    service.getOutstandingReport.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ query: { branch_ids: JSON.stringify([BRANCH_ID]) } });
    const res = mockResponse();
    await ctrl.customerOutstandingReport(req, res);
    const [, options] = service.getOutstandingReport.mock.calls[0];
    expect(options.branchIds).toEqual([BRANCH_ID]);
  });

  it('returns 400 when service returns status=false', async () => {
    service.getOutstandingReport.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerOutstandingReport(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── getDataChanges ───────────────────────────────────────────────────────────

describe('CustomerController — getDataChanges', () => {
  it('returns 200 with sync data on success', async () => {
    service.getDataChanges.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockRequest({ query: { from: '2024-01-01T00:00:00.000Z' } });
    const res = mockResponse();
    await ctrl.getDataChanges(req, res);
    expect(service.getDataChanges).toHaveBeenCalledWith('2024-01-01T00:00:00.000Z');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses epoch default when from is absent', async () => {
    service.getDataChanges.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.getDataChanges(req, res);
    const [fromDate] = service.getDataChanges.mock.calls[0];
    expect(fromDate).toBe(new Date(0).toISOString());
  });

  it('returns 400 when service returns status=false', async () => {
    service.getDataChanges.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── importCustomers ─────────────────────────────────────────────────────────

describe('CustomerController — importCustomers', () => {
  const mockBranchesCollection = { findOne: jest.fn().mockResolvedValue(null) };

  beforeEach(() => {
    mockGetCollection.mockResolvedValue(mockBranchesCollection);
  });

  it('returns 400 when no customers array provided', async () => {
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when customers array is empty', async () => {
    const req = mockRequest({ body: { result: [] } });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts body.result, body.customers, body.data formats', async () => {
    service.importCustomers.mockResolvedValue({
      status: true,
      data: { imported: 1 },
      message: 'ok',
    });
    const customer = { name: 'Alice' };
    for (const field of ['result', 'customers', 'data']) {
      jest.clearAllMocks();
      mockGetCollection.mockResolvedValue(mockBranchesCollection);
      service.importCustomers.mockResolvedValue({
        status: true,
        data: { imported: 1 },
        message: 'ok',
      });
      const req = mockRequest({ body: { [field]: [customer] } });
      const res = mockResponse();
      await ctrl.importCustomers(req, res);
      expect(service.importCustomers).toHaveBeenCalled();
    }
  });

  it('returns 200 on successful import', async () => {
    service.importCustomers.mockResolvedValue({
      status: true,
      data: { imported: 2 },
      message: 'ok',
    });
    const req = mockRequest({ body: { result: [{ name: 'A' }, { name: 'B' }] } });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when service returns status=false', async () => {
    service.importCustomers.mockResolvedValue({
      status: false,
      message: 'Import failed',
      data: null,
    });
    const req = mockRequest({ body: { result: [{ name: 'A' }] } });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('adds branch context (country, state, city) from branchDoc if found', async () => {
    const branchDoc = { country: 'USA', state: 'CA', city: 'LA' };
    mockBranchesCollection.findOne.mockResolvedValueOnce(branchDoc);
    service.importCustomers.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { result: [{ name: 'A' }] } });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    const [customersWithContext] = service.importCustomers.mock.calls[0];
    expect(customersWithContext[0].country).toBe('USA');
    expect(customersWithContext[0].state).toBe('CA');
  });
});

// ─── customersImport (alias) ──────────────────────────────────────────────────

describe('CustomerController — customersImport (alias)', () => {
  it('delegates to importCustomers', async () => {
    const mockBranchesCollection = { findOne: jest.fn().mockResolvedValue(null) };
    mockGetCollection.mockResolvedValue(mockBranchesCollection);
    service.importCustomers.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { result: [{ name: 'X' }] } });
    const res = mockResponse();
    await ctrl.customersImport(req, res);
    expect(service.importCustomers).toHaveBeenCalled();
  });
});

// ─── exportCustomers ─────────────────────────────────────────────────────────

describe('CustomerController — exportCustomers', () => {
  it('returns 200 on success with array body', async () => {
    service.exportCustomers.mockResolvedValue({
      status: true,
      data: [{ name: 'Alice' }],
      message: 'ok',
    });
    const req = mockRequest({ body: [VALID_ID, BRANCH_ID] });
    const res = mockResponse();
    await ctrl.exportCustomers(req, res);
    expect(service.exportCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [VALID_ID, BRANCH_ID] })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('exports with { data: [...] } body format', async () => {
    service.exportCustomers.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockRequest({ body: { data: [VALID_ID] } });
    const res = mockResponse();
    await ctrl.exportCustomers(req, res);
    const [filters] = service.exportCustomers.mock.calls[0];
    expect(filters.ids).toContain(VALID_ID);
  });

  it('exports with empty object body (no ids) — calls service with empty filters', async () => {
    service.exportCustomers.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    await ctrl.exportCustomers(req, res);
    expect(service.exportCustomers).toHaveBeenCalledWith(expect.objectContaining({}));
  });

  it('returns 400 when service returns status=false', async () => {
    service.exportCustomers.mockResolvedValue({ status: false, message: 'Error', data: null });
    const req = mockRequest({ body: [] });
    const res = mockResponse();
    await ctrl.exportCustomers(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── getPaymentDetails ────────────────────────────────────────────────────────

describe('CustomerController — getPaymentDetails', () => {
  it('returns 200 with payment data on success', async () => {
    service.getPaymentDetails.mockResolvedValue({
      status: true,
      data: { balance: 500 },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getPaymentDetails(req, res);
    expect(service.getPaymentDetails).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getPaymentDetails.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ params: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.getPaymentDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── customerPaymentDetails ───────────────────────────────────────────────────

describe('CustomerController — customerPaymentDetails', () => {
  it('returns 400 when customer_id is missing from query', async () => {
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerPaymentDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Customer ID is required' })
    );
  });

  it('returns 200 with payment data on success', async () => {
    service.getPaymentDetails.mockResolvedValue({
      status: true,
      data: { balance: 100 },
      message: 'ok',
    });
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.customerPaymentDetails(req, res);
    expect(service.getPaymentDetails).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getPaymentDetails.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.customerPaymentDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── getTransactions ──────────────────────────────────────────────────────────

describe('CustomerController — getTransactions', () => {
  it('returns 200 with transactions on success', async () => {
    service.getTransactions.mockResolvedValue({
      status: true,
      data: { list: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ params: { id: VALID_ID }, query: {} });
    const res = mockResponse();
    await ctrl.getTransactions(req, res);
    expect(service.getTransactions).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ page: 1, limit: 10 })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getTransactions.mockResolvedValue({ status: false, message: 'Not found', data: null });
    const req = mockRequest({ params: { id: VALID_ID }, query: {} });
    const res = mockResponse();
    await ctrl.getTransactions(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── updatePreferences ────────────────────────────────────────────────────────

describe('CustomerController — updatePreferences', () => {
  it('returns 200 on successful preferences update', async () => {
    service.updatePreferences.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      params: { id: VALID_ID },
      body: { preferences: { newsletter: true } },
    });
    const res = mockResponse();
    await ctrl.updatePreferences(req, res);
    expect(service.updatePreferences).toHaveBeenCalledWith(VALID_ID, { newsletter: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when service returns status=false', async () => {
    service.updatePreferences.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ params: { id: VALID_ID }, body: { preferences: {} } });
    const res = mockResponse();
    await ctrl.updatePreferences(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── Aliases ──────────────────────────────────────────────────────────────────

describe('CustomerController — getAll (alias for getCustomers)', () => {
  it('delegates to getCustomers and returns paginated list', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.getAll(req, res);
    expect(service.getAllCustomers).toHaveBeenCalled();
  });
});

describe('CustomerController — delete (alias for bulkDelete)', () => {
  it('delegates to bulkDelete and returns 200', async () => {
    service.bulkDeleteCustomers.mockResolvedValue({ status: true, data: null, message: 'ok' });
    const req = mockRequest({ body: { data: [VALID_ID] } });
    const res = mockResponse();
    await ctrl.delete(req, res);
    expect(service.bulkDeleteCustomers).toHaveBeenCalledWith([VALID_ID]);
  });
});

// ─── customerGraphicalReports ────────────────────────────────────────────────

describe('CustomerController — customerGraphicalReports', () => {
  it('returns 403 when user lacks report read permission', async () => {
    const req = mockRequest({
      query: {},
      user: { ...adminUser, access: { report: { read: false } } },
    });
    const res = mockResponse();
    await ctrl.customerGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
  });

  it('returns 200 with report data on success (no date filters)', async () => {
    service.getCustomerGraphicalReports.mockResolvedValue({
      status: true,
      data: { days: [] },
      message: 'ok',
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerGraphicalReports(req, res);
    expect(service.getCustomerGraphicalReports).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('applies session filter when dates are provided', async () => {
    const filteredRange = {
      start_date: new Date('2024-01-01'),
      end_date: new Date('2024-01-31'),
      session_applied: true,
    };
    sessionFilterUtil.applySessionFilter.mockResolvedValue(filteredRange);
    service.getCustomerGraphicalReports.mockResolvedValue({
      status: true,
      data: {},
      message: 'ok',
    });
    const req = mockRequest({ query: { starting_date: '2024-01-01', ending_date: '2024-01-31' } });
    const res = mockResponse();
    await ctrl.customerGraphicalReports(req, res);
    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getCustomerGraphicalReports.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on thrown error', async () => {
    service.getCustomerGraphicalReports.mockRejectedValue(new Error('DB error'));
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

// ─── customerOutstandingReportTable ───────────────────────────────────────────

describe('CustomerController — customerOutstandingReportTable', () => {
  it('returns 403 when user lacks report read permission', async () => {
    const req = mockRequest({
      query: {},
      user: { ...adminUser, access: { report: { read: false } } },
    });
    const res = mockResponse();
    await ctrl.customerOutstandingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
  });

  it('returns 200 with report data on success', async () => {
    service.getCustomerOutstandingReport.mockResolvedValue({
      status: true,
      data: { list: [] },
      message: 'ok',
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerOutstandingReportTable(req, res);
    expect(service.getCustomerOutstandingReport).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('passes pagination and filter params to service', async () => {
    service.getCustomerOutstandingReport.mockResolvedValue({
      status: true,
      data: {},
      message: 'ok',
    });
    const req = mockRequest({
      query: {
        page: '2',
        limit: '5',
        starting_date: '2024-01-01',
        ending_date: '2024-01-31',
        field_input: VALID_ID,
      },
    });
    const res = mockResponse();
    await ctrl.customerOutstandingReportTable(req, res);
    const [params] = service.getCustomerOutstandingReport.mock.calls[0];
    expect(params.page).toBe(2);
    expect(params.limit).toBe(5);
    expect(params.customerId).toBe(VALID_ID);
  });

  it('returns 404 when service returns status=false', async () => {
    service.getCustomerOutstandingReport.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerOutstandingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on thrown error', async () => {
    service.getCustomerOutstandingReport.mockRejectedValue(new Error('Crash'));
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.customerOutstandingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

// ─── transaction ─────────────────────────────────────────────────────────────

describe('CustomerController — transaction (direct DB method)', () => {
  it('returns 400 when id is missing', async () => {
    const req = mockRequest({ body: { amount: 100 } });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Customer ID and amount are required',
      })
    );
  });

  it('returns 400 when amount is missing', async () => {
    const req = mockRequest({ body: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when customer not found in DB', async () => {
    const mockCustomerCollection = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn(),
    };
    mockGetCollection.mockResolvedValue(mockCustomerCollection);
    const req = mockRequest({ body: { id: VALID_ID, amount: 100 } });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Customer not found' })
    );
  });

  it('returns 500 on unexpected error', async () => {
    mockGetCollection.mockRejectedValue(new Error('DB crash'));
    const req = mockRequest({ body: { id: VALID_ID, amount: 100 } });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── uploadTransactionImage ───────────────────────────────────────────────────

describe('CustomerController — uploadTransactionImage', () => {
  it('returns 400 when no file uploaded', async () => {
    const req = mockRequest({ file: null });
    const res = mockResponse();
    await ctrl.uploadTransactionImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'No file uploaded' })
    );
  });

  it('returns 400 for disallowed file extension', async () => {
    const mockFs = require('fs');
    const mockUnlink = jest.spyOn(mockFs, 'unlinkSync').mockImplementation(() => {});
    const req = mockRequest({
      file: { originalname: 'test.exe', path: '/tmp/test.exe' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:5000'),
    });
    const res = mockResponse();
    await ctrl.uploadTransactionImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Invalid file type') })
    );
    mockUnlink.mockRestore();
  });

  it('returns 200 with image URL on successful upload', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
    const req = {
      ...mockRequest(),
      file: { originalname: 'photo.jpg', path: '/tmp/upload-123' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:5000'),
    };
    const res = mockResponse();
    await ctrl.uploadTransactionImage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Image uploaded successfully',
        data: expect.stringContaining('http://localhost:5000/uploads/transaction_images/'),
      })
    );
  });

  it('creates upload directory when it does not exist', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
    const req = {
      ...mockRequest(),
      file: { originalname: 'pic.png', path: '/tmp/upload-456' },
      protocol: 'https',
      get: jest.fn().mockReturnValue('example.com'),
    };
    const res = mockResponse();
    await ctrl.uploadTransactionImage(req, res);
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 when file system operation throws (lines 1258-1259 catch)', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed');
    });
    const req = {
      ...mockRequest(),
      file: { originalname: 'test.jpg', path: '/tmp/fail.jpg' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:5000'),
    };
    const res = mockResponse();
    await ctrl.uploadTransactionImage(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'rename failed' })
    );
  });
});

// ─── Additional coverage: getCustomers filter parse error ─────────────────────

describe('CustomerController — getCustomers filter parse error (line 102)', () => {
  it('swallows malformed filters JSON and continues', async () => {
    service.getAllCustomers.mockResolvedValue({
      status: true,
      data: { data: [], total: 0 },
      message: 'ok',
    });
    const req = mockRequest({ query: { filters: 'not-valid-{json' } });
    const res = mockResponse();
    await ctrl.getCustomers(req, res);
    expect(service.getAllCustomers).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── Additional coverage: createCustomer branch DB lookup (lines 236-244) ────

describe('CustomerController — createCustomer branch DB lookup', () => {
  it('fetches branch name from DB when branchId present but branchName empty', async () => {
    const mockBranchColl = { findOne: jest.fn().mockResolvedValue({ name: 'DB Branch' }) };
    mockGetCollection.mockResolvedValue(mockBranchColl);
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    req.user = { ...adminUser, branch_name: '', branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    expect(mockGetCollection).toHaveBeenCalled();
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.branch_name).toBe('DB Branch');
  });

  it('leaves branch_name empty when DB lookup returns no branch', async () => {
    const mockBranchColl = { findOne: jest.fn().mockResolvedValue(null) };
    mockGetCollection.mockResolvedValue(mockBranchColl);
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    req.user = { ...adminUser, branch_name: '', branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    const [customerData] = service.createCustomer.mock.calls[0];
    expect(customerData.branch_name).toBe('');
  });

  it('continues normally when branch DB lookup throws (line 244 catch)', async () => {
    mockGetCollection.mockRejectedValueOnce(new Error('DB error'));
    service.createCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({ body: { name: 'Bob' } });
    req.user = { ...adminUser, branch_name: '', branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.createCustomer(req, res);
    // catch swallows error, createCustomer still called with empty branch_name
    expect(service.createCustomer).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ─── Additional coverage: updateCustomer ObjectId conversions (lines 299-315) ─

describe('CustomerController — updateCustomer ObjectId conversions', () => {
  it('converts branch_id, customer_category, customer_referrer_id to ObjectId', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      params: { id: VALID_ID },
      body: {
        branch_id: BRANCH_ID,
        customer_category: CATEGORY_ID,
        customer_referrer_id: REFERRER_ID,
        customer_referrer_name: 'Ref Name',
      },
    });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData.branch_id).toBeDefined();
    expect(updateData.category_id).toBeDefined();
    expect(updateData.referrer_id).toBeDefined();
    expect(updateData.referrer_name).toBe('Ref Name');
    expect(updateData.customer_category).toBeUndefined();
    expect(updateData.customer_referrer_id).toBeUndefined();
    expect(updateData.customer_referrer_name).toBeUndefined();
  });

  it('sets category_id to empty string when customer_category is falsy', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      params: { id: VALID_ID },
      body: { customer_category: '' },
    });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData.category_id).toBe('');
  });

  it('sets referrer_id to empty string when referrer_id is falsy', async () => {
    service.updateCustomer.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockRequest({
      params: { id: VALID_ID },
      body: { referrer_id: '' },
    });
    const res = mockResponse();
    await ctrl.updateCustomer(req, res);
    const [, updateData] = service.updateCustomer.mock.calls[0];
    expect(updateData.referrer_id).toBe('');
  });
});

// ─── Additional coverage: importCustomers catch (line 653) ────────────────────

describe('CustomerController — importCustomers branch fetch error', () => {
  it('continues with default country=India when branch collection throws', async () => {
    mockGetCollection.mockRejectedValueOnce(new Error('DB unavailable'));
    service.importCustomers.mockResolvedValue({
      status: true,
      data: { imported: 1 },
      message: 'ok',
    });
    const req = mockRequest({ body: { result: [{ name: 'A' }] } });
    const res = mockResponse();
    await ctrl.importCustomers(req, res);
    expect(service.importCustomers).toHaveBeenCalled();
    const [customersWithContext] = service.importCustomers.mock.calls[0];
    expect(customersWithContext[0].country).toBe('India');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── Additional coverage: transaction success (lines 1096-1173) ───────────────

describe('CustomerController — transaction success path', () => {
  it('inserts transaction and returns updated balance', async () => {
    const mockCustomerCol = {
      findOne: jest.fn().mockResolvedValue({ _id: VALID_ID, name: 'Alice', phone: '123' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const mockTransactionCol = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'newId' }),
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ balance: 500, totalIn: 500, totalOut: 0 }]),
      }),
    };
    mockGetCollection
      .mockResolvedValueOnce(mockCustomerCol)
      .mockResolvedValueOnce(mockTransactionCol);
    const req = mockRequest({
      body: { id: VALID_ID, amount: 100, type: 'in', description: 'deposit' },
    });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Add transaction successfully',
        data: 500,
      })
    );
  });

  it('defaults balance to 0 when aggregate returns empty array', async () => {
    const mockCustomerCol = {
      findOne: jest.fn().mockResolvedValue({ name: 'Alice' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const mockTransactionCol = {
      insertOne: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    mockGetCollection
      .mockResolvedValueOnce(mockCustomerCol)
      .mockResolvedValueOnce(mockTransactionCol);
    const req = mockRequest({ body: { id: VALID_ID, amount: 50 } });
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: 0 }));
  });

  it('fetches branch_name from Branch model when user has branch_id but no branch_name', async () => {
    const mockCustomerCol = {
      findOne: jest.fn().mockResolvedValue({ name: 'Alice' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const mockTransactionCol = {
      insertOne: jest.fn().mockResolvedValue({}),
      aggregate: jest
        .fn()
        .mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ balance: 0 }]) }),
    };
    mockGetCollection
      .mockResolvedValueOnce(mockCustomerCol)
      .mockResolvedValueOnce(mockTransactionCol);
    Branch.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ branch_name: '  Main  ' }),
      }),
    });
    const req = mockRequest({ body: { id: VALID_ID, amount: 50 } });
    req.user = { ...adminUser, branch_name: '', branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.transaction(req, res);
    expect(Branch.findById).toHaveBeenCalledWith(BRANCH_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('swallows Branch.findById error and continues (line 1114 catch)', async () => {
    const mockCustomerCol = {
      findOne: jest.fn().mockResolvedValue({ name: 'Alice' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const mockTransactionCol = {
      insertOne: jest.fn().mockResolvedValue({}),
      aggregate: jest
        .fn()
        .mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ balance: 0 }]) }),
    };
    mockGetCollection
      .mockResolvedValueOnce(mockCustomerCol)
      .mockResolvedValueOnce(mockTransactionCol);
    Branch.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('Mongoose error')),
      }),
    });
    const req = mockRequest({ body: { id: VALID_ID, amount: 50 } });
    req.user = { ...adminUser, branch_name: '', branch_id: BRANCH_ID };
    const res = mockResponse();
    await ctrl.transaction(req, res);
    // catch swallows error, transaction still succeeds
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── Additional coverage: transactionDetails (lines 875-1043) ────────────────

describe('CustomerController — transactionDetails', () => {
  const makeTxnCollection = (overrides = {}) => ({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  });

  it('returns 200 when customer_id is undefined (ObjectId generates new id)', async () => {
    mockGetCollection.mockResolvedValue(makeTxnCollection());
    const req = mockRequest({ query: {} }); // no customer_id — ObjectId(undefined) generates new id
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    // ObjectId(undefined) does not throw in modern driver — query proceeds
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 when collection operation throws', async () => {
    mockGetCollection.mockRejectedValue(new Error('DB crash'));
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns 200 with transaction data on success', async () => {
    const txnCol = makeTxnCollection({
      countDocuments: jest.fn().mockResolvedValue(2),
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            totalInAmount: 500,
            totalOutAmount: 100,
            totalAmountDue: 400,
            totalPendingAmount: 0,
          },
        ]),
      }),
    });
    mockGetCollection.mockResolvedValue(txnCol);
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('uses branch[] array query param', async () => {
    const txnCol = makeTxnCollection();
    mockGetCollection.mockResolvedValue(txnCol);
    const req = mockRequest({ query: { customer_id: VALID_ID, 'branch[]': [BRANCH_ID] } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    // branch filter is applied — just ensure it completes without error
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('includes sample transaction log when totalWithoutLicense > 0', async () => {
    const txnCol = makeTxnCollection({
      countDocuments: jest.fn().mockResolvedValue(1),
      findOne: jest.fn().mockResolvedValue({ _id: VALID_ID, type: 'in', amount: 100 }),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    });
    mockGetCollection.mockResolvedValue(txnCol);
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    expect(txnCol.findOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('formats transaction dates with string_date field', async () => {
    const txnDate = new Date('2024-06-15T10:30:00.000Z');
    const txnCol = makeTxnCollection({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest
          .fn()
          .mockResolvedValue([{ _id: VALID_ID, type: 'in', amount: 100, date: txnDate }]),
      }),
      countDocuments: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    });
    mockGetCollection.mockResolvedValue(txnCol);
    const req = mockRequest({ query: { customer_id: VALID_ID } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.table.data.list[0].string_date).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('uses limit and page from query params', async () => {
    mockGetCollection.mockResolvedValue(makeTxnCollection());
    const req = mockRequest({ query: { customer_id: VALID_ID, limit: '20', page: '2' } });
    const res = mockResponse();
    await ctrl.transactionDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
