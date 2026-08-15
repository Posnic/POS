/**
 * Unit tests for LoyaltyController
 *
 * Methods covered:
 *   getConfig, saveConfig, summary, liability, preview
 *
 * Mocked dependencies:
 *   LoyaltyService (instance methods + static computeEarn/computeRedeem), BaseModel
 */

jest.mock('../../../src/services/loyalty.service', () => {
  const MockLoyaltyService = jest.fn().mockImplementation(() => ({
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    summary: jest.fn(),
    liability: jest.fn(),
  }));
  // The controller calls these STATIC helpers directly in preview().
  MockLoyaltyService.computeEarn = jest.fn();
  MockLoyaltyService.computeRedeem = jest.fn();
  return MockLoyaltyService;
});

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
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

const LoyaltyService = require('../../../src/services/loyalty.service');
const controller = require('../../../src/controllers/loyalty.controller');

// ─── Constants ───────────────────────────────────────────────────────────────

const BRANCH_ID = '507f1f77bcf86cd799439011';
const CUSTOMER_ID = '60c72b2f9b1e8a001c8e4d2a';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mockReq = (overrides = {}) => ({
  user: { name: 'cashier', branch_id: BRANCH_ID },
  tenantContext: { branchId: BRANCH_ID, currency: 'INR' },
  params: {},
  query: {},
  body: {},
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const sampleConfig = () => ({
  enabled: true,
  earn_points: 1,
  earn_amount: 100,
  currency: 'INR',
  branch_id: BRANCH_ID,
});

// ─── Setup ──────────────────────────────────────────────────────────────────────

let svc;

beforeEach(() => {
  jest.clearAllMocks();

  svc = {
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    summary: jest.fn(),
    liability: jest.fn(),
  };
  controller.service = svc;

  LoyaltyService.computeEarn.mockReturnValue({ points: 0, tier: { name: 'Bronze' } });
  LoyaltyService.computeRedeem.mockReturnValue({ valid: true, points: 0, value: 0 });
});

// ─── getConfig ───────────────────────────────────────────────────────────────

describe('getConfig', () => {
  test('returns 200 with the branch loyalty config', async () => {
    svc.getConfig.mockResolvedValue(sampleConfig());
    const res = mockRes();
    await controller.getConfig(mockReq(), res);

    expect(svc.getConfig).toHaveBeenCalledWith(BRANCH_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Loyalty settings',
        data: expect.objectContaining({ enabled: true }),
      })
    );
  });

  test('returns 500 when the service throws', async () => {
    svc.getConfig.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await controller.getConfig(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'db down' })
    );
  });
});

// ─── saveConfig ──────────────────────────────────────────────────────────────

describe('saveConfig', () => {
  test('returns 200 with the saved config', async () => {
    svc.saveConfig.mockResolvedValue(sampleConfig());
    const res = mockRes();
    await controller.saveConfig(mockReq({ body: { enabled: true } }), res);

    expect(svc.saveConfig).toHaveBeenCalledWith(BRANCH_ID, { enabled: true }, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Loyalty settings saved' })
    );
  });

  test('returns 401 when user lacks customer write access', async () => {
    const res = mockRes();
    await controller.saveConfig(
      mockReq({ user: { access: { customer: { write: false } } }, body: { enabled: true } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.saveConfig).not.toHaveBeenCalled();
  });
});

// ─── summary ───────────────────────────────────────────────────────────────────

describe('summary', () => {
  test('returns 200 with the customer summary when the service succeeds', async () => {
    svc.summary.mockResolvedValue({
      status: true,
      data: { balance: 120, tier: 'Silver', ledger: [] },
      message: 'Loyalty summary',
    });
    const res = mockRes();
    await controller.summary(mockReq({ params: { id: CUSTOMER_ID }, query: { limit: '5' } }), res);

    expect(svc.summary).toHaveBeenCalledWith(CUSTOMER_ID, BRANCH_ID, { limit: '5' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Loyalty summary',
        data: expect.objectContaining({ balance: 120, tier: 'Silver' }),
      })
    );
  });

  test('returns 404 when the customer is not found', async () => {
    svc.summary.mockResolvedValue({ status: false, message: 'Customer not found' });
    const res = mockRes();
    await controller.summary(mockReq({ params: { id: CUSTOMER_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Customer not found' })
    );
  });
});

// ─── liability ─────────────────────────────────────────────────────────────────

describe('liability', () => {
  test('returns 200 with the liability report', async () => {
    svc.liability.mockResolvedValue({
      status: true,
      data: { totalPoints: 500, totalValue: 500, byTier: [] },
      message: 'Loyalty liability',
    });
    const res = mockRes();
    await controller.liability(mockReq(), res);

    expect(svc.liability).toHaveBeenCalledWith(BRANCH_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Loyalty liability',
        data: expect.objectContaining({ totalPoints: 500 }),
      })
    );
  });

  test('returns 401 when user lacks customer read access', async () => {
    const res = mockRes();
    await controller.liability(mockReq({ user: { access: { customer: { read: false } } } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.liability).not.toHaveBeenCalled();
  });
});

// ─── preview ───────────────────────────────────────────────────────────────────

describe('preview', () => {
  test('returns 200 with earn and redeem previews', async () => {
    svc.getConfig.mockResolvedValue(sampleConfig());
    LoyaltyService.computeEarn.mockReturnValue({ points: 10, tier: { name: 'Silver' } });
    LoyaltyService.computeRedeem.mockReturnValue({ valid: true, points: 50, value: 50 });
    const res = mockRes();
    await controller.preview(
      mockReq({
        body: { amount: 1000, redeemPoints: 50, billTotal: 1000, availablePoints: 200 },
      }),
      res
    );

    expect(LoyaltyService.computeEarn).toHaveBeenCalled();
    expect(LoyaltyService.computeRedeem).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Loyalty preview',
        data: expect.objectContaining({
          earn: { points: 10, tier: 'Silver' },
          redeem: expect.objectContaining({ points: 50, value: 50 }),
          currency: 'INR',
          enabled: true,
        }),
      })
    );
  });

  test('leaves redeem null when redeemPoints is not supplied', async () => {
    svc.getConfig.mockResolvedValue(sampleConfig());
    LoyaltyService.computeEarn.mockReturnValue({ points: 3, tier: { name: 'Bronze' } });
    const res = mockRes();
    await controller.preview(mockReq({ body: { amount: 300 } }), res);

    expect(LoyaltyService.computeRedeem).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.redeem).toBeNull();
    expect(payload.data.earn).toEqual({ points: 3, tier: 'Bronze' });
  });

  test('returns 401 when user lacks customer read access', async () => {
    const res = mockRes();
    await controller.preview(
      mockReq({ user: { access: { customer: { read: false } } }, body: { amount: 100 } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.getConfig).not.toHaveBeenCalled();
  });
});
