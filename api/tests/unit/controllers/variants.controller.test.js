'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// mongoose — used by resolveBranchContext to validate ObjectIds
jest.mock('mongoose', () => ({
  Types: {
    ObjectId: { isValid: jest.fn(() => true) },
  },
}));

// variants service — all business logic delegated here
jest.mock('../../../src/services/variant.service', () => ({
  getAllVariants: jest.fn(),
  getVariantById: jest.fn(),
  createVariant: jest.fn(),
  updateVariant: jest.fn(),
  deleteVariant: jest.fn(),
  deleteVariants: jest.fn(),
  getVariantsAjaxList: jest.fn(),
  exportVariants: jest.fn(),
  getVariantsByField: jest.fn(),
  searchVariants: jest.fn(),
  getVariantStats: jest.fn(),
}));

// branch model — used inside resolveBranchContext to look up branch_name
jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
}));

// activityLogger
const mockCreateActivityLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/utils/activityLogger', () => ({
  createActivityLog: mockCreateActivityLog,
}));

// ─── Load controller & dependency mocks ───────────────────────────────────────
const ctrl = require('../../../src/controllers/variants.controller');
const mockService = require('../../../src/services/variant.service');
const mockBranch = require('../../../src/models/branch.model');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Req helper: supplies branch_id + branch_name via user so resolveBranchContext
// never hits the database in default tests.
const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: { branch_name: 'Main Branch' },
  user: {
    _id: 'user001',
    branch_id: 'branchid111111111111111',
    branch_name: 'Main Branch',
    branch_access: [],
  },
  ...overrides,
});

