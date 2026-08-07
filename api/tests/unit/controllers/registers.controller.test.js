/**
 * Unit tests for registers.controller.js
 *
 * Architecture:
 *  - RegistersController extends BaseController (singleton export)
 *  - 569 lines / 20 route-handling methods + 1 internal helper (setRequestContext)
 *  - Service pattern: controller creates `this.service = new RegisterService(this.registerModel)`
 *    (instance property, NOT a module-level singleton like items/receivings controllers)
 *  - Repository pattern: RegisterService delegates to RegisterRepository internally
 *  - setRequestContext: resolves branch/license from user, optionally calls branchesService
 *  - sessionFilterUtil.applySessionFilter: called only in registerReportTable when dates provided
 *  - mongoRegisterDateFilter (helper): pure function, adds string_date to each list item
 *
 * Key quirks (PHP replica behavior):
 *  - getDataChanges / getcashField failure path: this.error(res, msg, 200, ...) — HTTP 200 even on error!
 *  - registerInDetail / deleteCashInOut failure path: 400 (not 404)
 *  - registerSaleDetails: passes entire result object (not result.data) to success/error response
 *  - registeropendateFilter: uses custom user.register.length check — NOT checkPermission
 *  - registerReportTable: ONLY method with checkPermission("report", "read")
 *    → default read=true for all authenticated users; only null user triggers 401
 *
 * Mocked dependencies:
 *  - ../../../src/services/register.service       (auto-mock — class)
 *  - ../../../src/models/register.model           (auto-mock — class)
 *  - ../../../src/repositories/register.repository (auto-mock — transitive)
 *  - ../../../src/models/base.model               (custom mock — static setters/getters)
 *  - ../../../src/services/branches.service       (custom mock — singleton)
 *  - ../../../src/utils/session-filter.util       (custom mock — singleton)
 *  - ../../../src/services/base.service           (stub mock — transitive via base.controller.js)
 */

// ─── Module mocks (hoisted by Jest) ───────────────────────────────────────────

jest.mock('../../../src/services/register.service');
jest.mock('../../../src/models/register.model');
jest.mock('../../../src/repositories/register.repository');

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
  };
});

jest.mock('../../../src/services/branch.service', () => ({
  getBranchById: jest.fn().mockResolvedValue({ branch_name: 'Test Branch' }),
}));

jest.mock('../../../src/utils/session-filter.util', () => ({
  applySessionFilter: jest.fn().mockResolvedValue({
    start_date: new Date('2025-01-01'),
    end_date: new Date('2025-12-31'),
    session_applied: false,
  }),
}));

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const branchesService = require('../../../src/services/branch.service');
const sessionFilterUtil = require('../../../src/utils/session-filter.util');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
const VALID_LIC = '64f8f2f4c2b9c0a1e4b11111';
const VALID_BRANCH = '64f8f2f4c2b9c0a1e4b22222';
const VALID_REG_ID = '64f8f2f4c2b9c0a1e4b33333';

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
  ...overrides,
});

const adminUser = (overrides = {}) => ({
  _id: VALID_ID,
  name: 'Admin',
  username: 'admin',
  usertype: 'super_admin',
  license: VALID_LIC,
  branch_id: VALID_BRANCH,
  branch_name: 'Test Branch',
  access: {
    report: { read: true },
  },
  ...overrides,
});

/** User that has at least one entry in register[] — required by registeropendateFilter */
const userWithRegister = (overrides = {}) =>
  adminUser({
    register: [{ _id: VALID_REG_ID, register_name: 'POS-1' }],
    ...overrides,
  });

// ─── Setup ────────────────────────────────────────────────────────────────────

let ctrl;

