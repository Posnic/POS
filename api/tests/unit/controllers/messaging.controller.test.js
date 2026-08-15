/**
 * Unit tests for MessagingController
 *
 * Every endpoint holds the shop's SMS/WhatsApp provider secrets, so each one is
 * locked to a super admin via _isSuperAdmin(req). These tests cover, for every
 * method (providers, getSettings, saveSettings, test):
 *   (a) the super-admin success path, and
 *   (b) a non-super-admin caller getting 403.
 * test() also covers the service returning { status: false } -> 400.
 *
 * Mocked dependencies:
 *   MessagingService, BaseModel, base.service
 */

jest.mock('../../../src/services/messaging.service', () =>
  jest.fn().mockImplementation(() => ({
    providers: jest.fn(),
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
    test: jest.fn(),
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
    async checkPlan() {
      return 0;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

const controller = require('../../../src/controllers/messaging.controller');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const superAdminReq = (overrides = {}) => ({
  user: { usertype: 'super_admin', name: 'root' },
  body: {},
  params: {},
  query: {},
  ...overrides,
});

const cashierReq = (overrides = {}) => ({
  user: { usertype: 'cashier', name: 'joe' },
  body: {},
  params: {},
  query: {},
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
    providers: jest.fn(),
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
    test: jest.fn(),
  };
  controller.service = svc;
});

// ─── providers ────────────────────────────────────────────────────────────────

describe('providers', () => {
  const providerList = [
    { id: 'twilio', name: 'Twilio' },
    { id: 'msg91', name: 'MSG91' },
  ];

  test('returns 200 with the provider list for a super admin', async () => {
    svc.providers.mockReturnValue(providerList);
    const res = mockRes();
    await controller.providers(superAdminReq(), res);

    expect(svc.providers).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'SMS providers', data: providerList })
    );
  });

  test('works when the super-admin identity is on role instead of usertype', async () => {
    svc.providers.mockReturnValue(providerList);
    const res = mockRes();
    await controller.providers(superAdminReq({ user: { role: 'super_admin' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(svc.providers).toHaveBeenCalled();
  });

  test('returns 403 for a non-super-admin', async () => {
    const res = mockRes();
    await controller.providers(cashierReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Only a super admin can manage messaging settings',
      })
    );
    expect(svc.providers).not.toHaveBeenCalled();
  });
});

// ─── getSettings ────────────────────────────────────────────────────────────────

describe('getSettings', () => {
  const settings = { sms_enabled: true, sms_provider: 'twilio', sms_secrets_set: {} };

  test('returns 200 with the branch settings for a super admin', async () => {
    svc.getSettings.mockResolvedValue(settings);
    const res = mockRes();
    await controller.getSettings(superAdminReq(), res);

    expect(svc.getSettings).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Messaging settings', data: settings })
    );
  });

  test('returns 403 for a non-super-admin', async () => {
    const res = mockRes();
    await controller.getSettings(cashierReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Only a super admin can manage messaging settings',
      })
    );
    expect(svc.getSettings).not.toHaveBeenCalled();
  });
});

// ─── saveSettings ─────────────────────────────────────────────────────────────

describe('saveSettings', () => {
  const saved = { sms_enabled: true, sms_provider: 'msg91', sms_secrets_set: { api_key: true } };

  test('returns 200 with the saved settings for a super admin', async () => {
    svc.saveSettings.mockResolvedValue(saved);
    const res = mockRes();
    await controller.saveSettings(superAdminReq({ body: { sms_provider: 'msg91' } }), res);

    expect(svc.saveSettings).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Messaging settings saved',
        data: saved,
      })
    );
  });

  test('returns 403 for a non-super-admin', async () => {
    const res = mockRes();
    await controller.saveSettings(cashierReq({ body: { sms_provider: 'msg91' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Only a super admin can manage messaging settings',
      })
    );
    expect(svc.saveSettings).not.toHaveBeenCalled();
  });
});

// ─── test ─────────────────────────────────────────────────────────────────────

describe('test', () => {
  test('returns 200 when the service reports the test message was sent', async () => {
    svc.test.mockResolvedValue({
      status: true,
      data: { ok: true, error: null },
      message: 'Test message sent',
    });
    const res = mockRes();
    await controller.test(superAdminReq({ body: { phone: '9999999999', channel: 'sms' } }), res);

    expect(svc.test).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Test message sent',
        data: { ok: true, error: null },
      })
    );
  });

  test('returns 400 when the service reports the test failed (status false)', async () => {
    svc.test.mockResolvedValue({
      status: false,
      data: { ok: false, error: 'bad credentials' },
      message: 'Test failed: bad credentials',
    });
    const res = mockRes();
    await controller.test(superAdminReq({ body: { phone: '9999999999' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Test failed: bad credentials',
        data: { ok: false, error: 'bad credentials' },
      })
    );
  });

  test('returns 403 for a non-super-admin', async () => {
    const res = mockRes();
    await controller.test(cashierReq({ body: { phone: '9999999999' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Only a super admin can manage messaging settings',
      })
    );
    expect(svc.test).not.toHaveBeenCalled();
  });
});
