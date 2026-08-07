'use strict';

/**
 * Unit tests for suppliers.controller.js
 *
 * Controller methods:
 *   setRequestContext, ensureContext, getAll, add, edit, getOne,
 *   getSupplierDetails, delete, getSuppliersAjaxList,
 *   supplierGraphicalReports, getDataChanges, suppliersImport,
 *   normalizeExportIds, exportSuppliers
 *
 * Mocked:
 *   express-async-handler  → identity (pass-through)
 *   supplier.service        → constructor mock → shared mockSvc
 *   base.model              → static property store + prototype.getCollection
 *   supplier-legacy.model   → constructor mock
 *   helpers/suppliers.helper → normalizeBoolean, sanitizeSupplierData
 *   express-validator        → validationResult
 *   mongodb                  → ObjectId
 */

// =============================================================================
// Shared mock instances
// =============================================================================

const mockSvc = {
  getAllSuppliers: jest.fn(),
  createSupplier: jest.fn(),
  updateSupplier: jest.fn(),
  getSupplierById: jest.fn(),
  bulkDeleteSuppliers: jest.fn(),
  searchSuppliers: jest.fn(),
  getDataChanges: jest.fn(),
  bulkImport: jest.fn(),
  exportSuppliers: jest.fn(),
};

const mockLegacyInstance = {
  getSupplierGraphicalReports: jest.fn(),
  licenseId: null,
  branchId: null,
  loggedUserId: null,
  loggedUserName: null,
};

// =============================================================================
// Mocks (hoisted)
// =============================================================================

jest.mock('express-async-handler', () => (fn) => fn);

jest.mock('../../../src/services/supplier.service', () =>
  jest.fn().mockImplementation(() => mockSvc)
);

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

const mockBranchesCollection = { findOne: jest.fn() };

const baseModelState = {};
jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
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
  }
  MockBaseModel.prototype.getCollection = jest.fn().mockResolvedValue(mockBranchesCollection);
  return MockBaseModel;
});

jest.mock('../../../src/models/supplier-legacy.model', () =>
  jest.fn().mockImplementation(() => mockLegacyInstance)
);

jest.mock('../../../src/helpers/suppliers.helper', () => ({
  normalizeBoolean: jest.fn((v) => Boolean(v)),
  sanitizeSupplierData: jest.fn((d) => d),
}));

jest.mock('express-validator', () => ({ validationResult: jest.fn() }));

jest.mock('mongodb', () => ({
  ObjectId: Object.assign(
    jest.fn((id) => ({ _bsontype: 'ObjectId', id, toString: () => String(id) })),
    { isValid: jest.fn(() => true) }
  ),
}));

// =============================================================================
// Imports (after mocks)
// =============================================================================

const { validationResult } = require('express-validator');
const ctrl = require('../../../src/controllers/suppliers.controller');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  DEFAULTS,
} = require('../../../src/constants/suppliers.constants');

// =============================================================================
// Helpers
// =============================================================================

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
};

const adminUser = {
  _id: 'user001',
  name: 'Admin User',
  username: 'admin',
  email: 'admin@test.com',
  license: 'lic001',
  branch_id: 'br001',
  branch_name: 'Main Branch',
  access: {
    supplier: { read: true, write: true, delete: true },
    report: { read: true },
  },
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

const noErrors = () => ({ isEmpty: () => true, array: () => [] });
const hasErrors = (msgs = ['Field required']) => ({
  isEmpty: () => false,
  array: () => msgs.map((m) => ({ msg: m })),
});

const sampleSupplier = {
  _id: 'sup001',
  name: 'ABC Traders',
  phone: '9876543210',
  email: 'abc@traders.com',
  branch_id: 'br001',
  branch_name: 'Main Branch',
};

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  Object.keys(baseModelState).forEach((k) => delete baseModelState[k]);
  validationResult.mockReturnValue(noErrors());
  mockBranchesCollection.findOne.mockResolvedValue(null);
});

// =============================================================================
// setRequestContext
// =============================================================================

