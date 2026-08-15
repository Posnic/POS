/**
 * Unit (REST-layer) tests for CreditController.
 *
 * Methods covered: getSettings, saveSettings, outstanding, checkLimit,
 * sendReminder, runReminders — success paths plus the _canWrite 401 guards and
 * the sendReminder {status:false} -> 400 path.
 *
 * Mocked: CreditService, base.model.
 */

const mockService = {
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
  outstanding: jest.fn(),
  checkCreditLimit: jest.fn(),
  sendReminder: jest.fn(),
  runReminders: jest.fn(),
};

jest.mock('../../../src/services/credit.service', () =>
  jest.fn().mockImplementation(() => mockService)
);

jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

const creditController = require('../../../src/controllers/credit.controller');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b) => {
    res.body = b;
    return res;
  });
  return res;
}

function mockReq(over = {}) {
  return {
    user: { usertype: 'admin', name: 'Mgr', access: {} },
    tenantContext: { branchId: 'b1', branchName: 'Shop', currency: '₹' },
    params: {},
    query: {},
    body: {},
    ...over,
  };
}

describe('CreditController', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getSettings returns settings', async () => {
    mockService.getSettings.mockResolvedValue({ default_credit_limit: 5000 });
    const res = mockRes();
    await creditController.getSettings(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.default_credit_limit).toBe(5000);
  });

  test('saveSettings saves for an authorised user', async () => {
    mockService.saveSettings.mockResolvedValue({ default_credit_limit: 5000 });
    const res = mockRes();
    await creditController.saveSettings(mockReq({ body: { default_credit_limit: 5000 } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockService.saveSettings).toHaveBeenCalled();
  });

  test('saveSettings is refused without branch write', async () => {
    const res = mockRes();
    await creditController.saveSettings(
      mockReq({ user: { access: { branch: { write: false } } } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(mockService.saveSettings).not.toHaveBeenCalled();
  });

  test('outstanding lists debtors', async () => {
    mockService.outstanding.mockResolvedValue({
      data: [{ name: 'Asha', due: 500 }],
      message: 'ok',
    });
    const res = mockRes();
    await creditController.outstanding(mockReq({ query: { minDue: '100' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockService.outstanding).toHaveBeenCalledWith('b1', { minDue: 100 });
  });

  test('checkLimit returns the limit decision', async () => {
    mockService.checkCreditLimit.mockResolvedValue({ allowed: false, limit: 10000 });
    const res = mockRes();
    await creditController.checkLimit(
      mockReq({ query: { customerId: 'c1', amount: '5000' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.allowed).toBe(false);
    expect(mockService.checkCreditLimit).toHaveBeenCalledWith('c1', 5000, 'b1');
  });

  test('sendReminder sends for an authorised user', async () => {
    mockService.sendReminder.mockResolvedValue({
      status: true,
      data: { status: 'sent' },
      message: 'ok',
    });
    const res = mockRes();
    await creditController.sendReminder(mockReq({ params: { customerId: 'c1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockService.sendReminder).toHaveBeenCalled();
  });

  test('sendReminder returns 400 when the service reports failure', async () => {
    mockService.sendReminder.mockResolvedValue({ status: false, message: 'Customer not found' });
    const res = mockRes();
    await creditController.sendReminder(mockReq({ params: { customerId: 'x' } }), res);
    expect(res.statusCode).toBe(400);
  });

  test('sendReminder is refused without branch write', async () => {
    const res = mockRes();
    await creditController.sendReminder(
      mockReq({ user: { access: { branch: { write: false } } }, params: { customerId: 'c1' } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(mockService.sendReminder).not.toHaveBeenCalled();
  });

  test('runReminders runs for an authorised user', async () => {
    mockService.runReminders.mockResolvedValue({ data: { sent: 3 }, message: 'ok' });
    const res = mockRes();
    await creditController.runReminders(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.sent).toBe(3);
  });

  test('runReminders is refused without branch write', async () => {
    const res = mockRes();
    await creditController.runReminders(
      mockReq({ user: { access: { branch: { write: false } } } }),
      res
    );
    expect(res.statusCode).toBe(401);
  });
});