beforeAll(() => {
  ctrl = require('../../../src/controllers/registers.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Reset sessionFilterUtil to pass-through (no session applied)
  sessionFilterUtil.applySessionFilter.mockResolvedValue({
    start_date: new Date('2025-01-01'),
    end_date: new Date('2025-12-31'),
    session_applied: false,
  });
});

// =============================================================================
// setRequestContext — branch fetch from DB when user.branch_name is absent
// =============================================================================

describe('setRequestContext (internal helper)', () => {
  test('fetches branch_name from branchesService when user has no branch_name', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    const req = mockReq({
      user: adminUser({ branch_name: undefined, branch_id: VALID_BRANCH }),
      query: { from: '' },
    });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(branchesService.getBranchById).toHaveBeenCalledWith(
      VALID_BRANCH,
      expect.objectContaining({ lean: true })
    );
  });

  test('skips branchesService call when user already has branch_name', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(branchesService.getBranchById).not.toHaveBeenCalled();
  });

  test('resolves branch from matching entry in user.branch_access array', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    const req = mockReq({
      user: adminUser({
        branch_name: undefined,
        branch_id: undefined,
        branch_access: [
          { branch_id: VALID_BRANCH, branch_name: 'HQ Branch' },
          { branch_id: VALID_ID, branch_name: 'Sub Branch' },
        ],
      }),
      body: { branch_id: VALID_BRANCH },
      query: {},
    });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('falls back to first branch_access entry when no branchParam matches', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    const req = mockReq({
      user: adminUser({
        branch_name: undefined,
        branch_id: undefined,
        branch_access: [{ branch_id: VALID_BRANCH, branch_name: 'Default Branch' }],
      }),
      query: {},
    });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('continues gracefully when branchesService.getBranchById throws', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    branchesService.getBranchById.mockRejectedValueOnce(new Error('DB error'));
    const req = mockReq({
      user: adminUser({ branch_name: undefined, branch_id: VALID_BRANCH }),
      query: {},
    });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =============================================================================
// getDataChanges
// QUIRK: failure path returns HTTP 200 with type:'error' (PHP replica behavior)
// =============================================================================

describe('getDataChanges', () => {
  test('returns 200 with data on success', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, module: 'registers' }],
    });
    const req = mockReq({ user: adminUser(), query: { from: '2025-01-01' } });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(ctrl.service.getDataChanges).toHaveBeenCalledWith('registers', '2025-01-01');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Changes Retrieved' })
    );
  });

  test('defaults from to empty string when query.from is absent', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(ctrl.service.getDataChanges).toHaveBeenCalledWith('registers', '');
  });

  test('returns HTTP 200 with type:error when service returns status false (PHP quirk)', async () => {
    ctrl.service.getDataChanges = jest.fn().mockResolvedValue({ status: false, data: null });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Not valid Input' })
    );
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.getDataChanges = jest.fn().mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getcashField
// QUIRK: same 200-on-failure behavior as getDataChanges
// =============================================================================

describe('getcashField', () => {
  test('returns 200 with cash field data on success', async () => {
    ctrl.service.getcashFieldData = jest.fn().mockResolvedValue({
      status: true,
      data: [{ field: 'cash_in', label: 'Cash In' }],
    });
    const req = mockReq({ user: adminUser() });
    const res = mockRes();
    await ctrl.getcashField(req, res);
    expect(ctrl.service.getcashFieldData).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Changes Retrieved' })
    );
  });

  test('returns HTTP 200 with type:error when service returns status false (PHP quirk)', async () => {
    ctrl.service.getcashFieldData = jest.fn().mockResolvedValue({ status: false, data: null });
    const req = mockReq({ user: adminUser() });
    const res = mockRes();
    await ctrl.getcashField(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.getcashFieldData = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser() });
    const res = mockRes();
    await ctrl.getcashField(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerReportTable
// ONLY method with checkPermission check
// =============================================================================

describe('registerReportTable', () => {
  const successResult = {
    status: true,
    list: [{ _id: VALID_REG_ID, register_name: 'POS-1', updated_date: new Date() }],
    total: 1,
    current_page: 1,
    total_pages: 1,
    per_page: 5,
    data: [],
  };

  test('returns 200 with report list on success', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue(successResult);
    const req = mockReq({ user: adminUser(), query: { limit: '5', page: '1' } });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.type).toBe('success');
    expect(payload.data.total).toBe(1);
    expect(Array.isArray(payload.data.list)).toBe(true);
  });

  test('each list item gets string_date via mongoRegisterDateFilter', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue(successResult);
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    const { list } = res.json.mock.calls[0][0].data;
    expect(list[0]).toHaveProperty('string_date');
  });

  test('returns 401 when user is null (checkPermission returns false)', async () => {
    const req = mockReq({ user: null, query: {} });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
  });

  test('calls applySessionFilter when starting_date is provided', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue({ ...successResult, list: [] });
    const req = mockReq({
      user: adminUser(),
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
    });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
    const [calledData] = ctrl.service.registerReportPage.mock.calls[0];
    expect(calledData.starting_date).toBeDefined();
    expect(calledData.ending_date).toBeDefined();
  });

  test('skips applySessionFilter when no dates provided', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue({ ...successResult, list: [] });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(sessionFilterUtil.applySessionFilter).not.toHaveBeenCalled();
  });

  test('passes register_id from query.register to service', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue({ ...successResult, list: [] });
    const req = mockReq({ user: adminUser(), query: { register: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    const [calledData] = ctrl.service.registerReportPage.mock.calls[0];
    expect(calledData.register_id).toBe(VALID_REG_ID);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue({ status: false });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Register Not Found' })
    );
  });

  test('defaults limit=5 and page=1 for invalid query params', async () => {
    ctrl.service.registerReportPage = jest.fn().mockResolvedValue({ ...successResult, list: [] });
    const req = mockReq({ user: adminUser(), query: { limit: '-1', page: '0' } });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    const [, options] = ctrl.service.registerReportPage.mock.calls[0];
    expect(options.limit).toBe(5);
    expect(options.page).toBe(1);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerReportPage = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registeropendateFilter
// Custom permission check: user.register.length > 0
// =============================================================================

describe('registeropendateFilter', () => {
  test('returns 200 with open date data on success', async () => {
    ctrl.service.registeropendateFilterPage = jest.fn().mockResolvedValue({
      status: true,
      data: { open_date: '2025-01-01' },
      message: 'Get Successfully',
    });
    const req = mockReq({
      user: userWithRegister(),
      query: { register_name: 'POS-1', register_Id: VALID_REG_ID },
    });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registeropendateFilterPage).toHaveBeenCalledWith({
      registername: 'POS-1',
      registerid: VALID_REG_ID,
    });
  });

  test('returns 401 when user.register is an empty array', async () => {
    const req = mockReq({ user: adminUser({ register: [] }), query: {} });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
  });

  test('returns 401 when user.register is undefined', async () => {
    const req = mockReq({ user: adminUser({ register: undefined }), query: {} });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 401 when user.register is null', async () => {
    const req = mockReq({ user: adminUser({ register: null }), query: {} });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registeropendateFilterPage = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: userWithRegister(), query: {} });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registeropendateFilterPage = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: userWithRegister(), query: {} });
    const res = mockRes();
    await ctrl.registeropendateFilter(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerFindStatus
// =============================================================================

describe('registerFindStatus', () => {
  test('returns 200 with register status on success', async () => {
    ctrl.service.userFindStatus = jest.fn().mockResolvedValue({
      status: true,
      data: { register_status: 'Opened' },
      message: 'Found',
    });
    const req = mockReq({
      user: adminUser(),
      query: { register_name: 'POS-1', register_Id: VALID_REG_ID },
    });
    const res = mockRes();
    await ctrl.registerFindStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.userFindStatus).toHaveBeenCalledWith({
      registername: 'POS-1',
      registerid: VALID_REG_ID,
    });
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.userFindStatus = jest.fn().mockResolvedValue({
      status: false,
      message: 'Not Found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerFindStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.userFindStatus = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerFindStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerAdd  (open/create register)
// =============================================================================

describe('registerAdd', () => {
  const openBody = { register_name: 'POS-1', opening_float: 500.0, branch_id: VALID_BRANCH };

  test('returns 200 when register is opened successfully', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_REG_ID },
      message: 'Register Opened successfully',
    });
    const req = mockReq({ user: adminUser(), body: openBody });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registeraddInsert).toHaveBeenCalledWith(openBody);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('passes full req.body to service', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockResolvedValue({ status: true, data: {} });
    const body = { register_name: 'Cashier-2', opening_float: 0, branch_id: VALID_BRANCH };
    const req = mockReq({ user: adminUser(), body });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    expect(ctrl.service.registeraddInsert).toHaveBeenCalledWith(body);
  });

  test('returns 404 when service returns status false (register already open)', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register already opened',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: openBody });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: openBody });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerUpdate
// =============================================================================

describe('registerUpdate', () => {
  const updateBody = { _id: VALID_REG_ID, register_name: 'POS-1 Updated' };

  test('returns 200 on successful update', async () => {
    ctrl.service.registerUpdateList = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_REG_ID },
      message: 'Updated',
    });
    const req = mockReq({ user: adminUser(), body: updateBody });
    const res = mockRes();
    await ctrl.registerUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registerUpdateList).toHaveBeenCalledWith(updateBody);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registerUpdateList = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: updateBody });
    const res = mockRes();
    await ctrl.registerUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerUpdateList = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: updateBody });
    const res = mockRes();
    await ctrl.registerUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerInDetail  (cash in / cash out record)
// QUIRK: failure returns 400 (not 404)
// =============================================================================

describe('registerInDetail', () => {
  const cashBody = {
    register_id: VALID_REG_ID,
    cash_type: 'cashin',
    amount: 200,
    note: 'Opening extra',
  };

  test('returns 200 when cash-in/out is recorded successfully', async () => {
    ctrl.service.registerInOutDetail = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Register Cashdetail update successfully',
    });
    const req = mockReq({ user: adminUser(), body: cashBody });
    const res = mockRes();
    await ctrl.registerInDetail(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registerInOutDetail).toHaveBeenCalledWith(cashBody);
  });

  test('returns 400 when service returns status false (not 404 — cash-in/out specific)', async () => {
    ctrl.service.registerInOutDetail = jest.fn().mockResolvedValue({
      status: false,
      message: 'Invalid amount',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: cashBody });
    const res = mockRes();
    await ctrl.registerInDetail(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerInOutDetail = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: cashBody });
    const res = mockRes();
    await ctrl.registerInDetail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// deleteCashInOut
// QUIRK: failure returns 400 (not 404)
// =============================================================================

describe('deleteCashInOut', () => {
  const deleteBody = { cash_inout_id: VALID_ID };

  test('returns 200 on successful deletion', async () => {
    ctrl.service.deleteCashInOut = jest.fn().mockResolvedValue({
      status: true,
      data: { deleted: 1 },
      message: 'Cash In/Out entry deleted successfully',
    });
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashInOut(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.deleteCashInOut).toHaveBeenCalledWith(deleteBody);
  });

  test('returns 400 when service returns status false', async () => {
    ctrl.service.deleteCashInOut = jest.fn().mockResolvedValue({
      status: false,
      message: 'Entry not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashInOut(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.deleteCashInOut = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashInOut(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerClose
// =============================================================================

describe('registerClose', () => {
  const closeBody = { _id: VALID_REG_ID, closing_float: 600.0 };

  test('returns 200 when register is closed successfully', async () => {
    ctrl.service.registercloseUpdate = jest.fn().mockResolvedValue({
      status: true,
      data: { status: 'Closed' },
      message: 'Register Closed successfully',
    });
    const req = mockReq({ user: adminUser(), body: closeBody });
    const res = mockRes();
    await ctrl.registerClose(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registercloseUpdate).toHaveBeenCalledWith(closeBody);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 404 when service returns status false (register not open)', async () => {
    ctrl.service.registercloseUpdate = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register is not opened',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: closeBody });
    const res = mockRes();
    await ctrl.registerClose(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registercloseUpdate = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: closeBody });
    const res = mockRes();
    await ctrl.registerClose(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// cashRegisterOpenManual  (re-open a register manually)
// =============================================================================

describe('cashRegisterOpenManual', () => {
  test('returns 200 when register is opened manually', async () => {
    ctrl.service.cashRegisterOpenManualModel = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_REG_ID, status: 'Opened' },
      message: 'Register Opened successfully',
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.cashRegisterOpenManual(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.cashRegisterOpenManualModel).toHaveBeenCalledWith(VALID_REG_ID);
  });

  test('passes undefined when query.id is absent', async () => {
    ctrl.service.cashRegisterOpenManualModel = jest.fn().mockResolvedValue({
      status: true,
      data: {},
      message: 'ok',
    });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.cashRegisterOpenManual(req, res);
    expect(ctrl.service.cashRegisterOpenManualModel).toHaveBeenCalledWith(undefined);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.cashRegisterOpenManualModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.cashRegisterOpenManual(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.cashRegisterOpenManualModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.cashRegisterOpenManual(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getCashRegister  (get register details by ID)
// =============================================================================

describe('getCashRegister', () => {
  test('returns 200 with register data on success', async () => {
    ctrl.service.getCashRegisterModel = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_REG_ID, register_name: 'POS-1' },
      message: 'Register get successfully',
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.getCashRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.getCashRegisterModel).toHaveBeenCalledWith(VALID_REG_ID);
  });

  test('returns 404 when register not found', async () => {
    ctrl.service.getCashRegisterModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.getCashRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.getCashRegisterModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.getCashRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerCountedAmount  (physical cash count during close)
// =============================================================================

describe('registerCountedAmount', () => {
  const countBody = { register_id: VALID_REG_ID, counted_amount: 520.0 };

  test('returns 200 when counted amount is saved', async () => {
    ctrl.service.registerCountedAmount = jest.fn().mockResolvedValue({
      status: true,
      data: { counted_amount: 520 },
      message: 'Amount Updated successfully',
    });
    const req = mockReq({ user: adminUser(), body: countBody });
    const res = mockRes();
    await ctrl.registerCountedAmount(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registerCountedAmount).toHaveBeenCalledWith(countBody);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registerCountedAmount = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: countBody });
    const res = mockRes();
    await ctrl.registerCountedAmount(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerCountedAmount = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: countBody });
    const res = mockRes();
    await ctrl.registerCountedAmount(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerPaymentNote
// =============================================================================

describe('registerPaymentNote', () => {
  const noteBody = { register_id: VALID_REG_ID, note: 'Cash verified' };

  test('returns 200 when payment note is saved', async () => {
    ctrl.service.registerPaymentNoteModel = jest.fn().mockResolvedValue({
      status: true,
      data: { note: 'Cash verified' },
      message: 'Payment note updated successfully',
    });
    const req = mockReq({ user: adminUser(), body: noteBody });
    const res = mockRes();
    await ctrl.registerPaymentNote(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registerPaymentNoteModel).toHaveBeenCalledWith(noteBody);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registerPaymentNoteModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: noteBody });
    const res = mockRes();
    await ctrl.registerPaymentNote(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerPaymentNoteModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: noteBody });
    const res = mockRes();
    await ctrl.registerPaymentNote(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerSaleDetails
// QUIRK: passes entire result object (not result.data) to success/error response
// =============================================================================

describe('registerSaleDetails', () => {
  const saleResult = {
    status: true,
    list: [{ _id: VALID_ID, sale_total: 1000 }],
    total: 1,
    current_page: 1,
    total_pages: 1,
    per_page: 5,
  };

  test('returns 200 and entire result object on success', async () => {
    ctrl.service.registerSaleDetailsPage = jest.fn().mockResolvedValue(saleResult);
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID, limit: '5', page: '1' } });
    const res = mockRes();
    await ctrl.registerSaleDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    // data IS the entire result (not result.data) — unique behavior
    expect(payload.data).toEqual(saleResult);
  });

  test('passes register id and pagination options to service', async () => {
    ctrl.service.registerSaleDetailsPage = jest.fn().mockResolvedValue(saleResult);
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID, limit: '20', page: '3' } });
    const res = mockRes();
    await ctrl.registerSaleDetails(req, res);
    expect(ctrl.service.registerSaleDetailsPage).toHaveBeenCalledWith(
      { id: VALID_REG_ID },
      { limit: 20, page: 3 }
    );
  });

  test('defaults limit=5 and page=1 for invalid query params', async () => {
    ctrl.service.registerSaleDetailsPage = jest.fn().mockResolvedValue(saleResult);
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID, limit: '-5', page: '0' } });
    const res = mockRes();
    await ctrl.registerSaleDetails(req, res);
    const [, options] = ctrl.service.registerSaleDetailsPage.mock.calls[0];
    expect(options.limit).toBe(5);
    expect(options.page).toBe(1);
  });

  test('returns 404 and entire result on failure (not result.data)', async () => {
    const failResult = { status: false, list: [], total: 0 };
    ctrl.service.registerSaleDetailsPage = jest.fn().mockResolvedValue(failResult);
    const req = mockReq({ user: adminUser(), query: { id: VALID_REG_ID } });
    const res = mockRes();
    await ctrl.registerSaleDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sales Details Not Found' })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual(failResult);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerSaleDetailsPage = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.registerSaleDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getRegisterReportDetails
// =============================================================================

describe('getRegisterReportDetails', () => {
  test('returns 200 with report detail data', async () => {
    ctrl.service.getRegisterReportDetailsPage = jest.fn().mockResolvedValue({
      status: true,
      data: { common_details: {}, sale_details: [] },
      message: 'Register report details retrieved successfully',
    });
    const req = mockReq({
      user: adminUser(),
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31', register: VALID_REG_ID },
    });
    const res = mockRes();
    await ctrl.getRegisterReportDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.getRegisterReportDetailsPage).toHaveBeenCalledWith({
      starting_date: '2025-01-01',
      ending_date: '2025-12-31',
      register_id: VALID_REG_ID,
    });
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.getRegisterReportDetailsPage = jest.fn().mockResolvedValue({
      status: false,
      message: 'Not Found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getRegisterReportDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.getRegisterReportDetailsPage = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getRegisterReportDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getRegisterReportPdfDetails
// (calculation logic lives in service, not controller — controller just delegates)
// =============================================================================

describe('getRegisterReportPdfDetails', () => {
  const pdfResult = {
    status: true,
    data: {
      common_details: { opening_float: 500, counted_amount: 550 },
      cash_details: { cashin_amount: 100, cashout_amount: 50 },
      sale_details: [
        { payment_mode: 'Cash', sale_total: 1000, return_total: 50, count: 5 },
        { payment_mode: 'Pending', sale_total: 200, return_total: 0, count: 2 },
      ],
      calculated: { total: 1200, netsale: 950, difference: -650 },
    },
    message: 'Register report details retrieved successfully',
  };

  test('returns 200 with PDF-ready calculated data', async () => {
    ctrl.service.getRegisterReportPdfDetails = jest.fn().mockResolvedValue(pdfResult);
    const req = mockReq({
      user: adminUser(),
      query: { starting_date: '2025-01-01', ending_date: '2025-12-31', register: VALID_REG_ID },
    });
    const res = mockRes();
    await ctrl.getRegisterReportPdfDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.getRegisterReportPdfDetails).toHaveBeenCalledWith({
      starting_date: '2025-01-01',
      ending_date: '2025-12-31',
      register_id: VALID_REG_ID,
    });
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.calculated).toBeDefined();
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.getRegisterReportPdfDetails = jest.fn().mockResolvedValue({
      status: false,
      message: 'Not Found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getRegisterReportPdfDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.getRegisterReportPdfDetails = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: {} });
    const res = mockRes();
    await ctrl.getRegisterReportPdfDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// registerDenomsubmit  (cash denomination submission)
// =============================================================================

describe('registerDenomsubmit', () => {
  const denomBody = {
    register_id: VALID_REG_ID,
    denominations: [
      { note: 500, count: 2 },
      { note: 100, count: 5 },
    ],
  };

  test('returns 200 when denomination is submitted successfully', async () => {
    ctrl.service.registerDenomsubmitModel = jest.fn().mockResolvedValue({
      status: true,
      data: { total: 1500 },
      message: 'Cash added successfully',
    });
    const req = mockReq({ user: adminUser(), body: denomBody });
    const res = mockRes();
    await ctrl.registerDenomsubmit(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.registerDenomsubmitModel).toHaveBeenCalledWith(denomBody);
  });

  test('returns 404 when service returns status false', async () => {
    ctrl.service.registerDenomsubmitModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register not found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: denomBody });
    const res = mockRes();
    await ctrl.registerDenomsubmit(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.registerDenomsubmitModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: denomBody });
    const res = mockRes();
    await ctrl.registerDenomsubmit(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// editCashDenomination  (fetch denomination record for editing)
// =============================================================================

describe('editCashDenomination', () => {
  test('returns 200 with denomination data on success', async () => {
    ctrl.service.editCashDenominationModel = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, denominations: [] },
      message: 'Found',
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_ID } });
    const res = mockRes();
    await ctrl.editCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.editCashDenominationModel).toHaveBeenCalledWith(VALID_ID);
  });

  test('passes query.id to service', async () => {
    ctrl.service.editCashDenominationModel = jest
      .fn()
      .mockResolvedValue({ status: true, data: {} });
    const req = mockReq({ user: adminUser(), query: { id: VALID_ID } });
    const res = mockRes();
    await ctrl.editCashDenomination(req, res);
    expect(ctrl.service.editCashDenominationModel).toHaveBeenCalledWith(VALID_ID);
  });

  test('returns 404 when denomination not found', async () => {
    ctrl.service.editCashDenominationModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Not Found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), query: { id: VALID_ID } });
    const res = mockRes();
    await ctrl.editCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.editCashDenominationModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), query: { id: VALID_ID } });
    const res = mockRes();
    await ctrl.editCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// deleteCashDenomination
// =============================================================================

describe('deleteCashDenomination', () => {
  const deleteBody = { _id: VALID_ID };

  test('returns 200 on successful deletion', async () => {
    ctrl.service.deleteCashDenominationModel = jest.fn().mockResolvedValue({
      status: true,
      data: { deleted: 1 },
      message: 'Delete Successfully',
    });
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ctrl.service.deleteCashDenominationModel).toHaveBeenCalledWith(deleteBody);
  });

  test('returns 404 when denomination not found', async () => {
    ctrl.service.deleteCashDenominationModel = jest.fn().mockResolvedValue({
      status: false,
      message: 'Not Found',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    ctrl.service.deleteCashDenominationModel = jest.fn().mockRejectedValue(new Error('crash'));
    const req = mockReq({ user: adminUser(), body: deleteBody });
    const res = mockRes();
    await ctrl.deleteCashDenomination(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// Response format integrity
// All methods must use { type: 'success'|'error', message, data } — PHP-compat format
// =============================================================================

describe('response format integrity (PHP-compatible { type, message, data })', () => {
  test('success response has correct shape', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockResolvedValue({
      status: true,
      data: { _id: VALID_REG_ID },
      message: 'Register Opened successfully',
    });
    const req = mockReq({ user: adminUser(), body: { register_name: 'POS-1', opening_float: 0 } });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ type: 'success', message: expect.any(String) });
  });

  test('error response has correct shape', async () => {
    ctrl.service.registeraddInsert = jest.fn().mockResolvedValue({
      status: false,
      message: 'Register already opened',
      data: null,
    });
    const req = mockReq({ user: adminUser(), body: {} });
    const res = mockRes();
    await ctrl.registerAdd(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ type: 'error', message: expect.any(String) });
    expect(payload).not.toHaveProperty('success');
  });
});