// Shorthand service result builders
const ok = (data = null, message = 'ok', type = 'success') => ({
  status: true,
  type,
  message,
  data,
});
const notFound = (message = 'Not found') => ({
  status: false,
  type: 'error',
  message,
  error: null,
});
const exist = (message = 'Already exists') => ({
  status: 'exist',
  type: 'error',
  message,
});
const bad = (message = 'Bad request') => ({
  status: false,
  type: 'error',
  message,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// getAll
// ═══════════════════════════════════════════════════════════════════════════════
describe('getAll', () => {
  test('200 with list data when service returns status true', async () => {
    mockService.getAllVariants.mockResolvedValue(
      ok({ list: [{ _id: 'v1', name: 'Color' }], total: 1 })
    );
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { page: '1', limit: '5' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ total: 1 }),
      })
    );
  });

  test('calls service with query and branch_id', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const query = { page: '1', limit: '10' };
    const req = mockReq({ query });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockService.getAllVariants).toHaveBeenCalledWith(
      query,
      expect.any(String) // branch_id resolved from req.user.branch_id
    );
  });

  test('404 when service returns status false', async () => {
    mockService.getAllVariants.mockResolvedValue(notFound('No variants found'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('500 on unexpected exception', async () => {
    mockService.getAllVariants.mockRejectedValue(new Error('DB crash'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'DB crash',
      })
    );
  });

  test('returns empty list correctly', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [], total: 0 }));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.list).toHaveLength(0);
  });

  test('resolves branch_id from req.body.branch_id when user.branch_id missing', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const req = mockReq({
      body: { branch_id: 'body-branch-id' },
      user: { _id: 'u1', branch_access: [] },
      session: {},
    });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockService.getAllVariants).toHaveBeenCalledWith(expect.any(Object), 'body-branch-id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('getOne', () => {
  test('200 with variant data', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'v1', name: 'Color', fields: [] }));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ name: 'Color' }),
      })
    );
  });

  test('uses query.id when params.id missing', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'v2' }));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: {}, query: { id: 'v2' } }), res);
    expect(mockService.getVariantById).toHaveBeenCalledWith('v2');
  });

  test('uses params.id preferentially', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'v3' }));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v3' }, query: { id: 'v99' } }), res);
    expect(mockService.getVariantById).toHaveBeenCalledWith('v3');
  });

  test('404 when service returns status false', async () => {
    mockService.getVariantById.mockResolvedValue(notFound('Variant not found'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('500 on exception', async () => {
    mockService.getVariantById.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getVariantDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('getVariantDetails', () => {
  test('200 using query.id', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'vd1', name: 'Size' }));
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'vd1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.getVariantById).toHaveBeenCalledWith('vd1');
  });

  test('200 using params.id as fallback', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'vd2' }));
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ params: { id: 'vd2' }, query: {} }), res);
    expect(mockService.getVariantById).toHaveBeenCalledWith('vd2');
  });

  test('prefers query.id over params.id', async () => {
    mockService.getVariantById.mockResolvedValue(ok({ _id: 'qid' }));
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'qid' }, params: { id: 'pid' } }), res);
    expect(mockService.getVariantById).toHaveBeenCalledWith('qid');
  });

  test('404 when not found', async () => {
    mockService.getVariantById.mockResolvedValue(notFound());
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('500 on exception', async () => {
    mockService.getVariantById.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// create
// ═══════════════════════════════════════════════════════════════════════════════
describe('create', () => {
  test('201 on successful creation', async () => {
    mockService.createVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'variant added successfully',
      data: 'newid1',
    });
    const req = mockReq({ body: { name: 'Color', product_type: ['Red', 'Blue'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'variant added successfully',
        data: 'newid1',
      })
    );
  });

  test('calls service with body, branch_id, branch_name', async () => {
    mockService.createVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 'nid',
    });
    const req = mockReq({ body: { name: 'Size' } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(mockService.createVariant).toHaveBeenCalledWith(
      req.body,
      expect.any(String), // branch_id
      expect.any(String) // branch_name
    );
  });

  test('calls createActivityLog on successful creation', async () => {
    mockService.createVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 'nid',
    });
    const req = mockReq({
      body: { name: 'Color' },
      user: { _id: 'u1', branch_id: 'b1', branch_name: 'B' },
    });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entity: 'Variant' })
    );
  });

  test('406 when service returns status "exist"', async () => {
    mockService.createVariant.mockResolvedValue(
      exist('This variant details already exist in our system')
    );
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color' } }), res);
    expect(res.status).toHaveBeenCalledWith(406);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('400 when service returns status false (validation/business fail)', async () => {
    mockService.createVariant.mockResolvedValue(bad('Variant name is required'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Variant name is required');
  });

  test('does NOT call createActivityLog when creation fails', async () => {
    mockService.createVariant.mockResolvedValue(bad('fail'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'X' } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('does NOT call createActivityLog when variant already exists', async () => {
    mockService.createVariant.mockResolvedValue(exist());
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color' } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockService.createVariant.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('safeCreateActivityLog swallows activity log errors', async () => {
    mockService.createVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 'id1',
    });
    mockCreateActivityLog.mockRejectedValue(new Error('log server down'));
    const req = mockReq({ body: { name: 'Color' } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// update
// ═══════════════════════════════════════════════════════════════════════════════
describe('update', () => {
  test('200 on successful update', async () => {
    mockService.updateVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'variant updated successfully',
      data: { _id: 'v1' },
    });
    const req = mockReq({ params: { id: 'v1' }, body: { name: 'New Name' } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('calls service with id, body, branch_id', async () => {
    mockService.updateVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: {},
    });
    const req = mockReq({ params: { id: 'v1' }, body: { name: 'Updated' } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(mockService.updateVariant).toHaveBeenCalledWith('v1', req.body, expect.any(String));
  });

  test('calls createActivityLog on successful update', async () => {
    mockService.updateVariant.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: {},
    });
    const req = mockReq({
      params: { id: 'v1' },
      body: { name: 'Updated' },
      user: { _id: 'u1', branch_id: 'b1', branch_name: 'B' },
    });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entity: 'Variant', entityId: 'v1' })
    );
  });

  test('406 when service returns status "exist" (duplicate name)', async () => {
    mockService.updateVariant.mockResolvedValue(exist());
    const req = mockReq({ params: { id: 'v1' }, body: { name: 'Color' } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(406);
  });

  test('404 when service returns status false (not found)', async () => {
    mockService.updateVariant.mockResolvedValue(notFound('Variant not found'));
    const req = mockReq({ params: { id: 'nonexistent' }, body: { name: 'X' } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('does NOT call createActivityLog on failure', async () => {
    mockService.updateVariant.mockResolvedValue(notFound());
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: 'v1' }, body: { name: 'X' } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockService.updateVariant.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.update(mockReq({ params: { id: 'v1' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delete
// ═══════════════════════════════════════════════════════════════════════════════
describe('delete', () => {
  test('200 on successful delete', async () => {
    mockService.deleteVariant.mockResolvedValue(ok(null, 'Variant deleted successfully'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('uses params.id preferentially over query.id', async () => {
    mockService.deleteVariant.mockResolvedValue(ok());
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'pid' }, query: { id: 'qid' } }), res);
    expect(mockService.deleteVariant).toHaveBeenCalledWith('pid', expect.any(String));
  });

  test('uses query.id when params.id missing', async () => {
    mockService.deleteVariant.mockResolvedValue(ok());
    const res = mockRes();
    await ctrl.delete(mockReq({ params: {}, query: { id: 'qid' } }), res);
    expect(mockService.deleteVariant).toHaveBeenCalledWith('qid', expect.any(String));
  });

  test('calls createActivityLog with DELETE action on success', async () => {
    mockService.deleteVariant.mockResolvedValue(ok());
    const req = mockReq({
      params: { id: 'v1' },
      user: { _id: 'u1', branch_id: 'b1', branch_name: 'B' },
    });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entity: 'Variant' })
    );
  });

  test('404 when service returns status false', async () => {
    mockService.deleteVariant.mockResolvedValue(notFound('Variant not found'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('does NOT call createActivityLog on failure', async () => {
    mockService.deleteVariant.mockResolvedValue(notFound());
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockService.deleteVariant.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// legacyDelete
// ═══════════════════════════════════════════════════════════════════════════════
describe('legacyDelete', () => {
  test('200 on successful bulk delete', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'variant deleted successfully',
      data: 2,
    });
    const req = mockReq({ body: { data: ['id1', 'id2'] } });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toBe(2);
  });

  test('calls service with body.data array', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 1,
    });
    const ids = ['id1'];
    const req = mockReq({ body: { data: ids } });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(mockService.deleteVariants).toHaveBeenCalledWith(ids, expect.any(String));
  });

  test('passes empty array when body.data missing', async () => {
    mockService.deleteVariants.mockResolvedValue(bad('UID is missing'));
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(mockService.deleteVariants).toHaveBeenCalledWith([], expect.any(String));
  });

  test('calls createActivityLog with BULK_DELETE action', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 1,
    });
    const req = mockReq({
      body: { data: ['id1'] },
      user: { _id: 'u1', branch_id: 'b1', branch_name: 'B' },
    });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BULK_DELETE', entity: 'Variant' })
    );
  });

  test('400 when service returns failure', async () => {
    mockService.deleteVariants.mockResolvedValue(bad('UID is missing'));
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: { data: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('does NOT call createActivityLog on failure', async () => {
    mockService.deleteVariants.mockResolvedValue(bad());
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: {} }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockService.deleteVariants.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: { data: ['id1'] } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// bulkDelete
// ═══════════════════════════════════════════════════════════════════════════════
describe('bulkDelete', () => {
  const validIds = ['aabbccddeeff001122334455', 'aabbccddeeff001122334456'];

  test('200 with { deleted: N } when service returns status true', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 2,
    });
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: { ids: validIds } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ deleted: 2 });
  });

  test('passes body.ids to service', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 1,
    });
    const req = mockReq({ body: { ids: [validIds[0]] } });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    expect(mockService.deleteVariants).toHaveBeenCalledWith([validIds[0]], expect.any(String));
  });

  test('passes undefined ids when body is empty', async () => {
    mockService.deleteVariants.mockResolvedValue(bad('No variant IDs provided'));
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: {} }), res);
    expect(mockService.deleteVariants).toHaveBeenCalledWith(undefined, expect.any(String));
  });

  test('calls createActivityLog with BULK_DELETE on success', async () => {
    mockService.deleteVariants.mockResolvedValue({
      status: true,
      type: 'success',
      message: 'ok',
      data: 1,
    });
    const req = mockReq({
      body: { ids: [validIds[0]] },
      user: { _id: 'u1', branch_id: 'b1', branch_name: 'B' },
    });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BULK_DELETE', entity: 'Variant' })
    );
  });

  test('400 when service returns failure', async () => {
    mockService.deleteVariants.mockResolvedValue(bad('No variant IDs provided'));
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: { ids: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('500 on exception', async () => {
    mockService.deleteVariants.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: { ids: validIds } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getVariantsAjaxList
// ═══════════════════════════════════════════════════════════════════════════════
describe('getVariantsAjaxList', () => {
  test('returns result.data directly (legacy format, no status wrapper)', async () => {
    const fakeData = [{ id: 'v1', name: 'Color', fields: [] }];
    mockService.getVariantsAjaxList.mockResolvedValue({ status: true, data: fakeData });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: 'col' } }), res);
    // Uses res.json() directly, NOT res.status().json()
    expect(res.json).toHaveBeenCalledWith(fakeData);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes query string and branch_id to service', async () => {
    mockService.getVariantsAjaxList.mockResolvedValue({ status: true, data: [] });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: 'si', branch_id: 'b1' } }), res);
    expect(mockService.getVariantsAjaxList).toHaveBeenCalledWith('si', 'b1');
  });

  test('passes null branch_id when not in query', async () => {
    mockService.getVariantsAjaxList.mockResolvedValue({ status: true, data: [] });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: 'si' } }), res);
    expect(mockService.getVariantsAjaxList).toHaveBeenCalledWith('si', null);
  });

  test('passes empty string when query is missing', async () => {
    mockService.getVariantsAjaxList.mockResolvedValue({ status: true, data: [] });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    expect(mockService.getVariantsAjaxList).toHaveBeenCalledWith('', null);
  });

  test('500 when service returns status false', async () => {
    mockService.getVariantsAjaxList.mockResolvedValue({
      status: false,
      type: 'error',
      message: 'fail',
    });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('500 on exception', async () => {
    mockService.getVariantsAjaxList.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportVariants
// ═══════════════════════════════════════════════════════════════════════════════
describe('exportVariants', () => {
  const validId = 'aabbccddeeff001122334455';
  const fakeRows = [{ name: 'Color', fields: 'Red, Blue', description: '' }];

  test('200 on successful export', async () => {
    mockService.exportVariants.mockResolvedValue(ok(fakeRows, 'Variants Exported Successfully'));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: [validId] }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual(fakeRows);
  });

  test('calls service with extracted ids and branch_id', async () => {
    mockService.exportVariants.mockResolvedValue(ok(fakeRows));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: { data: [validId] } }), res);
    expect(mockService.exportVariants).toHaveBeenCalledWith([validId], expect.any(String));
  });

  test('400 when service returns failure', async () => {
    mockService.exportVariants.mockResolvedValue(bad('No variants selected for export'));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('passes empty array when body is null', async () => {
    mockService.exportVariants.mockResolvedValue(bad('fail'));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: null }), res);
    expect(mockService.exportVariants).toHaveBeenCalledWith([], expect.any(String));
  });

  test('parses body data JSON string', async () => {
    mockService.exportVariants.mockResolvedValue(ok(fakeRows));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: { data: JSON.stringify([validId]) } }), res);
    expect(mockService.exportVariants).toHaveBeenCalledWith([validId], expect.any(String));
  });

  test('parses plain object with string values as ids', async () => {
    mockService.exportVariants.mockResolvedValue(ok(fakeRows));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: { 0: validId } }), res);
    expect(mockService.exportVariants).toHaveBeenCalledWith([validId], expect.any(String));
  });

  test('500 on exception', async () => {
    mockService.exportVariants.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: [validId] }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getByField
// ═══════════════════════════════════════════════════════════════════════════════
describe('getByField', () => {
  test('200 with matching variants', async () => {
    mockService.getVariantsByField.mockResolvedValue(ok([{ _id: 'v1', name: 'Color' }]));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'Red' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  test('calls service with params.field', async () => {
    mockService.getVariantsByField.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'XL' } }), res);
    expect(mockService.getVariantsByField).toHaveBeenCalledWith('XL');
  });

  test('200 with empty list when no matches', async () => {
    mockService.getVariantsByField.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'NoMatch' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(0);
  });

  test('500 when service returns failure', async () => {
    mockService.getVariantsByField.mockResolvedValue({
      status: false,
      type: 'error',
      message: 'fail',
    });
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'Red' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('500 on exception', async () => {
    mockService.getVariantsByField.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'Red' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// search
// ═══════════════════════════════════════════════════════════════════════════════
describe('search', () => {
  test('200 with results', async () => {
    mockService.searchVariants.mockResolvedValue(ok([{ _id: 'v1', name: 'Color' }]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'col', limit: '10' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  test('calls service with q and integer limit', async () => {
    mockService.searchVariants.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'si', limit: '15' } }), res);
    expect(mockService.searchVariants).toHaveBeenCalledWith('si', 15);
  });

  test('uses default limit of 20 when not provided', async () => {
    mockService.searchVariants.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'si' } }), res);
    expect(mockService.searchVariants).toHaveBeenCalledWith('si', 20);
  });

  test('passes undefined q when missing from query', async () => {
    mockService.searchVariants.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: {} }), res);
    expect(mockService.searchVariants).toHaveBeenCalledWith(undefined, 20);
  });

  test('500 when service returns failure', async () => {
    mockService.searchVariants.mockResolvedValue({ status: false, type: 'error', message: 'fail' });
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'co' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('200 with empty array when no results', async () => {
    mockService.searchVariants.mockResolvedValue(ok([]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'zz' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(0);
  });

  test('500 on exception', async () => {
    mockService.searchVariants.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'co' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getStats
// ═══════════════════════════════════════════════════════════════════════════════
describe('getStats', () => {
  test('200 with statistics', async () => {
    mockService.getVariantStats.mockResolvedValue(ok({ total: 25 }));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 25 });
  });

  test('calls getVariantStats with no args', async () => {
    mockService.getVariantStats.mockResolvedValue(ok({ total: 0 }));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(mockService.getVariantStats).toHaveBeenCalledWith();
  });

  test('200 with zero total', async () => {
    mockService.getVariantStats.mockResolvedValue(ok({ total: 0 }));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.total).toBe(0);
  });

  test('500 when service returns failure', async () => {
    mockService.getVariantStats.mockResolvedValue({
      status: false,
      type: 'error',
      message: 'fail',
    });
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('500 on exception', async () => {
    mockService.getVariantStats.mockRejectedValue(new Error('err'));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveBranchContext integration
// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveBranchContext integration', () => {
  test('fetches branch_name from DB when branch_id exists but no branch_name', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const selectChain = { lean: jest.fn().mockResolvedValue({ branch_name: 'DB Branch' }) };
    mockBranch.findById.mockReturnValue({ select: jest.fn().mockReturnValue(selectChain) });

    const req = mockReq({
      user: { _id: 'u1', branch_id: 'bid1', branch_access: [] }, // no branch_name
      session: {}, // no branch_name
    });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockBranch.findById).toHaveBeenCalledWith('bid1');
  });

  test('does NOT query Branch when branch_name is already available', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const req = mockReq(); // has branch_name via user.branch_name
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockBranch.findById).not.toHaveBeenCalled();
  });

  test('resolves branch_id from req.session.selectedBranchId', async () => {
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const req = mockReq({
      session: { selectedBranchId: 'session-branch-id', branch_name: 'Session Branch' },
      user: { _id: 'u1', branch_access: [] },
    });
    const res = mockRes();
    await ctrl.getAll(req, res);
    // session.selectedBranchId takes priority
    expect(mockService.getAllVariants).toHaveBeenCalledWith(
      expect.any(Object),
      'session-branch-id'
    );
  });

  test('branch_id is null when no source provides a valid id', async () => {
    const mongoose = require('mongoose');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(false);
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));
    const req = mockReq({ user: { _id: 'u1', branch_access: [] }, session: {} });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockService.getAllVariants).toHaveBeenCalledWith(expect.any(Object), null);
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true); // restore
  });

  test('swallows DB error during branch_name fetch and continues', async () => {
    const selectChain = { lean: jest.fn().mockRejectedValue(new Error('branch DB error')) };
    mockBranch.findById.mockReturnValue({ select: jest.fn().mockReturnValue(selectChain) });
    mockService.getAllVariants.mockResolvedValue(ok({ list: [] }));

    const req = mockReq({
      user: { _id: 'u1', branch_id: 'bid1', branch_access: [] },
      session: {}, // no branch_name → triggers DB lookup
    });
    const res = mockRes();
    await ctrl.getAll(req, res);
    // Should still call service and return 200
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Response format consistency
// ═══════════════════════════════════════════════════════════════════════════════
describe('response format consistency', () => {
  test('success response always has success:true, type, message, data', async () => {
    mockService.getAllVariants.mockResolvedValue(
      ok({ list: [] }, 'Variants retrieved successfully', 'success')
    );
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('type');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('data');
  });

  test('error response always has success:false, type, message', async () => {
    mockService.getAllVariants.mockRejectedValue(new Error('crash'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('message');
  });

  test('getVariantsAjaxList returns raw data without success wrapper', async () => {
    const rawData = [{ id: 'v1', name: 'Color' }];
    mockService.getVariantsAjaxList.mockResolvedValue({ status: true, data: rawData });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    // Called with raw data, not wrapped
    expect(res.json).toHaveBeenCalledWith(rawData);
  });
});