describe('setRequestContext', () => {
  const callViaGetAll = async (req) => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    await ctrl.getAll(req, mockRes());
  };

  test('sets BaseModel.currentBranch from session.selectedBranchId (highest priority)', async () => {
    await callViaGetAll(mockReq({ session: { selectedBranchId: 'pri_br' } }));
    const v = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(v).toBe('pri_br');
  });

  test('falls back to session.branch_id', async () => {
    await callViaGetAll(
      mockReq({ session: { branch_id: 'ses_br' }, user: { ...adminUser, branch_id: undefined } })
    );
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('falls back to query.branch_id', async () => {
    await callViaGetAll(
      mockReq({
        query: { branch_id: 'q_br' },
        session: {},
        user: { ...adminUser, branch_id: undefined },
      })
    );
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('falls back to user.branch_id', async () => {
    await callViaGetAll(mockReq({ session: {}, user: { ...adminUser, branch_id: 'usr_br' } }));
    const v = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(v).toBe('usr_br');
  });

  test('falls back to user.branch_access[0].branch_id', async () => {
    await callViaGetAll(
      mockReq({
        session: {},
        user: { ...adminUser, branch_id: undefined, branch_access: [{ branch_id: 'acc_br' }] },
      })
    );
    expect(baseModelState.currentBranch).toBeDefined();
  });

  test('sets BaseModel.license from user.license', async () => {
    await callViaGetAll(mockReq());
    expect(baseModelState.license).toBeDefined();
  });

  test('sets BaseModel.license from user.license_id as fallback', async () => {
    await callViaGetAll(
      mockReq({ user: { ...adminUser, license: undefined, license_id: 'lid2' } })
    );
    expect(baseModelState.license).toBeDefined();
  });

  test('sets BaseModel.loggedUser from user._id', async () => {
    await callViaGetAll(mockReq());
    expect(baseModelState.loggedUser).toBeDefined();
  });

  test('sets BaseModel.loggedUserName from user.name', async () => {
    await callViaGetAll(mockReq());
    expect(baseModelState.loggedUserName).toBe('Admin User');
  });

  test('uses user.username as loggedUserName fallback', async () => {
    await callViaGetAll(mockReq({ user: { ...adminUser, name: undefined, username: 'admin' } }));
    expect(baseModelState.loggedUserName).toBe('admin');
  });

  test('uses user.email as loggedUserName final fallback', async () => {
    await callViaGetAll(
      mockReq({ user: { ...adminUser, name: undefined, username: undefined, email: 'x@y.com' } })
    );
    expect(baseModelState.loggedUserName).toBe('x@y.com');
  });

  test('sets BaseModel.currentBranchName from user.branch_name', async () => {
    await callViaGetAll(mockReq());
    expect(baseModelState.currentBranchName).toBe('Main Branch');
  });

  test('handles branchParam as array — picks first element', async () => {
    await callViaGetAll(mockReq({ session: { selectedBranchId: ['br_a', 'br_b'] } }));
    const v = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(v).toBe('br_a');
  });
});

// =============================================================================
// getAll
// =============================================================================

describe('getAll', () => {
  test('200 with formatted list on success', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(
      ok(
        {
          data: [sampleSupplier],
          total: 1,
          limit: 10,
          page: 1,
          totalPages: 1,
        },
        SUCCESS_MESSAGES.SUPPLIERS_RETRIEVED
      )
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.data.list).toHaveLength(1);
    expect(body.data.total).toBe(1);
    expect(body.data.per_page).toBe(10);
    expect(body.data.current_page).toBe(1);
    expect(body.data.total_pages).toBe(1);
  });

  test('401 when user has no read access', async () => {
    const req = mockReq({ user: { ...adminUser, access: { supplier: { read: false } } } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.getAllSuppliers).not.toHaveBeenCalled();
  });

  test('400 on validationResult errors', async () => {
    validationResult.mockReturnValue(hasErrors(['bad param']));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.getAllSuppliers).not.toHaveBeenCalled();
  });

  test('400 on invalid JSON filters', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters: '{bad json' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/filter/i);
    expect(mockSvc.getAllSuppliers).not.toHaveBeenCalled();
  });

  test('passes parsed filters + search + pagination to service', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    const req = mockReq({
      query: { filters: '{"status":"active"}', search: 'abc', page: '2', limit: '25' },
    });
    await ctrl.getAll(req, mockRes());
    const [filters, options] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(filters.status).toBe('active');
    expect(filters.search).toBe('abc');
    expect(options.page).toBe(2);
    expect(options.limit).toBe(25);
  });

  test('defaults page=1 and limit=10 when absent', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    await ctrl.getAll(mockReq({ query: {} }), mockRes());
    const [, opts] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(opts.page).toBe(1);
    expect(opts.limit).toBe(10);
  });

  test('defaults page=1 when page is 0 or negative', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    await ctrl.getAll(mockReq({ query: { page: '0' } }), mockRes());
    const [, opts] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(opts.page).toBe(1);
  });

  test('defaults page=1 when page is non-numeric', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    await ctrl.getAll(mockReq({ query: { page: 'abc' } }), mockRes());
    const [, opts] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(opts.page).toBe(1);
  });

  test('uses req.query.q as search fallback when search absent', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    const req = mockReq({ query: { q: 'mango' } });
    await ctrl.getAll(req, mockRes());
    const [filters] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(filters.search).toBe('mango');
  });

  test('adds branch_id filter from request context', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    const req = mockReq({ session: { selectedBranchId: 'test_br' } });
    await ctrl.getAll(req, mockRes());
    const [filters] = mockSvc.getAllSuppliers.mock.calls[0];
    expect(filters.branch_id).toBeDefined();
  });

  test('400 when service returns status:false', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(err('Fetch failed'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ type: 'error', message: 'Fetch failed' });
  });

  test('handles empty supplier list', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(
      ok({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.list).toEqual([]);
    expect(res.json.mock.calls[0][0].data.total).toBe(0);
  });

  test('500 when service throws', async () => {
    mockSvc.getAllSuppliers.mockRejectedValue(new Error('DB crash'));
    await expect(ctrl.getAll(mockReq(), mockRes())).rejects.toThrow('DB crash');
  });
});

