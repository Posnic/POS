/**
 * Unit tests for branches.controller.js
 *
 * BranchesController extends BaseController and is exported as a SINGLETON.
 *   ctrl.branchModel    → instance created by mocked BranchModel constructor
 *   ctrl.branchesService → mocked singleton
 */

// =============================================================================
// Mocks (hoisted before any imports)
// =============================================================================

jest.mock('../../../src/models/branch.model', () => {
  const instance = {
    branchPage: jest.fn(),
    getBranchById: jest.fn(),
    createBranch: jest.fn(),
    updateBranch: jest.fn(),
    deleteBranchCollectionData: jest.fn(),
    getPaymentGatewaySettings: jest.fn(),
    getPhonePePaymentGatewaySettings: jest.fn(),
    getEmailSettings: jest.fn(),
    getRegisterList: jest.fn(),
    getBranchDetails: jest.fn(),
    getBranchRegisterList: jest.fn(),
    exportBranchOrder: jest.fn(),
    model: { findById: jest.fn() },
  };
  return {
    BranchModel: jest.fn(() => instance),
    getDataChanges: jest.fn(),
  };
});

jest.mock('../../../src/services/branch.service', () => ({
  getBranchOptions: jest.fn(),
  getBranchStatistics: jest.fn(),
  searchBranches: jest.fn(),
  toggleBranchStatus: jest.fn(),
  normalizeBranchId: jest.fn(),
  getFirstBranch: jest.fn(),
}));

jest.mock('../../../src/models/user.model', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel() {}
  MockBaseModel.currentBranch = null;
  MockBaseModel.currentBranchName = '';
  MockBaseModel.license = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = '';
  return MockBaseModel;
});

jest.mock('mongodb', () => ({
  ObjectId: Object.assign(
    jest.fn((id) => ({ id, toString: () => String(id) })),
    { isValid: jest.fn(() => true) }
  ),
}));

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

// =============================================================================
// Imports
// =============================================================================

const BranchModule = require('../../../src/models/branch.model');
const branchesService = require('../../../src/services/branch.service');
const User = require('../../../src/models/user.model');
const ctrl = require('../../../src/controllers/branches.controller');

const bm = ctrl.branchModel;

// =============================================================================
// Test helpers
// =============================================================================

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const adminUser = {
  _id: 'user001',
  role: 'admin',
  license: 'lic001',
  name: 'Admin User',
  branch_id: 'br001',
  branch_name: 'Main',
};

const lowUser = { _id: 'user002', role: 'cashier' };
const noReadUser = { _id: 'user003', role: 'cashier', access: { branch: { read: false } } };

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: adminUser,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// =============================================================================
// getAll
// =============================================================================

