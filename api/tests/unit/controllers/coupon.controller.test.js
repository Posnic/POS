/**
 * Unit tests for CouponController
 *
 * Methods covered:
 *   list, create, update, remove, validate
 *
 * Mocked dependencies:
 *   CouponService, BaseModel
 */

jest.mock('../../../src/services/coupon.service', () =>
  jest.fn().mockImplementation(() => ({
    list: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    validate: jest.fn(),
  }))
);

jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
    async getCollection() {
      return { findOne: jest.fn().mockResolvedValue(null) };
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.currentBranchName = null;
  BaseModelMock.license = null;
  return BaseModelMock;
});

const controller = require('../../../src/controllers/coupon.controller');

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_ID = '507f1f77bcf86cd799439011';
const BRANCH_ID = '60c72b2f9b1e8a001c8e4d2a';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const adminUser = () => ({
  _id: VALID_ID,
  name: 'admin',
  username: 'admin',
  email: 'admin@example.com',
});

const mockReq = (overrides = {}) => ({
  user: adminUser(),
  tenantContext: { branchId: BRANCH_ID, branchName: 'Main Branch', currency: 'INR' },
  params: {},
  query: {},
  body: {},
  ...overrides,
});

// A request whose branch write access is explicitly denied.
const noWriteReq = (overrides = {}) =>
  mockReq({
    user: { ...adminUser(), access: { branch: { write: false } } },
    ...overrides,
  });

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

let svc;

beforeEach(() => {
  jest.clearAllMocks();

  svc = {
    list: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    validate: jest.fn(),
  };
  controller.service = svc;
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  const listResult = () => ({
    status: true,
    data: [{ _id: VALID_ID, code: 'DIWALI10' }],
    message: 'Coupons',
  });

  test('returns 200 with the branch coupon list when service succeeds', async () => {
    svc.list.mockResolvedValue(listResult());
    const res = mockRes();
    await controller.list(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Coupons',
        data: [{ _id: VALID_ID, code: 'DIWALI10' }],
      })
    );
  });

  test('passes the branch id and activeOnly flag to the service', async () => {
    svc.list.mockResolvedValue(listResult());
    const res = mockRes();
    await controller.list(mockReq({ query: { active: 'true' } }), res);

    expect(svc.list).toHaveBeenCalledWith(BRANCH_ID, { activeOnly: true });
  });

  test('defaults activeOnly to false when the query flag is absent', async () => {
    svc.list.mockResolvedValue(listResult());
    const res = mockRes();
    await controller.list(mockReq(), res);

    expect(svc.list).toHaveBeenCalledWith(BRANCH_ID, { activeOnly: false });
  });

  test('returns 500 when the service throws', async () => {
    svc.list.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await controller.list(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB down' })
    );
  });
});

// ─── create ─────────────────────────────────────────────────────────────────────

