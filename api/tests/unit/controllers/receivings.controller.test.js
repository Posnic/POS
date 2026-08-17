/**
 * Unit tests for receivings.controller.js
 *
 * Architecture:
 *  - ReceivingsController extends BaseController (singleton export)
 *  - 1576 lines / ~25 defined methods (4 referenced in routes but NOT defined → 501)
 *  - UNIQUE PATTERN: Business logic resides in the Receiving MODEL (static methods),
 *    NOT in a separate service layer. Completely different from items/sales controllers.
 *  - Three distinct access-check patterns:
 *      checkPermission("receiving", "write/delete", user) — CRUD ops
 *      checkPermission("report", "read", user) — Report ops (default read=true for all)
 *      req.user?.access?.report?.read !== true — gstNineReportTable (strict)
 *      req.user?.access?.receiving?.write !== true — companyPriceUpdate (strict)
 *  - Raw MongoDB via mongoose.connection.collection() used in 4 methods
 *  - Inline dynamic requires inside methods (fs, config, BaseModel, pdfGenerator)
 *
 * Undefined methods (return 501 via bindController):
 *   getSummary, getDataChanges, pendingReceivingProductDetails, updateStatus
 *
 * Key mocks: Receiving model (static + query methods), Branch model,
 *            BaseModel, mongoose.connection, fs, config, pdfGenerator
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connection: {
      collection: jest.fn(),
      db: { collection: jest.fn() },
    },
  };
});

jest.mock('../../../src/models/receiving.model', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  findById: jest.fn(),
  receivingInsertUpdate: jest.fn(),
  getReceivingOrder: jest.fn(),
  returnReceivingOrder: jest.fn(),
  deleteReceivingCollectionData: jest.fn(),
  exportReceivingsOrder: jest.fn(),
  productBasedReceivingReturnReportPage: jest.fn(),
  receivingReportPage: jest.fn(),
  receivingsGraphicalReports: jest.fn(),
  returnReceivingReportPage: jest.fn(),
  pendingReceivingReportPage: jest.fn(),
  pendingSupplierReportPage: jest.fn(),
  returnReceivingProductReportPage: jest.fn(),
  returnPrintDetailsPage: jest.fn(),
  gstNineReportPage: jest.fn(),
  custom_details: {},
}));

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
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
    static get currentBranchName() {
      return s.currentBranchName;
    }
    static set currentBranchName(v) {
      s.currentBranchName = v;
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
    static simplifyFields(item) {
      return { ...item };
    }
  };
});

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
}));

jest.mock('../../../src/config/config', () => ({
  uploadDir: '/tmp/test-uploads',
  cliHost: null,
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/utils/pdfGenerator', () => ({
  generateReceivingPDF: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const Receiving = require('../../../src/models/receiving.model');
const Branch = require('../../../src/models/branch.model');
const mongoose = require('mongoose');
const { generateReceivingPDF } = require('../../../src/utils/pdfGenerator');
const fsMock = require('fs');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
const VALID_LIC = '64f8f2f4c2b9c0a1e4b11111';
const VALID_BRANCH = '64f8f2f4c2b9c0a1e4b22222';
const VALID_SUPPLIER = '64f8f2f4c2b9c0a1e4b33333';
const VALID_ITEM_ID = '64f8f2f4c2b9c0a1e4b44444';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  protocol: 'http',
  get: jest.fn().mockReturnValue('localhost'),
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
  branch_name: 'Test Branch',
  access: {
    receiving: { read: true, write: true, delete: true },
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
    receiving: { read: false, write: false, delete: false },
    report: { read: false },
  },
  ...overrides,
});

// ─── Reusable raw-collection mock ─────────────────────────────────────────────

const buildCollectionMock = () => {
  const aggToArray = jest.fn().mockResolvedValue([]);
  const findToArray = jest.fn().mockResolvedValue([]);
  const findCursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: findToArray,
  };
  const col = {
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue(findCursor),
    aggregate: jest.fn().mockReturnValue({ toArray: aggToArray }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    _findToArray: findToArray,
    _aggToArray: aggToArray,
  };
  return col;
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let ctrl;

beforeAll(() => {
  ctrl = require('../../../src/controllers/receivings.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  // Build fresh chain for Receiving.find (mongoose query)
  const findChain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };
  Receiving.find.mockReturnValue(findChain);
  Receiving.countDocuments.mockResolvedValue(0);

  // Build fresh chain for Receiving.findById (mongoose query + populate)
  const findByIdChain = {
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(null),
  };
  Receiving.findById.mockReturnValue(findByIdChain);

  // Build fresh chain for Branch.findById
  const branchChain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue({ branch_name: 'Test Branch' }),
  };
  Branch.findById.mockReturnValue(branchChain);

  // Set up raw collection mock
  const col = buildCollectionMock();
  mongoose.connection.collection.mockReturnValue(col);
  mongoose.connection.db.collection.mockReturnValue(col);
});

// =============================================================================
// create
// =============================================================================

describe('create', () => {
  const validBody = { supplier_name: 'ABC Suppliers' };

  test('returns 200 with created receiving on success', async () => {
    Receiving.receivingInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Receiving created successfully',
    });
    const req = mockReq({ body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('calls receivingInsertUpdate with null as id (new record)', async () => {
    Receiving.receivingInsertUpdate.mockResolvedValue({ status: true, data: {} });
    const req = mockReq({ body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(Receiving.receivingInsertUpdate).toHaveBeenCalledWith(validBody, null);
  });

  test('returns 403 when checkPermission denies write access', async () => {
    const req = mockReq({ body: validBody, user: restrictedUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(Receiving.receivingInsertUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when user is undefined', async () => {
    const req = mockReq({ body: validBody, user: undefined });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when supplier_name is missing', async () => {
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(Receiving.receivingInsertUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when supplier_name is shorter than 3 characters', async () => {
    const req = mockReq({ body: { supplier_name: 'AB' }, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation Error',
      })
    );
  });

  test('returns 400 when model returns status false', async () => {
    Receiving.receivingInsertUpdate.mockResolvedValue({
      status: false,
      data: null,
      message: 'Duplicate receiving',
    });
    const req = mockReq({ body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 500 when model throws', async () => {
    Receiving.receivingInsertUpdate.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// update
// =============================================================================

describe('update', () => {
  const validBody = { supplier_name: 'XYZ Suppliers', items: [] };

  test('returns 200 on successful update', async () => {
    Receiving.receivingInsertUpdate.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Receiving updated successfully',
    });
    const req = mockReq({ params: { id: VALID_ID }, body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.receivingInsertUpdate).toHaveBeenCalledWith(validBody, VALID_ID);
  });

  test('returns 403 when user lacks write access', async () => {
    const req = mockReq({ params: { id: VALID_ID }, body: validBody, user: restrictedUser() });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(Receiving.receivingInsertUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when id param is missing', async () => {
    const req = mockReq({ params: {}, body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(Receiving.receivingInsertUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving ID is required' })
    );
  });

  test('returns 400 when supplier_name is too short', async () => {
    const req = mockReq({
      params: { id: VALID_ID },
      body: { supplier_name: 'X' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when model returns status false', async () => {
    Receiving.receivingInsertUpdate.mockResolvedValue({ status: false, message: 'Update failed' });
    const req = mockReq({ params: { id: VALID_ID }, body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when model throws', async () => {
    Receiving.receivingInsertUpdate.mockRejectedValue(new Error('crash'));
    const req = mockReq({ params: { id: VALID_ID }, body: validBody, user: adminUser() });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// receivedReceiving
// =============================================================================

describe('receivedReceiving', () => {
  test('returns 200 when marked as received', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, supplier_name: 'XYZ' },
    });
    Receiving.receivingInsertUpdate.mockResolvedValue({
      status: true,
      data: { status: 'Received' },
    });
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.receivingInsertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Received' }),
      VALID_ID
    );
  });

  test('returns 403 when user lacks write access', async () => {
    const req = mockReq({ body: { id: VALID_ID }, user: restrictedUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when id is missing from body', async () => {
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(Receiving.getReceivingOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving ID is required' })
    );
  });

  test('returns 404 when getReceivingOrder returns status false', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({ status: false, message: 'Not found' });
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 400 when receivingInsertUpdate fails', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({ status: true, data: { _id: VALID_ID } });
    Receiving.receivingInsertUpdate.mockResolvedValue({ status: false, message: 'Failed' });
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when model throws', async () => {
    Receiving.getReceivingOrder.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivedReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// returnReceiving
// =============================================================================

describe('returnReceiving', () => {
  const returnBody = { receiving_id: VALID_ID, items: [{ item_id: VALID_ITEM_ID, qty: 2 }] };

  test('returns 200 on successful return', async () => {
    Receiving.returnReceivingOrder.mockResolvedValue({
      status: true,
      data: { return_id: VALID_ID },
      message: 'Return processed',
    });
    const req = mockReq({ body: returnBody, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.returnReceivingOrder).toHaveBeenCalledWith(returnBody);
  });

  test('returns 403 when user lacks write access', async () => {
    const req = mockReq({ body: returnBody, user: restrictedUser() });
    const res = mockRes();
    await ctrl.returnReceiving(req, res);
    expect(Receiving.returnReceivingOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when model returns status false', async () => {
    Receiving.returnReceivingOrder.mockResolvedValue({
      status: false,
      message: 'Already returned',
    });
    const req = mockReq({ body: returnBody, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when model throws', async () => {
    Receiving.returnReceivingOrder.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: returnBody, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceiving(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('delete', () => {
  test('returns 200 when IDs provided via body.data', async () => {
    Receiving.deleteReceivingCollectionData.mockResolvedValue({ status: true, data: 2 });
    const req = mockReq({ body: { data: [VALID_ID, VALID_BRANCH] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.deleteReceivingCollectionData).toHaveBeenCalledWith([VALID_ID, VALID_BRANCH]);
  });

  test('returns 200 when IDs provided via body.ids', async () => {
    Receiving.deleteReceivingCollectionData.mockResolvedValue({ status: true, data: 1 });
    const req = mockReq({ body: { ids: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.deleteReceivingCollectionData).toHaveBeenCalledWith([VALID_ID]);
  });

  test('returns 403 when user lacks delete access', async () => {
    const req = mockReq({ body: { data: [VALID_ID] }, user: restrictedUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(Receiving.deleteReceivingCollectionData).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when data array is empty', async () => {
    const req = mockReq({ body: { data: [] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(Receiving.deleteReceivingCollectionData).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving ID required' })
    );
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.deleteReceivingCollectionData.mockResolvedValue({
      status: false,
      message: 'Not found',
    });
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('fetches branch name from DB when user.branch_name is missing', async () => {
    Receiving.deleteReceivingCollectionData.mockResolvedValue({ status: true, data: 1 });
    const user = adminUser({ branch_name: undefined });
    const req = mockReq({ body: { data: [VALID_ID] }, user });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(Branch.findById).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('continues even when Branch.findById throws', async () => {
    Receiving.deleteReceivingCollectionData.mockResolvedValue({ status: true, data: 1 });
    Branch.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    const user = adminUser({ branch_name: undefined });
    const req = mockReq({ body: { data: [VALID_ID] }, user });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when deleteReceivingCollectionData throws', async () => {
    Receiving.deleteReceivingCollectionData.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// exportReceivings
// =============================================================================

describe('exportReceivings', () => {
  test('returns 200 with exported data when array provided', async () => {
    Receiving.exportReceivingsOrder.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID }],
      message: 'ok',
    });
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.exportReceivingsOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('returns 403 when user lacks read access (no user)', async () => {
    const req = mockReq({ body: { data: [VALID_ID] }, user: undefined });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when body is a number (invalid format)', async () => {
    const req = mockReq({ body: 42, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid receiving IDs format' })
    );
  });

  test('returns 400 when body is empty array', async () => {
    const req = mockReq({ body: [], user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving IDs required' })
    );
  });

  test('returns 400 when body is empty object (values become empty array)', async () => {
    const req = mockReq({ body: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('normalizes string ID to single-element array', async () => {
    Receiving.exportReceivingsOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: VALID_ID, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(Receiving.exportReceivingsOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('normalizes object with values to array', async () => {
    Receiving.exportReceivingsOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: { a: VALID_ID, b: VALID_BRANCH }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(Receiving.exportReceivingsOrder).toHaveBeenCalledWith([VALID_ID, VALID_BRANCH]);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.exportReceivingsOrder.mockResolvedValue({ status: false, message: 'Not found' });
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.exportReceivingsOrder.mockRejectedValue(new Error('crash'));
    const req = mockReq({ body: { data: [VALID_ID] }, user: adminUser() });
    const res = mockRes();
    await ctrl.exportReceivings(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getAll
// =============================================================================

describe('getAll', () => {
  test('returns 200 with paginated list on success', async () => {
    const mockFindChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: VALID_ID }]),
    };
    Receiving.find.mockReturnValue(mockFindChain);
    Receiving.countDocuments.mockResolvedValue(1);
    const req = mockReq({ query: { page: '1', limit: '10' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.total).toBe(1);
    expect(Array.isArray(payload.data.list)).toBe(true);
  });

  test('returns 403 when user is null (checkPermission returns false for null user)', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(Receiving.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('defaults page=1 and limit=10 for invalid query params', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    Receiving.find.mockReturnValue(chain);
    Receiving.countDocuments.mockResolvedValue(0);
    const req = mockReq({ query: { page: '-1', limit: '0' }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(chain.skip).toHaveBeenCalledWith(0);
    // limit: Math.max(1, parseInt('0') || 10) = Math.max(1, 10) = 10
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  test('parses JSON string filters including date range', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    Receiving.find.mockReturnValue(chain);
    Receiving.countDocuments.mockResolvedValue(0);
    const filters = JSON.stringify({ updated_date: { $gte: '2025-01-01', $lte: '2025-12-31' } });
    const req = mockReq({ query: { filters }, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [calledFilter] = Receiving.find.mock.calls[0];
    expect(calledFilter.updated_date).toBeDefined();
  });

  test('applies branch filter from session.selectedBranchId', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    Receiving.find.mockReturnValue(chain);
    Receiving.countDocuments.mockResolvedValue(0);
    const req = mockReq({
      query: {},
      session: { selectedBranchId: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledFilter] = Receiving.find.mock.calls[0];
    expect(calledFilter.branch_id).toBeDefined();
  });

  test('includes license filter from req.user.license', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    Receiving.find.mockReturnValue(chain);
    Receiving.countDocuments.mockResolvedValue(0);
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    const [calledFilter] = Receiving.find.mock.calls[0];
    expect(calledFilter.license).toBeDefined();
  });

  test('returns 500 when Receiving.find throws', async () => {
    Receiving.find.mockImplementation(() => {
      throw new Error('DB error');
    });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('getOne', () => {
  test('returns 200 with restructured receiving data', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({
      status: true,
      data: {
        _id: VALID_ID,
        exclusive_tax: 'on',
        print_logoimg: true,
        receipt_barcode: false,
        id: 'RID000001',
        return_discount: 5,
      },
    });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.exclusive_tax).toBe('on');
    expect(payload.data.id).toBe('RID000001');
  });

  test('defaults exclusive_tax to "off" when missing', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
    });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.exclusive_tax).toBe('off');
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ params: { id: VALID_ID }, user: null });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when neither params.id nor query.id provided', async () => {
    const req = mockReq({ params: {}, query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(Receiving.getReceivingOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('reads id from query.id when params.id missing', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({ status: true, data: { _id: VALID_ID } });
    const req = mockReq({ params: {}, query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(Receiving.getReceivingOrder).toHaveBeenCalledWith(VALID_ID);
  });

  test('returns 404 when receiving not found', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({ status: false, data: null });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving Details Not Found' })
    );
  });

  test('returns 500 when model throws', async () => {
    Receiving.getReceivingOrder.mockRejectedValue(new Error('crash'));
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getById  (delegates to getOne)
// =============================================================================

describe('getById', () => {
  test('delegates entirely to getOne', async () => {
    Receiving.getReceivingOrder.mockResolvedValue({ status: true, data: { _id: VALID_ID } });
    const req = mockReq({ params: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.getById(req, res);
    expect(Receiving.getReceivingOrder).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =============================================================================
// receivingReportTable
// =============================================================================

describe('receivingReportTable', () => {
  test('returns 200 with formatted list on success', async () => {
    Receiving.receivingReportPage.mockResolvedValue({
      status: true,
      data: { list: [{ _id: VALID_ID }], total: 1, current_page: 1, per_page: 5, total_pages: 1 },
    });
    const req = mockReq({ query: { limit: '5', page: '1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns "No records found" message when list is empty', async () => {
    Receiving.receivingReportPage.mockResolvedValue({
      status: true,
      data: { list: [], total: 0, current_page: 1, per_page: 5, total_pages: 1 },
    });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toBe('No records found');
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.receivingReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('passes date range and branch array to model', async () => {
    Receiving.receivingReportPage.mockResolvedValue({ status: true, data: { list: [] } });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31', 'branch[]': [VALID_BRANCH] },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    const [calledData] = Receiving.receivingReportPage.mock.calls[0];
    expect(calledData.starting_date).toBe('2025-01-01');
    expect(calledData.ending_date).toBe('2025-12-31');
  });

  test('returns 500 when model throws', async () => {
    Receiving.receivingReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// receivingsGraphicalReports
// =============================================================================

describe('receivingsGraphicalReports', () => {
  test('returns 200 with chart data on success', async () => {
    Receiving.receivingsGraphicalReports.mockResolvedValue({
      status: true,
      data: { labels: [], values: [] },
      message: 'ok',
    });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.receivingsGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.receivingsGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.receivingsGraphicalReports.mockResolvedValue({ status: false, message: 'no data' });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.receivingsGraphicalReports.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsGraphicalReports(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// returnReceivingReportTable
// =============================================================================

describe('returnReceivingReportTable', () => {
  test('returns 200 with return report data', async () => {
    Receiving.returnReceivingReportPage.mockResolvedValue({
      status: true,
      list: [{ _id: VALID_ID }],
      total: 1,
      current_page: 1,
      per_page: 5,
      total_pages: 1,
    });
    const req = mockReq({ query: { limit: '5', page: '1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.total).toBe(1);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.returnReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.returnReceivingReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.returnReceivingReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// pendingReceivingReportTable  (uses formatReportResponse — always returns 200)
// =============================================================================

describe('pendingReceivingReportTable', () => {
  test('returns 200 with pending receiving list on success', async () => {
    Receiving.pendingReceivingReportPage.mockResolvedValue({
      status: true,
      list: [{ _id: VALID_ID }],
      pagination: { total: 1, page: 1 },
    });
    const req = mockReq({ query: { limit: '5', page: '1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.pendingReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.pendingReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 200 with empty list when model returns status false (formatReportResponse always succeeds)', async () => {
    Receiving.pendingReceivingReportPage.mockResolvedValue({ status: false, list: [] });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.pendingReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.list).toEqual([]);
    expect(payload.data.total).toBe(0);
  });

  test('returns 500 when model throws', async () => {
    Receiving.pendingReceivingReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.pendingReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// pendingSupplierReportTable  (uses formatReportResponse)
// =============================================================================

describe('pendingSupplierReportTable', () => {
  test('returns 200 with pending supplier data', async () => {
    Receiving.pendingSupplierReportPage.mockResolvedValue({
      status: true,
      list: [],
      pagination: { total: 0, page: 1 },
    });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.pendingSupplierReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.pendingSupplierReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 500 when model throws', async () => {
    Receiving.pendingSupplierReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.pendingSupplierReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// productBasedReceivingReturnDetails
// =============================================================================

describe('productBasedReceivingReturnDetails', () => {
  test('returns 200 with paginated return product data', async () => {
    Receiving.productBasedReceivingReturnReportPage.mockResolvedValue({
      status: true,
      list: [],
      total: 0,
      current_page: 1,
      per_page: 5,
      total_pages: 1,
    });
    const req = mockReq({ query: { limit: '5', page: '1' }, user: adminUser() });
    const res = mockRes();
    await ctrl.productBasedReceivingReturnDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.productBasedReceivingReturnDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.productBasedReceivingReturnReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.productBasedReceivingReturnDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.productBasedReceivingReturnReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.productBasedReceivingReturnDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// returnReceivingProductDetails
// =============================================================================

describe('returnReceivingProductDetails', () => {
  test('returns 200 with product detail list', async () => {
    Receiving.returnReceivingProductReportPage.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID }],
      total: 1,
      custom_details: {},
    });
    const req = mockReq({ query: { receiving_id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.total).toBe(1);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.returnReceivingProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.returnReceivingProductReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.returnReceivingProductReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// returnReceivingProductView
// =============================================================================

describe('returnReceivingProductView', () => {
  test('returns 200 with data array on success', async () => {
    Receiving.returnReceivingProductReportPage.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, item_name: 'Rice' }],
    });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductView(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.returnReceivingProductView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.returnReceivingProductReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductView(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.returnReceivingProductReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.returnReceivingProductView(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// returnPrintDetails
// =============================================================================

describe('returnPrintDetails', () => {
  test('returns 200 with print details on success', async () => {
    Receiving.returnPrintDetailsPage.mockResolvedValue({
      status: true,
      data: { receiving_id: 'RID000001' },
      message: 'ok',
    });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnPrintDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Receiving.returnPrintDetailsPage).toHaveBeenCalledWith(VALID_ID);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.returnPrintDetailsPage.mockResolvedValue({ status: false, message: 'Not found' });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnPrintDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.returnPrintDetailsPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.returnPrintDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// supplierReceivingDetails  (raw MongoDB via mongoose.connection.collection)
// =============================================================================

describe('supplierReceivingDetails', () => {
  let col;
  beforeEach(() => {
    col = buildCollectionMock();
    mongoose.connection.collection.mockReturnValue(col);
  });

  test('returns 200 with nested table data on success', async () => {
    col.countDocuments.mockResolvedValue(2);
    col._findToArray.mockResolvedValue([
      { _id: VALID_ID, receiving_id: 'RID001', supplier_name: 'XYZ', items: [] },
    ]);
    const req = mockReq({
      query: { supplier_id: VALID_SUPPLIER, 'branch[]': [VALID_BRANCH] },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.table.data.total).toBe(2);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: { supplier_id: VALID_SUPPLIER }, user: null });
    const res = mockRes();
    await ctrl.supplierReceivingDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when supplier_id is missing', async () => {
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierReceivingDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Supplier ID is required' })
    );
  });

  test('returns 500 when collection throws', async () => {
    col.countDocuments.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ query: { supplier_id: VALID_SUPPLIER }, user: adminUser() });
    const res = mockRes();
    await ctrl.supplierReceivingDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// supplierReceivingReportTable  (raw MongoDB aggregation)
// =============================================================================

describe('supplierReceivingReportTable', () => {
  let col;
  beforeEach(() => {
    col = buildCollectionMock();
    mongoose.connection.collection.mockReturnValue(col);
  });

  test('returns 200 with aggregated supplier list', async () => {
    col._aggToArray
      .mockResolvedValueOnce([
        {
          _id: { supplier_name: 'XYZ', supplier_phone: '0', supplier_id: VALID_SUPPLIER },
          receiving_avg: 100,
          receiving_total: 500,
          receiving_count: 5,
        },
      ])
      .mockResolvedValueOnce([{ _id: { supplier_id: VALID_SUPPLIER } }]);
    const req = mockReq({
      query: { branch: VALID_BRANCH, starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.list).toHaveLength(1);
  });

  test('returns 400 when branch is missing', async () => {
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch ID is required' })
    );
  });

  test('returns 400 when starting_date is missing', async () => {
    const req = mockReq({
      query: { branch: VALID_BRANCH, ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Starting date and ending date are required' })
    );
  });

  test('returns 400 when ending_date is missing', async () => {
    const req = mockReq({
      query: { branch: VALID_BRANCH, starting_date: '2025-01-01' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when collection.aggregate throws', async () => {
    col.aggregate.mockImplementation(() => {
      throw new Error('crash');
    });
    const req = mockReq({
      query: { branch: VALID_BRANCH, starting_date: '2025-01-01', ending_date: '2025-12-31' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.supplierReceivingReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// gstTwoReportTable  (raw MongoDB aggregation — 3 pipelines)
// =============================================================================

describe('gstTwoReportTable', () => {
  let col;
  beforeEach(() => {
    col = buildCollectionMock();
    mongoose.connection.collection.mockReturnValue(col);
  });

  test('returns 200 with sales, returns, and product data on success', async () => {
    col._aggToArray
      .mockResolvedValueOnce([
        {
          _id: {
            item_receiving_id: 'R1',
            item_igst_tax: 10,
            item_cgst_tax: 5,
            item_sgst_tax: 5,
            item_total: 500,
            item_tax: 50,
            csgst_multiply: 10,
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          _id: { item_name: 'Rice' },
          total_qty: 10,
          subtotal_amount: 500,
          tax: 50,
          igst_tax: 10,
          cgst_tax: 5,
          sgst_tax: 5,
          csgst_multiply: 10,
        },
      ]);
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      session: { selectedBranchId: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.gstTwoReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.sales_data).toHaveLength(1);
    expect(payload.data.returns_data).toHaveLength(0);
    expect(payload.data.product_data).toHaveLength(1);
  });

  test('returns 403 when user is null', async () => {
    const req = mockReq({ query: {}, user: null });
    const res = mockRes();
    await ctrl.gstTwoReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when starting_date is missing', async () => {
    const req = mockReq({
      query: { ending_date: '2025-12-31' },
      session: { selectedBranchId: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.gstTwoReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Starting date and ending date are required' })
    );
  });

  test('returns 400 when ending_date is missing', async () => {
    const req = mockReq({
      query: { starting_date: '2025-01-01' },
      session: { selectedBranchId: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.gstTwoReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when aggregate throws', async () => {
    col.aggregate.mockImplementation(() => {
      throw new Error('crash');
    });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      session: { selectedBranchId: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.gstTwoReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// gstNineReportTable  (strict access check: access.report.read !== true)
// =============================================================================

describe('gstNineReportTable', () => {
  test('returns 200 with GST-9 data on success', async () => {
    Receiving.gstNineReportPage.mockResolvedValue({ status: true, data: { summary: [] } });
    const req = mockReq({
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
      session: { branch_id: VALID_BRANCH },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when access.report.read is not true (restrictedUser)', async () => {
    const req = mockReq({ query: {}, session: {}, user: restrictedUser() });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(Receiving.gstNineReportPage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when user is undefined', async () => {
    const req = mockReq({ query: {}, session: {}, user: undefined });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when super_admin lacks explicit access.report.read flag', async () => {
    const userWithoutFlag = { ...adminUser(), access: { report: { read: false } } };
    const req = mockReq({ query: {}, session: {}, user: userWithoutFlag });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when model returns status false', async () => {
    Receiving.gstNineReportPage.mockResolvedValue({ status: false });
    const req = mockReq({ query: {}, session: { branch_id: VALID_BRANCH }, user: adminUser() });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when model throws', async () => {
    Receiving.gstNineReportPage.mockRejectedValue(new Error('crash'));
    const req = mockReq({ query: {}, session: { branch_id: VALID_BRANCH }, user: adminUser() });
    const res = mockRes();
    await ctrl.gstNineReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// companyPriceUpdate  (strict access check: access.receiving.write !== true)
// =============================================================================

describe('companyPriceUpdate', () => {
  let col;
  beforeEach(() => {
    col = buildCollectionMock();
    col.updateOne.mockResolvedValue({ matchedCount: 1 });
    mongoose.connection.db.collection.mockReturnValue(col);
  });

  test('returns 200 when price is updated successfully', async () => {
    const req = mockReq({
      body: { item_id: VALID_ITEM_ID, item_price: '150.00' },
      user: adminUser(),
    });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Item company price updated successfully',
      })
    );
  });

  test('returns 403 when access.receiving.write is not true', async () => {
    const req = mockReq({
      body: { item_id: VALID_ITEM_ID, item_price: 100 },
      user: restrictedUser(),
    });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when user is undefined', async () => {
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: 100 }, user: undefined });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when item_id is missing', async () => {
    const req = mockReq({ body: { item_price: 100 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(col.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Valid item_id is required' })
    );
  });

  test('returns 400 when item_id is not a valid ObjectId', async () => {
    const req = mockReq({ body: { item_id: 'not-valid-id', item_price: 100 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when item_price is missing', async () => {
    const req = mockReq({ body: { item_id: VALID_ITEM_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'item_price is required' })
    );
  });

  test('returns 400 when item_price is negative', async () => {
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: -50 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'item_price must be a valid positive number' })
    );
  });

  test('returns 400 when item_price is NaN string', async () => {
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: 'abc' }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 for price=0 (production bug: !item_price is true for 0)', async () => {
    // Controller uses !item_price which is truthy for 0, blocking free items
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: 0 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'item_price is required' })
    );
  });

  test('returns 404 when item is not found (matchedCount === 0)', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 0 });
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: 100 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Item not found' }));
  });

  test('returns 500 when updateOne throws', async () => {
    col.updateOne.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ body: { item_id: VALID_ITEM_ID, item_price: 100 }, user: adminUser() });
    const res = mockRes();
    await ctrl.companyPriceUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// uploadReceivingImage  (fs.promises — inline require inside method)
// =============================================================================

describe('uploadReceivingImage', () => {
  const validImage = { data: 'base64datahere', name: 'receipt.jpg', size: 100000 };

  test('returns 200 with uploaded image URLs on success', async () => {
    const req = mockReq({
      body: { receiving_image: [validImage] },
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(fsMock.promises.mkdir).toHaveBeenCalled();
    expect(fsMock.promises.writeFile).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toBe('Image uploaded successfully');
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data[0].name).toContain('posnic_receiving_image');
  });

  test('returns 400 when receiving_image is missing', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No images provided' })
    );
  });

  test('returns 400 when receiving_image is not an array', async () => {
    const req = mockReq({ body: { receiving_image: 'base64string' } });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 for invalid file extension', async () => {
    const req = mockReq({
      body: { receiving_image: [{ data: 'b64', name: 'file.exe', size: 100 }] },
    });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Upload valid images. Only GIF, PNG, JPG, JPEG, BMP and PDF are allowed.',
      })
    );
  });

  test('returns 400 when file size exceeds 5MB', async () => {
    const req = mockReq({
      body: { receiving_image: [{ data: 'b64', name: 'big.jpg', size: 5242881 }] },
    });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Image size exceeds 5MB' })
    );
  });

  test('skips entries without data or name', async () => {
    const req = mockReq({
      body: { receiving_image: [{ data: null, name: null }] },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(0);
  });

  test('returns 500 when fs.mkdir throws', async () => {
    fsMock.promises.mkdir.mockRejectedValue(new Error('disk full'));
    const req = mockReq({
      body: { receiving_image: [validImage] },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost'),
    });
    const res = mockRes();
    await ctrl.uploadReceivingImage(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// receivingsPdf  (inline require for pdfGenerator + mongoose populate chain)
// =============================================================================

describe('receivingsPdf', () => {
  beforeEach(() => {
    const findByIdChain = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: VALID_ID, items: [] }),
    };
    Receiving.findById.mockReturnValue(findByIdChain);
    Branch.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: VALID_BRANCH, branch_name: 'HQ' }),
    });
  });

  test('calls generateReceivingPDF on success', async () => {
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsPdf(req, res);
    expect(generateReceivingPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ _id: VALID_ID }),
        branch: expect.objectContaining({ branch_name: 'HQ' }),
        res,
      })
    );
  });

  test('returns 400 when query.id is missing', async () => {
    const req = mockReq({ query: {}, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsPdf(req, res);
    expect(generateReceivingPDF).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving ID is required' })
    );
  });

  test('returns 404 when receiving document not found', async () => {
    Receiving.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsPdf(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Receiving Details Not Found' })
    );
  });

  test('returns 404 when branch not found', async () => {
    Branch.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsPdf(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch Details Not Found' })
    );
  });

  test('returns 500 when findById throws', async () => {
    Receiving.findById.mockImplementation(() => {
      throw new Error('DB crash');
    });
    const req = mockReq({ query: { id: VALID_ID }, user: adminUser() });
    const res = mockRes();
    await ctrl.receivingsPdf(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