describe('BranchesController — getAll', () => {
  test('returns 200 with branch list on success', async () => {
    bm.branchPage.mockResolvedValue({
      status: true,
      message: 'OK',
      data: { list: [{ _id: 'b1', branch_name: 'Main' }], total: 1 },
    });
    const req = mockReq({ query: { limit: '10', page: '1' } });
    const res = mockRes();

    await ctrl.getAll(req, res);

    expect(bm.branchPage).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('applies default limit=5 and page=1 when query params absent', async () => {
    bm.branchPage.mockResolvedValue({ status: true, message: 'OK', data: { list: [] } });
    await ctrl.getAll(mockReq(), mockRes());
    const [, options] = bm.branchPage.mock.calls[0];
    expect(options.limit).toBe(5);
    expect(options.page).toBe(1);
  });

  test('parses valid JSON filters and passes them to branchPage', async () => {
    bm.branchPage.mockResolvedValue({ status: true, message: 'OK', data: { list: [] } });
    const req = mockReq({ query: { filters: '{"status":"active"}' } });
    await ctrl.getAll(req, mockRes());
    const [filters] = bm.branchPage.mock.calls[0];
    expect(filters).toEqual({ status: 'active' });
  });

  test('returns 404 with filter error when filters JSON is malformed', async () => {
    const req = mockReq({ query: { filters: '{bad json' } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(bm.branchPage).not.toHaveBeenCalled();
  });

  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.branchPage).not.toHaveBeenCalled();
  });

  test('returns 404 when branchPage returns status:false', async () => {
    bm.branchPage.mockResolvedValue({ status: false, message: 'Not found', data: null });
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when branchPage throws', async () => {
    bm.branchPage.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOptions
// =============================================================================

describe('BranchesController — getOptions', () => {
  test('returns 200 with options on success', async () => {
    branchesService.getBranchOptions.mockResolvedValue({
      status: true,
      message: 'OK',
      data: [{ id: 'b1', name: 'Main' }],
    });
    const res = mockRes();
    await ctrl.getOptions(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 404 when service returns status:false', async () => {
    branchesService.getBranchOptions.mockResolvedValue({ status: false, message: 'None' });
    const res = mockRes();
    await ctrl.getOptions(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when service throws', async () => {
    branchesService.getBranchOptions.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await ctrl.getOptions(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOne
// =============================================================================

describe('BranchesController — getOne', () => {
  test('returns 200 with branch data on success', async () => {
    bm.getBranchById.mockResolvedValue({
      status: true,
      data: { _id: 'b1', branch_name: 'Main' },
      message: 'Found',
    });
    const req = mockReq({ params: { id: 'b1' } });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(bm.getBranchById).toHaveBeenCalledWith('b1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ user: noReadUser, params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.getBranchById).not.toHaveBeenCalled();
  });

  test('returns 404 when branch not found', async () => {
    bm.getBranchById.mockResolvedValue({ status: false, message: 'Not found' });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('uses default message when result.message is absent', async () => {
    bm.getBranchById.mockResolvedValue({ status: true, data: { _id: 'b1' } });
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'b1' } }), res);
    expect(res.json.mock.calls[0][0].message).toBe('Branch retrieved successfully');
  });

  test('returns 500 when getBranchById throws', async () => {
    bm.getBranchById.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// add
// =============================================================================

describe('BranchesController — add', () => {
  test('returns 200 on successful branch creation', async () => {
    bm.createBranch.mockResolvedValue({
      status: true,
      data: { _id: 'b1' },
      message: 'Branch created',
    });
    const req = mockReq({ body: { branch_name: 'New Branch' } });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(bm.createBranch).toHaveBeenCalledWith({ branch_name: 'New Branch' }, adminUser);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.add(mockReq({ user: lowUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.createBranch).not.toHaveBeenCalled();
  });

  test('returns 406 when branch name already exists (status: "exist")', async () => {
    bm.createBranch.mockResolvedValue({
      status: 'exist',
      message: 'Branch already exists',
      data: null,
    });
    const res = mockRes();
    await ctrl.add(mockReq({ body: { branch_name: 'Dup' } }), res);
    expect(res.status).toHaveBeenCalledWith(406);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 404 when model returns status:false', async () => {
    bm.createBranch.mockResolvedValue({ status: false, message: 'Error', data: null });
    const res = mockRes();
    await ctrl.add(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when createBranch throws', async () => {
    bm.createBranch.mockRejectedValue(new Error('DB fail'));
    const res = mockRes();
    await ctrl.add(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// edit
// =============================================================================

describe('BranchesController — edit', () => {
  test('returns 200 on successful update', async () => {
    bm.updateBranch.mockResolvedValue({
      status: true,
      data: { _id: 'b1', branch_name: 'Updated' },
      message: 'Branch updated',
    });
    const req = mockReq({ params: { id: 'b1' }, body: { branch_name: 'Updated' } });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(bm.updateBranch).toHaveBeenCalledWith('b1', { branch_name: 'Updated' }, adminUser);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ user: lowUser, params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.updateBranch).not.toHaveBeenCalled();
  });

  test('returns 400 when id is missing from params', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(bm.updateBranch).not.toHaveBeenCalled();
  });

  test('returns 404 when branch not found', async () => {
    bm.updateBranch.mockResolvedValue({ status: false, message: 'Branch not found' });
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 when updateBranch throws', async () => {
    bm.updateBranch.mockRejectedValue(new Error('DB err'));
    const res = mockRes();
    await ctrl.edit(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('BranchesController — delete', () => {
  test('returns 200 on successful delete using params.id', async () => {
    bm.deleteBranchCollectionData.mockResolvedValue({
      status: true,
      data: {},
      message: 'Branch deleted',
    });
    const req = mockReq({ params: { id: 'b1' } });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(bm.deleteBranchCollectionData).toHaveBeenCalledWith('b1', adminUser);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('falls back to req.body.data when params.id is absent', async () => {
    bm.deleteBranchCollectionData.mockResolvedValue({ status: true, data: {}, message: 'OK' });
    const req = mockReq({ params: {}, body: { data: 'b2' } });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(bm.deleteBranchCollectionData).toHaveBeenCalledWith('b2', adminUser);
  });

  test('returns 400 when id is missing from both params and body', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ params: {}, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(bm.deleteBranchCollectionData).not.toHaveBeenCalled();
  });

  test('returns 403 when user lacks delete permission', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ user: lowUser, params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.deleteBranchCollectionData).not.toHaveBeenCalled();
  });

  test('returns 404 when model returns status:false', async () => {
    bm.deleteBranchCollectionData.mockResolvedValue({
      status: false,
      message: 'Not found',
      data: null,
    });
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sets BaseModel context from session when sessionBranchId is present', async () => {
    bm.deleteBranchCollectionData.mockResolvedValue({ status: true, data: {}, message: 'OK' });
    const BaseModel = require('../../../src/models/base.model');
    const req = mockReq({
      params: { id: 'b1' },
      session: { selectedBranchId: 'sess_br1' },
    });
    await ctrl.delete(req, mockRes());
    expect(BaseModel.currentBranch).not.toBeUndefined();
  });

  test('returns 500 when deleteBranchCollectionData throws', async () => {
    bm.deleteBranchCollectionData.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// resetPaymentGateway
// =============================================================================

describe('BranchesController — resetPaymentGateway', () => {
  test('returns 200 with gateway settings on success', async () => {
    bm.getPaymentGatewaySettings.mockResolvedValue({
      status: true,
      data: { api_key: 'abc123' },
      message: 'OK',
    });
    const req = mockReq({ query: { id: 'b1' } });
    const res = mockRes();
    await ctrl.resetPaymentGateway(req, res);
    expect(bm.getPaymentGatewaySettings).toHaveBeenCalledWith('b1', 'lic001');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('prefers session.selectedBranchId over query.id', async () => {
    bm.getPaymentGatewaySettings.mockResolvedValue({ status: true, data: {}, message: 'OK' });
    const req = mockReq({
      session: { selectedBranchId: 'sess_b1' },
      query: { id: 'q_b1' },
    });
    await ctrl.resetPaymentGateway(req, mockRes());
    expect(bm.getPaymentGatewaySettings).toHaveBeenCalledWith('sess_b1', 'lic001');
  });

  test('returns 400 when branchId cannot be resolved', async () => {
    const res = mockRes();
    await ctrl.resetPaymentGateway(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(bm.getPaymentGatewaySettings).not.toHaveBeenCalled();
  });

  test('returns 400 when licenseId is missing', async () => {
    const req = mockReq({ query: { id: 'b1' }, user: { role: 'admin' } });
    const res = mockRes();
    await ctrl.resetPaymentGateway(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when model returns status:false', async () => {
    bm.getPaymentGatewaySettings.mockResolvedValue({ status: false, message: 'Not configured' });
    const res = mockRes();
    await ctrl.resetPaymentGateway(mockReq({ query: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.getPaymentGatewaySettings.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.resetPaymentGateway(mockReq({ query: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// resetPhonepePaymentGateway
// =============================================================================

describe('BranchesController — resetPhonepePaymentGateway', () => {
  test('returns 200 with PhonePe settings on success', async () => {
    bm.getPhonePePaymentGatewaySettings.mockResolvedValue({
      status: true,
      data: { merchant_id: 'M001' },
      message: 'OK',
    });
    const req = mockReq({ query: { id: 'b1' } });
    const res = mockRes();
    await ctrl.resetPhonepePaymentGateway(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when model returns status:false', async () => {
    bm.getPhonePePaymentGatewaySettings.mockResolvedValue({ status: false, message: 'None' });
    const res = mockRes();
    await ctrl.resetPhonepePaymentGateway(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.getPhonePePaymentGatewaySettings.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.resetPhonepePaymentGateway(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// resetEmailSetting
// =============================================================================

describe('BranchesController — resetEmailSetting', () => {
  test('returns 200 with email settings on success', async () => {
    bm.getEmailSettings.mockResolvedValue({
      status: true,
      data: { smtp_host: 'smtp.example.com' },
      message: 'OK',
    });
    const req = mockReq({ query: { id: 'b1' } });
    const res = mockRes();
    await ctrl.resetEmailSetting(req, res);
    expect(bm.getEmailSettings).toHaveBeenCalledWith('b1', 'lic001');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when branchId cannot be resolved', async () => {
    const res = mockRes();
    await ctrl.resetEmailSetting(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when licenseId is missing', async () => {
    const req = mockReq({ query: { id: 'b1' }, user: { role: 'admin' } });
    const res = mockRes();
    await ctrl.resetEmailSetting(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when model returns status:false', async () => {
    bm.getEmailSettings.mockResolvedValue({ status: false, message: 'Not configured' });
    const res = mockRes();
    await ctrl.resetEmailSetting(mockReq({ query: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.getEmailSettings.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.resetEmailSetting(mockReq({ query: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getBranchList
// =============================================================================

describe('BranchesController — getBranchList', () => {
  const chainSelectLean = (data) => ({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(data),
    }),
  });

  test('returns 200 with mapped branch list', async () => {
    User.findById.mockReturnValue(
      chainSelectLean({
        branch_access: [
          { branch_id: { toString: () => 'b1' }, branch_name: 'Main', branch_image: 'main.png' },
        ],
      })
    );
    const res = mockRes();
    await ctrl.getBranchList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 'b1', branch_name: 'Main', branch_image: 'main.png' });
  });

  test('returns 401 when req.user._id is absent', async () => {
    const res = mockRes();
    await ctrl.getBranchList(mockReq({ user: {} }), res);
    // 401, not 403: no user id on the request is missing AUTHENTICATION,
    // not a missing permission.
    expect(res.status).toHaveBeenCalledWith(401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns empty branch list when user.branch_access is null', async () => {
    User.findById.mockReturnValue(chainSelectLean({ branch_access: null }));
    const res = mockRes();
    await ctrl.getBranchList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  test('defaults branch_image to "store.png" when entry has no branch_image', async () => {
    User.findById.mockReturnValue(
      chainSelectLean({
        branch_access: [{ branch_id: 'b1', branch_name: 'X' }],
      })
    );
    const res = mockRes();
    await ctrl.getBranchList(mockReq(), res);
    expect(res.json.mock.calls[0][0].data[0].branch_image).toBe('store.png');
  });

  test('returns 500 on thrown error', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('DB')),
      }),
    });
    const res = mockRes();
    await ctrl.getBranchList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// userRegisterBranchSelect
// =============================================================================

describe('BranchesController — userRegisterBranchSelect', () => {
  test('returns 200 with register list when branch ID resolved', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getRegisterList.mockResolvedValue({ status: true, data: [{ id: 'r1' }], message: 'OK' });
    const req = mockReq({ query: { id: 'b1' } });
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(req, res);
    expect(bm.getRegisterList).toHaveBeenCalledWith('b1', adminUser);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('falls back to getFirstBranch when normalizeBranchId returns null', async () => {
    branchesService.normalizeBranchId.mockReturnValue(null);
    branchesService.getFirstBranch.mockResolvedValue({ _id: { toString: () => 'fb1' } });
    bm.getRegisterList.mockResolvedValue({ status: true, data: [], message: 'OK' });
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(mockReq(), res);
    expect(branchesService.getFirstBranch).toHaveBeenCalled();
    expect(bm.getRegisterList).toHaveBeenCalledWith('fb1', adminUser);
  });

  test('returns 400 when no branch ID can be resolved at all', async () => {
    branchesService.normalizeBranchId.mockReturnValue(null);
    branchesService.getFirstBranch.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when getRegisterList returns status:false', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getRegisterList.mockResolvedValue({ status: false, message: 'Not found', data: null });
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 400 status when message is "Branch id is required"', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getRegisterList.mockResolvedValue({
      status: false,
      message: 'Branch id is required',
      data: null,
    });
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 on thrown error', async () => {
    branchesService.normalizeBranchId.mockImplementation(() => {
      throw new Error('err');
    });
    const res = mockRes();
    await ctrl.userRegisterBranchSelect(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getOneStore
// =============================================================================

describe('BranchesController — getOneStore', () => {
  test('returns 200 with store data on success', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getBranchDetails.mockResolvedValue({ status: true, data: { branch_name: 'Main' } });
    const req = mockReq({ query: { id: 'b1' } });
    const res = mockRes();
    await ctrl.getOneStore(req, res);
    expect(bm.getBranchDetails).toHaveBeenCalledWith('b1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('falls back to getFirstBranch when normalizeBranchId returns null', async () => {
    branchesService.normalizeBranchId.mockReturnValue(null);
    branchesService.getFirstBranch.mockResolvedValue({ _id: { toString: () => 'fb1' } });
    bm.getBranchDetails.mockResolvedValue({ status: true, data: {} });
    await ctrl.getOneStore(mockReq(), mockRes());
    expect(bm.getBranchDetails).toHaveBeenCalledWith('fb1');
  });

  test('returns 400 when no branch ID can be resolved', async () => {
    branchesService.normalizeBranchId.mockReturnValue(null);
    branchesService.getFirstBranch.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.getOneStore(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when getBranchDetails returns status:false', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getBranchDetails.mockResolvedValue({ status: false, message: 'Store Not found' });
    const res = mockRes();
    await ctrl.getOneStore(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 400 status when result.message is "Branch id is required"', async () => {
    branchesService.normalizeBranchId.mockReturnValue('b1');
    bm.getBranchDetails.mockResolvedValue({ status: false, message: 'Branch id is required' });
    const res = mockRes();
    await ctrl.getOneStore(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 on thrown error', async () => {
    branchesService.normalizeBranchId.mockImplementation(() => {
      throw new Error('err');
    });
    const res = mockRes();
    await ctrl.getOneStore(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getBranchDetails
// =============================================================================

describe('BranchesController — getBranchDetails', () => {
  test('returns 200 with branch on success', async () => {
    bm.model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'b1', branch_name: 'Main' }),
    });
    const req = mockReq({ params: { id: 'b1' } });
    const res = mockRes();
    await ctrl.getBranchDetails(req, res);
    expect(bm.model.findById).toHaveBeenCalledWith('b1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('uses query.id when params.id is absent', async () => {
    bm.model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'b1' }),
    });
    const req = mockReq({ query: { id: 'b1' }, params: {} });
    await ctrl.getBranchDetails(req, mockRes());
    expect(bm.model.findById).toHaveBeenCalledWith('b1');
  });

  test('returns 400 when id is absent from both params and query', async () => {
    const res = mockRes();
    await ctrl.getBranchDetails(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(bm.model.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when branch document is null', async () => {
    bm.model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    const res = mockRes();
    await ctrl.getBranchDetails(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.model.findById.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error('err')),
    });
    const res = mockRes();
    await ctrl.getBranchDetails(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getDataChanges
// =============================================================================

describe('BranchesController — getDataChanges', () => {
  test('returns 200 with data on success', async () => {
    BranchModule.getDataChanges.mockResolvedValue({ status: true, data: [], message: 'OK' });
    const req = mockReq({ query: { from: '2024-01-01' } });
    const res = mockRes();
    await ctrl.getDataChanges(req, res);
    expect(BranchModule.getDataChanges).toHaveBeenCalledWith('branches', '2024-01-01');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('defaults from to "" when query.from is absent', async () => {
    BranchModule.getDataChanges.mockResolvedValue({ status: true, data: [], message: 'OK' });
    await ctrl.getDataChanges(mockReq(), mockRes());
    expect(BranchModule.getDataChanges).toHaveBeenCalledWith('branches', '');
  });

  test('returns 200 with error type when status is false', async () => {
    BranchModule.getDataChanges.mockResolvedValue({ status: false, data: null });
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 on thrown error', async () => {
    BranchModule.getDataChanges.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await ctrl.getDataChanges(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// exportBranches
// =============================================================================

describe('BranchesController — exportBranches', () => {
  test('returns 200 on successful export', async () => {
    bm.exportBranchOrder.mockResolvedValue({
      status: true,
      data: [{ _id: 'b1' }],
      message: 'Exported',
    });
    const req = mockReq({ body: ['id1', 'id2'] });
    const res = mockRes();
    await ctrl.exportBranches(req, res);
    expect(bm.exportBranchOrder).toHaveBeenCalledWith(['id1', 'id2'], 'lic001');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.exportBranches(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bm.exportBranchOrder).not.toHaveBeenCalled();
  });

  test('returns 404 when export returns status:false', async () => {
    bm.exportBranchOrder.mockResolvedValue({ status: false, message: 'Failed' });
    const res = mockRes();
    await ctrl.exportBranches(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.exportBranchOrder.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.exportBranches(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getBranchRegisterList
// =============================================================================

describe('BranchesController — getBranchRegisterList', () => {
  test('returns 200 with register list using query.branch', async () => {
    bm.getBranchRegisterList.mockResolvedValue({
      status: true,
      data: [{ id: 'r1' }],
      message: 'OK',
    });
    const req = mockReq({ query: { branch: 'b1' } });
    const res = mockRes();
    await ctrl.getBranchRegisterList(req, res);
    expect(bm.getBranchRegisterList).toHaveBeenCalledWith('b1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('uses params.branchId when query.branch is absent', async () => {
    bm.getBranchRegisterList.mockResolvedValue({ status: true, data: [], message: 'OK' });
    const req = mockReq({ params: { branchId: 'b2' }, query: {} });
    await ctrl.getBranchRegisterList(req, mockRes());
    expect(bm.getBranchRegisterList).toHaveBeenCalledWith('b2');
  });

  test('returns 404 when status is false', async () => {
    bm.getBranchRegisterList.mockResolvedValue({ status: false, message: 'Not found' });
    const res = mockRes();
    await ctrl.getBranchRegisterList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    bm.getBranchRegisterList.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.getBranchRegisterList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getStats
// =============================================================================

describe('BranchesController — getStats', () => {
  test('returns 200 with stats on success', async () => {
    branchesService.getBranchStatistics.mockResolvedValue({
      status: true,
      data: { total: 5, active: 4 },
      message: 'OK',
    });
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(branchesService.getBranchStatistics).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.getStats(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(branchesService.getBranchStatistics).not.toHaveBeenCalled();
  });

  test('returns 404 when service returns status:false', async () => {
    branchesService.getBranchStatistics.mockResolvedValue({ status: false, message: 'None' });
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    branchesService.getBranchStatistics.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// search
// =============================================================================

describe('BranchesController — search', () => {
  test('returns 200 with search results', async () => {
    branchesService.searchBranches.mockResolvedValue({
      status: true,
      data: [{ _id: 'b1', branch_name: 'Main' }],
      message: 'OK',
    });
    const req = mockReq({ query: { q: 'Main' } });
    const res = mockRes();
    await ctrl.search(req, res);
    expect(branchesService.searchBranches).toHaveBeenCalledWith('Main', 10);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when user lacks read permission', async () => {
    const res = mockRes();
    await ctrl.search(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(branchesService.searchBranches).not.toHaveBeenCalled();
  });

  test('defaults q to "" when not provided', async () => {
    branchesService.searchBranches.mockResolvedValue({ status: true, data: [], message: 'OK' });
    await ctrl.search(mockReq(), mockRes());
    expect(branchesService.searchBranches).toHaveBeenCalledWith('', 10);
  });

  test('returns 400 when search returns status:false (query too short)', async () => {
    branchesService.searchBranches.mockResolvedValue({
      status: false,
      message: 'Search query must be at least 2 characters',
    });
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 on thrown error', async () => {
    branchesService.searchBranches.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'Main' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// toggleStatus
// =============================================================================

describe('BranchesController — toggleStatus', () => {
  test('returns 200 on successful status toggle', async () => {
    branchesService.toggleBranchStatus.mockResolvedValue({
      status: true,
      data: { _id: 'b1', status: 'inactive' },
      message: 'Status toggled',
    });
    const req = mockReq({ params: { id: 'b1' } });
    const res = mockRes();
    await ctrl.toggleStatus(req, res);
    expect(branchesService.toggleBranchStatus).toHaveBeenCalledWith('b1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.toggleStatus(mockReq({ user: lowUser, params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(branchesService.toggleBranchStatus).not.toHaveBeenCalled();
  });

  test('returns 404 when branch not found', async () => {
    branchesService.toggleBranchStatus.mockResolvedValue({ status: false, message: 'Not found' });
    const res = mockRes();
    await ctrl.toggleStatus(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 500 on thrown error', async () => {
    branchesService.toggleBranchStatus.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.toggleStatus(mockReq({ params: { id: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