// =============================================================================
// add
// =============================================================================

describe('add', () => {
  const validBody = {
    name: 'XYZ Suppliers',
    email: 'xyz@supply.com',
    phone: '9876543210',
    address: '123 Main St',
    city: 'Mumbai',
    state: 'Maharashtra',
    gst_type: 'regular',
    gstin_number: '27AAPFU0939F1ZV',
  };

  test('200 on successful creation', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier, SUCCESS_MESSAGES.SUPPLIER_CREATED));
    const res = mockRes();
    await ctrl.add(mockReq({ body: validBody }), res);
    expect(mockSvc.createSupplier).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('401 when user has no write access', async () => {
    const req = mockReq({
      body: validBody,
      user: { ...adminUser, access: { supplier: { write: false } } },
    });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.createSupplier).not.toHaveBeenCalled();
  });

  test('400 on validationResult errors', async () => {
    validationResult.mockReturnValue(hasErrors(['name is required']));
    const res = mockRes();
    await ctrl.add(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.createSupplier).not.toHaveBeenCalled();
  });

  test('auto-enables GST when gst_type is non-consumer', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { ...validBody, gst_type: 'regular' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.gst).toBe('enable');
  });

  test('auto-enables GST when gstin_number is provided', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { name: 'A', gstin_number: '27AAPFU0939F1ZV' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.gst).toBe('enable');
    expect(data.gst_number).toBe('27AAPFU0939F1ZV');
  });

  test('keeps GST disabled when gst_type is consumer and no gst_number', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { name: 'A', gst_type: 'consumer' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.gst).toBe(DEFAULTS.GST);
  });

  test('applies DEFAULTS for optional fields when absent', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { name: 'MinSupplier' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.country).toBe(DEFAULTS.COUNTRY);
    expect(data.balance).toBe(DEFAULTS.BALANCE);
    expect(data.credit_limit).toBe(DEFAULTS.CREDIT_LIMIT);
    expect(data.payment_terms).toBe(DEFAULTS.PAYMENT_TERMS);
  });

  test('sets created_by from user.username', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { name: 'A' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.created_by).toBe('admin');
  });

  test('sets created_by from user.email when username absent', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ body: { name: 'A' }, user: { ...adminUser, username: undefined } });
    await ctrl.add(req, mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.created_by).toBe('admin@test.com');
  });

  test('attaches branch_id ObjectId when branchId available', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.add(mockReq({ body: { name: 'A' } }), mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.branch_id).toBeDefined();
  });

  test('fetches branch name from DB when user.branch_name is empty', async () => {
    mockBranchesCollection.findOne.mockResolvedValue({ branch_name: 'DB Branch' });
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ body: { name: 'A' }, user: { ...adminUser, branch_name: '' } });
    await ctrl.add(req, mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(data.branch_name).toBe('DB Branch');
  });

  test('continues silently when branch DB fetch fails', async () => {
    mockBranchesCollection.findOne.mockRejectedValue(new Error('DB error'));
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ body: { name: 'A' }, user: { ...adminUser, branch_name: '' } });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when service returns status:false', async () => {
    mockSvc.createSupplier.mockResolvedValue(err('Duplicate supplier'));
    const res = mockRes();
    await ctrl.add(mockReq({ body: { name: 'A' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: 'Duplicate supplier',
    });
  });

  test('500 when service throws', async () => {
    mockSvc.createSupplier.mockRejectedValue(new Error('crash'));
    await expect(ctrl.add(mockReq({ body: { name: 'A' } }), mockRes())).rejects.toThrow('crash');
  });
});

// =============================================================================
// edit
// =============================================================================