describe('create', () => {
  const created = () => ({
    status: true,
    data: { _id: VALID_ID, code: 'DIWALI10' },
    message: 'Coupon saved',
  });

  test('returns 200 with the created coupon when service succeeds', async () => {
    svc.save.mockResolvedValue(created());
    const res = mockRes();
    await controller.create(mockReq({ body: { code: 'DIWALI10' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Coupon saved',
        data: { _id: VALID_ID, code: 'DIWALI10' },
      })
    );
  });

  test('saves with an empty id (create) and passes the request body', async () => {
    svc.save.mockResolvedValue(created());
    const res = mockRes();
    await controller.create(mockReq({ body: { code: 'DIWALI10' } }), res);

    expect(svc.save).toHaveBeenCalledWith(
      '',
      { code: 'DIWALI10' },
      expect.objectContaining({ branchId: BRANCH_ID })
    );
  });

  test('returns 403 when the branch has no write access', async () => {
    const res = mockRes();
    await controller.create(noWriteReq({ body: { code: 'DIWALI10' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.save).not.toHaveBeenCalled();
  });

  test('returns 400 when the service rejects the coupon (status false)', async () => {
    svc.save.mockResolvedValue({ status: false, message: 'A coupon code is required' });
    const res = mockRes();
    await controller.create(mockReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'A coupon code is required' })
    );
  });

  test('returns 500 when the service throws', async () => {
    svc.save.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.create(mockReq({ body: { code: 'DIWALI10' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'boom' })
    );
  });
});

// ─── update ─────────────────────────────────────────────────────────────────────

describe('update', () => {
  const updated = () => ({
    status: true,
    data: { _id: VALID_ID, code: 'DIWALI15' },
    message: 'Coupon saved',
  });

  test('returns 200 with the updated coupon when service succeeds', async () => {
    svc.save.mockResolvedValue(updated());
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: { code: 'DIWALI15' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Coupon saved',
        data: { _id: VALID_ID, code: 'DIWALI15' },
      })
    );
  });

  test('saves with the route id and passes the request body', async () => {
    svc.save.mockResolvedValue(updated());
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: { code: 'DIWALI15' } }), res);

    expect(svc.save).toHaveBeenCalledWith(
      VALID_ID,
      { code: 'DIWALI15' },
      expect.objectContaining({ branchId: BRANCH_ID })
    );
  });

  test('returns 403 when the branch has no write access', async () => {
    const res = mockRes();
    await controller.update(noWriteReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.save).not.toHaveBeenCalled();
  });

  test('returns 400 when the service rejects the update (status false)', async () => {
    svc.save.mockResolvedValue({
      status: false,
      message: 'A coupon with this code already exists',
    });
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: { code: 'DIWALI15' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'A coupon with this code already exists',
      })
    );
  });

  test('returns 500 when the service throws', async () => {
    svc.save.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'boom' })
    );
  });
});

// ─── remove ─────────────────────────────────────────────────────────────────────

describe('remove', () => {
  test('returns 200 when the coupon is deleted', async () => {
    svc.remove.mockResolvedValue({
      status: true,
      data: { deleted: 1 },
      message: 'Coupon deleted',
    });
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(svc.remove).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Coupon deleted' })
    );
  });

  test('returns 403 when the branch has no write access', async () => {
    const res = mockRes();
    await controller.remove(noWriteReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.remove).not.toHaveBeenCalled();
  });

  test('returns 404 when the coupon does not exist (status false)', async () => {
    svc.remove.mockResolvedValue({ status: false, message: 'Coupon not found' });
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Coupon not found' })
    );
  });

  test('returns 500 when the service throws', async () => {
    svc.remove.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'boom' })
    );
  });
});

// ─── validate ─────────────────────────────────────────────────────────────────

describe('validate', () => {
  test('returns 200 with the discount when the code is valid', async () => {
    svc.validate.mockResolvedValue({
      status: true,
      valid: true,
      data: { code: 'DIWALI10', discount: 50, capped: false },
      message: 'Coupon applied',
    });
    const res = mockRes();
    await controller.validate(
      mockReq({ body: { code: 'DIWALI10', billTotal: 500, customerId: VALID_ID } }),
      res
    );

    expect(svc.validate).toHaveBeenCalledWith('DIWALI10', {
      billTotal: 500,
      customerId: VALID_ID,
      branchId: BRANCH_ID,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Coupon applied',
        data: { code: 'DIWALI10', discount: 50, capped: false },
      })
    );
  });

  test('returns 200 (a normal answer) when the code is invalid or expired', async () => {
    svc.validate.mockResolvedValue({
      status: false,
      valid: false,
      data: null,
      message: 'This coupon has expired',
    });
    const res = mockRes();
    await controller.validate(mockReq({ body: { code: 'OLD', billTotal: 500 } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'This coupon has expired',
        data: null,
      })
    );
  });

  test('needs no write gate — succeeds even without branch write access', async () => {
    svc.validate.mockResolvedValue({
      status: true,
      valid: true,
      data: { code: 'DIWALI10', discount: 50 },
      message: 'Coupon applied',
    });
    const res = mockRes();
    await controller.validate(noWriteReq({ body: { code: 'DIWALI10', billTotal: 500 } }), res);

    expect(svc.validate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when the service throws', async () => {
    svc.validate.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.validate(mockReq({ body: { code: 'DIWALI10' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'boom' })
    );
  });
});
