/**
 * Unit (REST-layer) tests for CashbackController.
 * Covers getSettings, saveSettings (+ 401 guard), recent. Mocks CashbackService.
 */

const mockService = {
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
  recent: jest.fn(),
};

jest.mock('../../../src/services/cashback.service', () =>
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

const cashbackController = require('../../../src/controllers/cashback.controller');

function mockRes() {
  const res = { statusCode: 200, body: null };
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

describe('CashbackController', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getSettings returns settings', async () => {
    mockService.getSettings.mockResolvedValue({ enabled: true, percent: 10 });
    const res = mockRes();
    await cashbackController.getSettings(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.percent).toBe(10);
  });

  test('saveSettings saves for an authorised user', async () => {
    mockService.saveSettings.mockResolvedValue({ enabled: true, percent: 10 });
    const res = mockRes();
    await cashbackController.saveSettings(mockReq({ body: { percent: 10 } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockService.saveSettings).toHaveBeenCalled();
  });

  test('saveSettings is refused without branch write', async () => {
    const res = mockRes();
    await cashbackController.saveSettings(
      mockReq({ user: { access: { branch: { write: false } } } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(mockService.saveSettings).not.toHaveBeenCalled();
  });

  test('recent lists issued cashback', async () => {
    mockService.recent.mockResolvedValue({
      data: [{ code: 'CBABC123', amount: 40 }],
      message: 'ok',
    });
    const res = mockRes();
    await cashbackController.recent(mockReq({ query: { limit: '10' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