describe('edit', () => {
  const updateBody = { name: 'Updated Name', phone: '9998887776' };

  test('200 on successful update', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier, SUCCESS_MESSAGES.SUPPLIER_UPDATED));
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'sup001' }, body: updateBody }), res);
    expect(mockSvc.updateSupplier).toHaveBeenCalledWith(
      'sup001',
      expect.objectContaining({ name: 'Updated Name' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when id is missing from params and query', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: {}, query: {}, body: updateBody }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/required/i);
    expect(mockSvc.updateSupplier).not.toHaveBeenCalled();
  });

  test('uses req.query.id when params.id absent', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.edit(mockReq({ params: {}, query: { id: 'q_sup' }, body: updateBody }), mockRes());
    expect(mockSvc.updateSupplier).toHaveBeenCalledWith('q_sup', expect.any(Object));
  });

  test('401 when user has no write access', async () => {
    const req = mockReq({
      params: { id: 'sup001' },
      body: updateBody,
      user: { ...adminUser, access: { supplier: { write: false } } },
    });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.updateSupplier).not.toHaveBeenCalled();
  });

  test('400 on validationResult errors', async () => {
    validationResult.mockReturnValue(hasErrors(['invalid field']));
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'sup001' }, body: updateBody }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.updateSupplier).not.toHaveBeenCalled();
  });

  test('maps gstin_number to gst_number and removes gstin_number', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ params: { id: 'sup001' }, body: { gstin_number: '27AAPFU0939F1ZV' } });
    await ctrl.edit(req, mockRes());
    const [, data] = mockSvc.updateSupplier.mock.calls[0];
    expect(data.gst_number).toBe('27AAPFU0939F1ZV');
    expect(data.gstin_number).toBeUndefined();
  });

  test('auto-enables GST when gst_type is non-consumer on update', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ params: { id: 'sup001' }, body: { gst_type: 'regular' } });
    await ctrl.edit(req, mockRes());
    const [, data] = mockSvc.updateSupplier.mock.calls[0];
    expect(data.gst).toBe('enable');
  });

  test('does NOT auto-enable GST when gst_type is consumer', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({ params: { id: 'sup001' }, body: { gst_type: 'consumer' } });
    await ctrl.edit(req, mockRes());
    const [, data] = mockSvc.updateSupplier.mock.calls[0];
    expect(data.gst).toBeUndefined();
  });

  test('sets updated_by from user.name', async () => {
    mockSvc.updateSupplier.mockResolvedValue(ok(sampleSupplier));
    await ctrl.edit(mockReq({ params: { id: 'sup001' }, body: updateBody }), mockRes());
    const [, data] = mockSvc.updateSupplier.mock.calls[0];
    expect(data.updated_by).toBe('Admin User');
    expect(data.updated_by_id).toBe('user001');
  });

  test('400 when service returns status:false', async () => {
    mockSvc.updateSupplier.mockResolvedValue(err('Supplier not found'));
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'sup001' }, body: updateBody }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 when service throws', async () => {
    mockSvc.updateSupplier.mockRejectedValue(new Error('crash'));
    await expect(
      ctrl.edit(mockReq({ params: { id: 'sup001' }, body: updateBody }), mockRes())
    ).rejects.toThrow('crash');
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('getOne', () => {
  test('200 with supplier data on success', async () => {
    mockSvc.getSupplierById.mockResolvedValue(
      ok(sampleSupplier, SUCCESS_MESSAGES.SUPPLIER_RETRIEVED)
    );
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'sup001' } }), res);
    expect(mockSvc.getSupplierById).toHaveBeenCalledWith('sup001');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('400 when id is missing', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.getSupplierById).not.toHaveBeenCalled();
  });

  test('uses query.id as fallback', async () => {
    mockSvc.getSupplierById.mockResolvedValue(ok(sampleSupplier));
    await ctrl.getOne(mockReq({ params: {}, query: { id: 'q_sup' } }), mockRes());
    expect(mockSvc.getSupplierById).toHaveBeenCalledWith('q_sup');
  });

  test('401 when user has no read access', async () => {
    const req = mockReq({
      params: { id: 'sup001' },
      user: { ...adminUser, access: { supplier: { read: false } } },
    });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.getSupplierById).not.toHaveBeenCalled();
  });

  test('404 when service returns status:false', async () => {
    mockSvc.getSupplierById.mockResolvedValue(err(ERROR_MESSAGES.SUPPLIER_NOT_FOUND));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'bad_id' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'error',
      message: ERROR_MESSAGES.SUPPLIER_NOT_FOUND,
    });
  });

  test('500 when service throws', async () => {
    mockSvc.getSupplierById.mockRejectedValue(new Error('crash'));
    await expect(ctrl.getOne(mockReq({ params: { id: 'sup001' } }), mockRes())).rejects.toThrow(
      'crash'
    );
  });
});

// =============================================================================
// getSupplierDetails (legacy — no access check)
// =============================================================================

describe('getSupplierDetails', () => {
  test('200 with supplier data on success', async () => {
    mockSvc.getSupplierById.mockResolvedValue(ok(sampleSupplier));
    const res = mockRes();
    await ctrl.getSupplierDetails(mockReq({ params: { id: 'sup001' } }), res);
    expect(mockSvc.getSupplierById).toHaveBeenCalledWith('sup001');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when id is missing', async () => {
    const res = mockRes();
    await ctrl.getSupplierDetails(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('skips access check — no access property on user required', async () => {
    mockSvc.getSupplierById.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({
      params: { id: 'sup001' },
      user: { _id: 'u1', name: 'Guest', license: 'l1', branch_id: 'b1' },
    });
    const res = mockRes();
    await ctrl.getSupplierDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('404 when service returns status:false', async () => {
    mockSvc.getSupplierById.mockResolvedValue(err('Not found'));
    const res = mockRes();
    await ctrl.getSupplierDetails(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('delete', () => {
  test('200 on successful bulk delete', async () => {
    mockSvc.bulkDeleteSuppliers.mockResolvedValue(
      ok({ deleted: 2 }, SUCCESS_MESSAGES.SUPPLIERS_DELETED)
    );
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: ['sup001', 'sup002'] } }), res);
    expect(mockSvc.bulkDeleteSuppliers).toHaveBeenCalledWith(['sup001', 'sup002']);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('uses body.data when body.ids absent', async () => {
    mockSvc.bulkDeleteSuppliers.mockResolvedValue(ok({}));
    await ctrl.delete(mockReq({ body: { data: ['sup001'] } }), mockRes());
    expect(mockSvc.bulkDeleteSuppliers).toHaveBeenCalledWith(['sup001']);
  });

  test('400 when ids is empty array in body', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.bulkDeleteSuppliers).not.toHaveBeenCalled();
  });

  test('400 when ids is empty array', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.bulkDeleteSuppliers).not.toHaveBeenCalled();
  });

  test('401 when user has no delete access', async () => {
    const req = mockReq({
      body: { ids: ['sup001'] },
      user: { ...adminUser, access: { supplier: { delete: false } } },
    });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.bulkDeleteSuppliers).not.toHaveBeenCalled();
  });

  test('wraps a single non-array id in an array', async () => {
    mockSvc.bulkDeleteSuppliers.mockResolvedValue(ok({}));
    await ctrl.delete(mockReq({ body: { ids: 'sup001' } }), mockRes());
    expect(mockSvc.bulkDeleteSuppliers).toHaveBeenCalledWith(['sup001']);
  });

  test('400 when service returns status:false', async () => {
    mockSvc.bulkDeleteSuppliers.mockResolvedValue(err('Delete failed'));
    const res = mockRes();
    await ctrl.delete(mockReq({ body: { ids: ['sup001'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 when service throws', async () => {
    mockSvc.bulkDeleteSuppliers.mockRejectedValue(new Error('crash'));
    await expect(ctrl.delete(mockReq({ body: { ids: ['sup001'] } }), mockRes())).rejects.toThrow(
      'crash'
    );
  });
});

// =============================================================================
// getSuppliersAjaxList
// =============================================================================

describe('getSuppliersAjaxList', () => {
  const ajaxData = {
    data: [
      {
        _id: { toString: () => 'sup001' },
        name: 'ABC',
        address: '123',
        phone: '999',
        email: 'a@b.com',
        state: 'TN',
        gst_type: 'regular',
        gst_number: '27XXX',
        branch_name: 'Main',
      },
    ],
  };

  test('200 with mapped suggestions on success', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(ok(ajaxData));
    const res = mockRes();
    await ctrl.getSuppliersAjaxList(mockReq({ query: { query: 'ABC' } }), res);
    expect(mockSvc.searchSuppliers).toHaveBeenCalledWith(
      'ABC',
      expect.objectContaining({ page: 1, limit: 20 })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.query).toBe('ABC');
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({
      id: 'sup001',
      name: 'ABC',
      phone: '999',
      email: 'a@b.com',
    });
  });

  test('uses req.query.q as fallback search term', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(ok({ data: [] }));
    await ctrl.getSuppliersAjaxList(mockReq({ query: { q: 'xyz' } }), mockRes());
    expect(mockSvc.searchSuppliers).toHaveBeenCalledWith('xyz', expect.any(Object));
  });

  test('uses empty string query when neither query nor q provided', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(ok({ data: [] }));
    await ctrl.getSuppliersAjaxList(mockReq({ query: {} }), mockRes());
    expect(mockSvc.searchSuppliers).toHaveBeenCalledWith('', expect.any(Object));
  });

  test('response format is {query, suggestions} not BaseController sendResponse', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(ok({ data: [] }));
    const res = mockRes();
    await ctrl.getSuppliersAjaxList(mockReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('query');
    expect(body).toHaveProperty('suggestions');
    expect(body.type).toBeUndefined();
  });

  test('maps missing optional fields to empty strings in suggestions', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(
      ok({
        data: [{ _id: { toString: () => 'sup999' } }],
      })
    );
    const res = mockRes();
    await ctrl.getSuppliersAjaxList(mockReq(), res);
    const s = res.json.mock.calls[0][0].suggestions[0];
    expect(s.name).toBe('');
    expect(s.phone).toBe('');
    expect(s.email).toBe('');
  });

  test('400 when service returns status:false', async () => {
    mockSvc.searchSuppliers.mockResolvedValue(err('Search failed'));
    const res = mockRes();
    await ctrl.getSuppliersAjaxList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// supplierGraphicalReports
// =============================================================================

describe('supplierGraphicalReports', () => {
  test('200 with report data on success', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockResolvedValue(ok({ chart: [] }));
    const res = mockRes();
    const req = mockReq({
      query: {
        'branch[]': ['br001', 'br002'],
        starting_date: '2026-01-01',
        ending_date: '2026-01-31',
      },
    });
    await ctrl.supplierGraphicalReports(req, res);
    expect(mockLegacyInstance.getSupplierGraphicalReports).toHaveBeenCalledWith(
      expect.objectContaining({ starting_date: '2026-01-01', ending_date: '2026-01-31' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('401 when user has no report read access', async () => {
    const req = mockReq({ user: { ...adminUser, access: { report: { read: false } } } });
    const res = mockRes();
    await ctrl.supplierGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockLegacyInstance.getSupplierGraphicalReports).not.toHaveBeenCalled();
  });

  test('wraps single branch query param in array', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockResolvedValue(ok({}));
    const req = mockReq({ query: { branch: 'br001' } });
    await ctrl.supplierGraphicalReports(req, mockRes());
    const [{ branchid }] = mockLegacyInstance.getSupplierGraphicalReports.mock.calls[0];
    expect(Array.isArray(branchid)).toBe(true);
    expect(branchid).toContain('br001');
  });

  test('passes empty branchIds when no branch param provided', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockResolvedValue(ok({}));
    await ctrl.supplierGraphicalReports(mockReq({ query: {} }), mockRes());
    const [{ branchid }] = mockLegacyInstance.getSupplierGraphicalReports.mock.calls[0];
    expect(branchid).toEqual([]);
  });

  test('sets context on legacy model instance before call', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockResolvedValue(ok({}));
    await ctrl.supplierGraphicalReports(mockReq(), mockRes());
    expect(mockLegacyInstance.licenseId).toBeDefined();
    expect(mockLegacyInstance.branchId).toBeDefined();
  });

  test('400 when service returns status:false', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockResolvedValue(err('Report failed'));
    const res = mockRes();
    await ctrl.supplierGraphicalReports(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 when legacy model throws', async () => {
    mockLegacyInstance.getSupplierGraphicalReports.mockRejectedValue(new Error('crash'));
    await expect(ctrl.supplierGraphicalReports(mockReq(), mockRes())).rejects.toThrow('crash');
  });
});

// =============================================================================
// getDataChanges
// =============================================================================

describe('getDataChanges', () => {
  test('200 with changes data on success', async () => {
    mockSvc.getDataChanges.mockResolvedValue(ok({ changes: [] }));
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: { from: '2026-01-01' } }), res);
    expect(mockSvc.getDataChanges).toHaveBeenCalledWith('2026-01-01');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when "from" date param is missing', async () => {
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/from/i);
    expect(mockSvc.getDataChanges).not.toHaveBeenCalled();
  });

  test('400 when service returns status:false', async () => {
    mockSvc.getDataChanges.mockResolvedValue(err('Failed'));
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: { from: '2026-01-01' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 when service throws', async () => {
    mockSvc.getDataChanges.mockRejectedValue(new Error('crash'));
    await expect(
      ctrl.getDataChanges(mockReq({ query: { from: '2026-01-01' } }), mockRes())
    ).rejects.toThrow('crash');
  });
});

// =============================================================================
// suppliersImport
// =============================================================================

describe('suppliersImport', () => {
  const sampleImport = [
    { name: 'Supplier A', phone: '9876543210' },
    { name: 'Supplier B', phone: '9123456789' },
  ];

  test('200 on successful bulk import', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({ inserted: 2 }, SUCCESS_MESSAGES.SUPPLIERS_IMPORTED));
    const res = mockRes();
    await ctrl.suppliersImport(mockReq({ body: { result: sampleImport } }), res);
    expect(mockSvc.bulkImport).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('uses body.suppliers when body.result absent', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({ inserted: 1 }));
    await ctrl.suppliersImport(mockReq({ body: { suppliers: [{ name: 'X' }] } }), mockRes());
    expect(mockSvc.bulkImport).toHaveBeenCalled();
  });

  test('401 when user has no write access', async () => {
    const req = mockReq({
      body: { result: sampleImport },
      user: { ...adminUser, access: { supplier: { write: false } } },
    });
    const res = mockRes();
    await ctrl.suppliersImport(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.bulkImport).not.toHaveBeenCalled();
  });

  test('400 when suppliers array is empty', async () => {
    const res = mockRes();
    await ctrl.suppliersImport(mockReq({ body: { result: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.bulkImport).not.toHaveBeenCalled();
  });

  test('400 when body has no suppliers or result', async () => {
    const res = mockRes();
    await ctrl.suppliersImport(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.bulkImport).not.toHaveBeenCalled();
  });

  test('attaches branch_id ObjectId to each imported supplier', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({ inserted: 1 }));
    await ctrl.suppliersImport(mockReq({ body: { result: [{ name: 'A' }] } }), mockRes());
    const [suppliers] = mockSvc.bulkImport.mock.calls[0];
    expect(suppliers[0].branch_id).toBeDefined();
  });

  test('adds default GST fields to each supplier when absent', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({}));
    await ctrl.suppliersImport(mockReq({ body: { result: [{ name: 'A' }] } }), mockRes());
    const [suppliers] = mockSvc.bulkImport.mock.calls[0];
    expect(suppliers[0].gst).toBe('disable');
    expect(suppliers[0].gst_type).toBe('consumer');
    expect(suppliers[0].gst_number).toBe('');
  });

  test('preserves supplier gst_type when already set', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({}));
    await ctrl.suppliersImport(
      mockReq({ body: { result: [{ name: 'A', gst_type: 'regular' }] } }),
      mockRes()
    );
    const [suppliers] = mockSvc.bulkImport.mock.calls[0];
    expect(suppliers[0].gst_type).toBe('regular');
  });

  test('fetches branch country/state/city from DB for context', async () => {
    mockBranchesCollection.findOne.mockResolvedValue({
      country: 'India',
      state: 'TN',
      city: 'Chennai',
    });
    mockSvc.bulkImport.mockResolvedValue(ok({}));
    await ctrl.suppliersImport(mockReq({ body: { result: [{ name: 'A' }] } }), mockRes());
    const [suppliers] = mockSvc.bulkImport.mock.calls[0];
    expect(suppliers[0].country).toBe('India');
    expect(suppliers[0].state).toBe('TN');
  });

  test('continues silently when branch DB fetch fails during import', async () => {
    mockBranchesCollection.findOne.mockRejectedValue(new Error('DB down'));
    mockSvc.bulkImport.mockResolvedValue(ok({}));
    const res = mockRes();
    await ctrl.suppliersImport(mockReq({ body: { result: [{ name: 'A' }] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when service returns status:false', async () => {
    mockSvc.bulkImport.mockResolvedValue(err('Import failed'));
    const res = mockRes();
    await ctrl.suppliersImport(mockReq({ body: { result: sampleImport } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// normalizeExportIds (pure helper — tested directly)
// =============================================================================

describe('normalizeExportIds', () => {
  test('returns [] for null/undefined', () => {
    expect(ctrl.normalizeExportIds(null)).toEqual([]);
    expect(ctrl.normalizeExportIds(undefined)).toEqual([]);
  });

  test('returns array unchanged when already an array', () => {
    expect(ctrl.normalizeExportIds(['id1', 'id2'])).toEqual(['id1', 'id2']);
  });

  test('extracts ids from { data: [...] } wrapper', () => {
    expect(ctrl.normalizeExportIds({ data: ['id1'] })).toEqual(['id1']);
  });

  test('extracts ids from { ids: [...] } wrapper', () => {
    expect(ctrl.normalizeExportIds({ ids: ['id2'] })).toEqual(['id2']);
  });

  test('handles form-encoded edge case: JSON array as single object key', () => {
    const ids = ['id1', 'id2'];
    const raw = { [JSON.stringify(ids)]: '' };
    expect(ctrl.normalizeExportIds(raw)).toEqual(ids);
  });

  test('handles object with numeric string keys (encoded array)', () => {
    expect(ctrl.normalizeExportIds({ 0: 'id1', 1: 'id2' })).toEqual(['id1', 'id2']);
  });

  test('parses raw JSON string array', () => {
    expect(ctrl.normalizeExportIds('["id1","id2"]')).toEqual(['id1', 'id2']);
  });

  test('wraps single string ID in array', () => {
    expect(ctrl.normalizeExportIds('id_single')).toEqual(['id_single']);
  });

  test('wraps parsed non-array JSON value in array', () => {
    expect(ctrl.normalizeExportIds('"id_quoted"')).toEqual(['id_quoted']);
  });

  test('wraps unknown type in array', () => {
    expect(ctrl.normalizeExportIds(42)).toEqual([42]);
  });
});

// =============================================================================
// exportSuppliers
// =============================================================================

describe('exportSuppliers', () => {
  test('200 on successful export with array body', async () => {
    mockSvc.exportSuppliers.mockResolvedValue(
      ok([sampleSupplier], SUCCESS_MESSAGES.SUPPLIERS_EXPORTED)
    );
    const res = mockRes();
    await ctrl.exportSuppliers(mockReq({ body: ['sup001', 'sup002'] }), res);
    expect(mockSvc.exportSuppliers).toHaveBeenCalledWith({ ids: ['sup001', 'sup002'] });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe(SUCCESS_MESSAGES.SUPPLIERS_EXPORTED);
  });

  test('401 when user has no read access', async () => {
    const req = mockReq({
      body: ['sup001'],
      user: { ...adminUser, access: { supplier: { read: false } } },
    });
    const res = mockRes();
    await ctrl.exportSuppliers(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSvc.exportSuppliers).not.toHaveBeenCalled();
  });

  test('400 when normalizeExportIds returns empty array', async () => {
    const res = mockRes();
    await ctrl.exportSuppliers(mockReq({ body: null }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/no supplier ids/i);
    expect(mockSvc.exportSuppliers).not.toHaveBeenCalled();
  });

  test('calls service with [{}] when body is empty object (passthrough fallback)', async () => {
    mockSvc.exportSuppliers.mockResolvedValue(ok([]));
    await ctrl.exportSuppliers(mockReq({ body: {} }), mockRes());
    expect(mockSvc.exportSuppliers).toHaveBeenCalledWith({ ids: [{}] });
  });

  test('handles { data: [...] } body format', async () => {
    mockSvc.exportSuppliers.mockResolvedValue(ok([]));
    await ctrl.exportSuppliers(mockReq({ body: { data: ['sup001'] } }), mockRes());
    expect(mockSvc.exportSuppliers).toHaveBeenCalledWith({ ids: ['sup001'] });
  });

  test('handles JSON string body', async () => {
    mockSvc.exportSuppliers.mockResolvedValue(ok([]));
    await ctrl.exportSuppliers(mockReq({ body: '["sup001"]' }), mockRes());
    expect(mockSvc.exportSuppliers).toHaveBeenCalledWith({ ids: ['sup001'] });
  });

  test('400 when service returns status:false', async () => {
    mockSvc.exportSuppliers.mockResolvedValue(err('Export failed'));
    const res = mockRes();
    await ctrl.exportSuppliers(mockReq({ body: ['sup001'] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 when service throws', async () => {
    mockSvc.exportSuppliers.mockRejectedValue(new Error('crash'));
    await expect(ctrl.exportSuppliers(mockReq({ body: ['sup001'] }), mockRes())).rejects.toThrow(
      'crash'
    );
  });
});

// =============================================================================
// Multi-tenant / branch isolation
// =============================================================================

describe('branch isolation', () => {
  test('getAll uses session.selectedBranchId over user.branch_id for filter', async () => {
    mockSvc.getAllSuppliers.mockResolvedValue(ok({ data: [], total: 0 }));
    const req = mockReq({
      session: { selectedBranchId: 'priority_br' },
      user: { ...adminUser, branch_id: 'lower_priority_br' },
    });
    await ctrl.getAll(req, mockRes());
    const v = String(baseModelState.currentBranch?.id || baseModelState.currentBranch);
    expect(v).toBe('priority_br');
  });

  test('add attaches correct branch_id from session when user.branch_id absent', async () => {
    mockSvc.createSupplier.mockResolvedValue(ok(sampleSupplier));
    const req = mockReq({
      body: { name: 'A' },
      session: { selectedBranchId: 'ses_br' },
      user: { ...adminUser, branch_id: undefined },
    });
    await ctrl.add(req, mockRes());
    const [data] = mockSvc.createSupplier.mock.calls[0];
    expect(String(data.branch_id?.id || data.branch_id)).toBe('ses_br');
  });

  test('suppliersImport attaches branch from branch_access when session and user.branch_id absent', async () => {
    mockSvc.bulkImport.mockResolvedValue(ok({}));
    const req = mockReq({
      body: { result: [{ name: 'A' }] },
      session: {},
      user: {
        ...adminUser,
        branch_id: undefined,
        branch_access: [{ branch_id: 'access_br', branch_name: 'Access Branch' }],
      },
    });
    await ctrl.suppliersImport(req, mockRes());
    const [suppliers] = mockSvc.bulkImport.mock.calls[0];
    expect(suppliers[0].branch_id).toBeDefined();
  });
});
