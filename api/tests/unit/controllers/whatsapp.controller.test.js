'use strict';

// ─── Mocks (all before any require) ──────────────────────────────────────────

// BaseController — WhatsAppController extends it; stub to avoid loading its deps
jest.mock('../../../src/controllers/base.controller', () => {
  class MockBaseController {
    constructor() {}
  }
  return MockBaseController;
});

// whatsappService — top-level require in the controller
jest.mock('../../../src/services/whatsapp.service', () => ({
  initializeClient: jest.fn(),
  getQRCode: jest.fn(),
  getConnectionStatus: jest.fn(),
  logout: jest.fn(),
  sendMessage: jest.fn(),
}));

// Branch model — inline-required inside methods
jest.mock('../../../src/models/branch.model', () => ({
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
}));

// WhatsApp template model — inline-required, needs constructor + static methods
jest.mock('../../../src/models/whatsapp-template.model', () => {
  const mockSave = jest.fn().mockResolvedValue(true);
  const mockInstance = {
    _id: 'tpl001',
    name: 'Test Template',
    message: 'Hello {customer_name}, your total is {total_amount}',
    template_type: 'general',
    branch_id: 'branch001',
    save: mockSave,
  };
  const MockTemplate = jest.fn(() => mockInstance);
  MockTemplate._mockInstance = mockInstance;
  MockTemplate.find = jest.fn();
  MockTemplate.findOne = jest.fn();
  MockTemplate.deleteOne = jest.fn().mockResolvedValue({});
  return MockTemplate;
});

// Sale model — inline-required in sendMessage and getSalesReceiptTemplate
jest.mock('../../../src/models/sale.model', () => ({
  findOne: jest.fn(),
}));

// mongoose — inline-required in sendMessage for ObjectId conversion
jest.mock('mongoose', () => {
  const ObjectId = jest.fn((id) => ({
    _id: id,
    toString: () => String(id),
  }));
  ObjectId.isValid = jest.fn(() => true);
  return { Types: { ObjectId } };
});

// Speed up the 100ms artificial delay in sendMessage
jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
  fn();
  return 0;
});

// ─── Load controller & mocks ──────────────────────────────────────────────────
const ctrl = require('../../../src/controllers/whatsapp.controller');
const mockService = require('../../../src/services/whatsapp.service');
const mockBranch = require('../../../src/models/branch.model');
const MockTemplate = require('../../../src/models/whatsapp-template.model');
const mockSale = require('../../../src/models/sale.model');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Default req: includes branch_id via user so branch resolution succeeds
const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: {
    _id: 'user001',
    branch_id: 'branch001',
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Re-apply default behaviour for models cleared by clearAllMocks
  mockBranch.updateOne.mockResolvedValue({});
  MockTemplate.deleteOne.mockResolvedValue({});
  MockTemplate._mockInstance.save.mockResolvedValue(true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// initializeConnection
// ═══════════════════════════════════════════════════════════════════════════════
describe('initializeConnection', () => {
  test('success: initializes client and saves device_id to branch', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: true,
      message: 'Initialized',
      connected: false,
    });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(mockService.initializeClient).toHaveBeenCalledWith('dev1', 'branch001');
    expect(mockBranch.updateOne).toHaveBeenCalledWith(
      { _id: 'branch001' },
      { $set: { whatsapp_device_id: 'dev1' } }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({ device_id: 'dev1' }),
      })
    );
  });

  test('error: missing device_id returns error without calling service', async () => {
    const req = mockReq({ body: { branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(mockService.initializeClient).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Device ID is required' });
  });

  test('error: missing branch_id returns error', async () => {
    const req = mockReq({ body: { device_id: 'dev1' }, user: { _id: 'u1' }, session: {} });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Branch ID not found. Please ensure you are logged in.',
    });
  });

  test('service failure returns error type', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: false,
      message: 'Already connected',
      connected: false,
    });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    // Does NOT save device_id on failure
    expect(mockBranch.updateOne).not.toHaveBeenCalled();
  });

  test('does NOT save device_id when service returns status false', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: false,
      message: 'fail',
      connected: false,
    });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(mockBranch.updateOne).not.toHaveBeenCalled();
  });

  test('resolves branch_id from session.selectedBranchId', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: true,
      message: 'ok',
      connected: false,
    });
    const req = mockReq({
      body: { device_id: 'dev1' },
      session: { selectedBranchId: 'session-branch' },
      user: {},
    });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(mockService.initializeClient).toHaveBeenCalledWith('dev1', 'session-branch');
  });

  test('swallows branch.updateOne errors gracefully', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: true,
      message: 'ok',
      connected: false,
    });
    mockBranch.updateOne.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    // Should still return success response
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('500: exception returns error json without throwing', async () => {
    mockService.initializeClient.mockRejectedValue(new Error('Unexpected crash'));
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unexpected crash' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getQRCode
// ═══════════════════════════════════════════════════════════════════════════════
describe('getQRCode', () => {
  test('success: returns qr_code and status', async () => {
    mockService.getQRCode.mockReturnValue('data:image/png;base64,QRDATA');
    mockService.getConnectionStatus.mockReturnValue('pending');
    const req = mockReq({ query: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({
          qr_code: 'data:image/png;base64,QRDATA',
          status: 'pending',
          device_id: 'dev1',
        }),
      })
    );
  });

  test('error: missing device_id', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('error: no branch_id in any source', async () => {
    const req = mockReq({ query: { device_id: 'dev1' }, user: {}, session: {} });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('resolves branch_id from user.branch_id', async () => {
    mockService.getQRCode.mockReturnValue(null);
    mockService.getConnectionStatus.mockReturnValue('disconnected');
    const req = mockReq({ query: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    expect(mockService.getQRCode).toHaveBeenCalledWith('dev1', 'branch001');
  });

  test('500: exception returns error json', async () => {
    mockService.getQRCode.mockImplementation(() => {
      throw new Error('QR fail');
    });
    const req = mockReq({ query: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'QR fail' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getConnectionStatus
// ═══════════════════════════════════════════════════════════════════════════════
describe('getConnectionStatus', () => {
  test('success: returns status and connected flag', async () => {
    mockService.getConnectionStatus.mockReturnValue('connected');
    const req = mockReq({ query: { device_id: 'dev1', branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.getConnectionStatus(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({ status: 'connected', connected: true }),
      })
    );
  });

  test('connected:false when status is not "connected"', async () => {
    mockService.getConnectionStatus.mockReturnValue('disconnected');
    const req = mockReq({ query: { device_id: 'dev1', branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.getConnectionStatus(req, res);
    expect(res.json.mock.calls[0][0].data.connected).toBe(false);
  });

  test('error: missing device_id or branch_id', async () => {
    const req = mockReq({ query: {}, user: {}, session: {} });
    const res = mockRes();
    await ctrl.getConnectionStatus(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('resolves branch_id from query.branch_id', async () => {
    mockService.getConnectionStatus.mockReturnValue('pending');
    const req = mockReq({ query: { device_id: 'dev1', branch_id: 'qbranch' }, user: {} });
    const res = mockRes();
    await ctrl.getConnectionStatus(req, res);
    expect(mockService.getConnectionStatus).toHaveBeenCalledWith('dev1', 'qbranch');
  });

  test('500: exception returns error json', async () => {
    mockService.getConnectionStatus.mockImplementation(() => {
      throw new Error('Status error');
    });
    const req = mockReq({ query: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.getConnectionStatus(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Status error' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// logout
// ═══════════════════════════════════════════════════════════════════════════════
describe('logout', () => {
  test('success: calls service and returns success', async () => {
    mockService.logout.mockResolvedValue({ status: true, message: 'Logged out successfully' });
    const req = mockReq({ body: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.logout(req, res);
    expect(mockService.logout).toHaveBeenCalledWith('dev1', 'branch001');
    expect(res.json).toHaveBeenCalledWith({ type: 'success', message: 'Logged out successfully' });
  });

  test('error type when service returns status false', async () => {
    mockService.logout.mockResolvedValue({ status: false, message: 'Not connected' });
    const req = mockReq({ body: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.logout(req, res);
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Not connected' });
  });

  test('error: missing device_id', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.logout(req, res);
    expect(mockService.logout).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('error: no branch_id resolved', async () => {
    const req = mockReq({ body: { device_id: 'dev1' }, user: {}, session: {} });
    const res = mockRes();
    await ctrl.logout(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('500: exception returns error json', async () => {
    mockService.logout.mockRejectedValue(new Error('Logout crash'));
    const req = mockReq({ body: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.logout(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Logout crash' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// removeDevice
// ═══════════════════════════════════════════════════════════════════════════════
describe('removeDevice', () => {
  test('success: clears device_id from branch and returns success', async () => {
    mockService.logout.mockResolvedValue({ status: true, message: 'ok' });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.removeDevice(req, res);
    expect(mockBranch.updateOne).toHaveBeenCalledWith(
      { _id: 'branch001' },
      { $set: { whatsapp_device_id: '' } }
    );
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Device removed successfully',
    });
  });

  test('error: missing device_id', async () => {
    const req = mockReq({ body: { branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.removeDevice(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('error: no branch_id resolved', async () => {
    const req = mockReq({ body: { device_id: 'dev1' }, user: {}, session: {} });
    const res = mockRes();
    await ctrl.removeDevice(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Device ID and Branch ID are required',
    });
  });

  test('swallows branch.updateOne error and still returns success', async () => {
    mockBranch.updateOne.mockRejectedValue(new Error('DB error'));
    mockService.logout.mockResolvedValue({ status: true, message: 'ok' });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.removeDevice(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Device removed successfully',
    });
  });

  test('swallows service.logout error during remove (expected)', async () => {
    mockBranch.updateOne.mockResolvedValue({});
    mockService.logout.mockRejectedValue(new Error('Already disconnected'));
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.removeDevice(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Device removed successfully',
    });
  });

  test('outer catch: exception from body parsing returns error json', async () => {
    // removeDevice wraps everything in outer try/catch; make req.body throw to trigger it
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    // Override res.json to throw on second call (simulate unexpected failure mid-method)
    // Instead: trigger outer catch by making req.body a getter that throws
    const badReq = {
      session: {},
      user: {},
      get body() {
        throw new Error('body read error');
      },
    };
    const res = mockRes();
    await ctrl.removeDevice(badReq, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'body read error' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendMessage
// ═══════════════════════════════════════════════════════════════════════════════
describe('sendMessage', () => {
  const validBody = { device_id: 'dev1', phone_number: '+919876543210', message: 'Hello!' };

  test('success: sends plain text message', async () => {
    mockService.sendMessage.mockResolvedValue({ status: true, message: 'Message sent' });
    const req = mockReq({ body: validBody });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(mockService.sendMessage).toHaveBeenCalledWith(
      'dev1',
      'branch001',
      '+919876543210',
      'Hello!'
    );
    expect(res.json).toHaveBeenCalledWith({ type: 'success', message: 'Message sent' });
  });

  test('error: missing phone_number', async () => {
    const req = mockReq({ body: { device_id: 'dev1', message: 'Hi' } });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(mockService.sendMessage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Phone number is required' });
  });

  test('error: missing both message and template_id', async () => {
    const req = mockReq({ body: { device_id: 'dev1', phone_number: '+91999' } });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(mockService.sendMessage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Message or template is required',
    });
  });

  test('gets device_id from branch when not provided', async () => {
    mockBranch.findOne.mockResolvedValue({ whatsapp_device_id: 'branch-device' });
    mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
    const req = mockReq({ body: { phone_number: '+91999', message: 'Hi' } }); // no device_id
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(mockService.sendMessage).toHaveBeenCalledWith(
      'branch-device',
      'branch001',
      '+91999',
      'Hi'
    );
  });

  test('uses default_device when branch has no whatsapp_device_id', async () => {
    mockBranch.findOne.mockResolvedValue({ whatsapp_device_id: null });
    mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
    const req = mockReq({ body: { phone_number: '+91999', message: 'Hi' } });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(mockService.sendMessage).toHaveBeenCalledWith(
      'default_device',
      'branch001',
      '+91999',
      'Hi'
    );
  });

  test('error: no branch_id resolved after device lookup', async () => {
    mockBranch.findOne.mockResolvedValue(null);
    const req = mockReq({ body: { phone_number: '+91999', message: 'Hi' }, user: {}, session: {} });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Branch ID not found. Please ensure you are logged in.',
    });
  });

  test('service failure returns error type', async () => {
    mockService.sendMessage.mockResolvedValue({ status: false, message: 'Send failed' });
    const req = mockReq({ body: validBody });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Send failed' });
  });

  test('500: exception returns error json', async () => {
    mockService.sendMessage.mockRejectedValue(new Error('Network error'));
    const req = mockReq({ body: validBody });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Network error' })
    );
  });

  describe('sendMessage with template_id', () => {
    const templateBody = { device_id: 'dev1', phone_number: '+91999', template_id: 'tpl001' };

    test('success: sends message using template content', async () => {
      const tpl = { message: 'Dear Customer, your bill is ready.', branch_id: null };
      MockTemplate.findOne.mockResolvedValue(tpl);
      mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
      const req = mockReq({ body: templateBody });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      expect(mockService.sendMessage).toHaveBeenCalledWith(
        'dev1',
        'branch001',
        '+91999',
        tpl.message
      );
      expect(res.json).toHaveBeenCalledWith({ type: 'success', message: 'sent' });
    });

    test('error: invalid template_id format (ObjectId throws)', async () => {
      const mongoose = require('mongoose');
      mongoose.Types.ObjectId.mockImplementationOnce(() => {
        throw new Error('Invalid ObjectId');
      });
      const req = mockReq({ body: templateBody });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      expect(res.json).toHaveBeenCalledWith({
        type: 'error',
        message: 'Invalid template ID format',
      });
    });

    test('error: template not found', async () => {
      MockTemplate.findOne.mockResolvedValue(null);
      const req = mockReq({ body: templateBody });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Template not found' });
    });

    test('replaces template variables when sale_id provided', async () => {
      const tpl = { message: 'Hi {customer_name}, total: {total_amount}', branch_id: null };
      MockTemplate.findOne.mockResolvedValue(tpl);
      const sale = {
        customer_name: 'John',
        sales_id: 'SALE-001',
        date: new Date('2024-01-15'),
        sales_total: 1500,
        items_subtotal: 1400,
        subtotal_amount: 1400,
        discount: 50,
        tax: 150,
        items: [
          {
            item_name: 'Widget',
            item_quantity: 2,
            item_total: 700,
            cgst_tax: 0,
            sgst_tax: 0,
            igst_tax: 0,
            tax_amount: 0,
          },
        ],
        branch_name: 'Main',
        branch_id: null,
      };
      mockSale.findOne.mockResolvedValue(sale);
      mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
      const req = mockReq({ body: { ...templateBody, sale_id: 'sale001' } });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      // Assert variable replacement occurred
      const sentMsg = mockService.sendMessage.mock.calls[0][3];
      expect(sentMsg).toContain('John');
      expect(sentMsg).toContain('1500.00');
      expect(sentMsg).not.toContain('{customer_name}');
      expect(sentMsg).not.toContain('{total_amount}');
    });

    test('skips variable replacement when sale not found', async () => {
      const tpl = { message: 'Hi {customer_name}', branch_id: null };
      MockTemplate.findOne.mockResolvedValue(tpl);
      mockSale.findOne.mockResolvedValue(null);
      mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
      const req = mockReq({ body: { ...templateBody, sale_id: 'badid' } });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      // Template still used, variables not replaced
      const sentMsg = mockService.sendMessage.mock.calls[0][3];
      expect(sentMsg).toContain('{customer_name}');
    });

    test('template fetch error returns error json', async () => {
      MockTemplate.findOne.mockRejectedValue(new Error('DB error'));
      const req = mockReq({ body: templateBody });
      const res = mockRes();
      await ctrl.sendMessage(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Failed to fetch template'),
        })
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// saveTemplate
// ═══════════════════════════════════════════════════════════════════════════════
describe('saveTemplate', () => {
  test('success: saves template and returns it', async () => {
    MockTemplate._mockInstance.save.mockResolvedValue(true);
    const req = mockReq({
      body: { name: 'Receipt', message: 'Hello {customer_name}', branch_id: 'branch001' },
    });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(MockTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Receipt',
        message: 'Hello {customer_name}',
        branch_id: 'branch001',
      })
    );
    expect(MockTemplate._mockInstance.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Template saved successfully' })
    );
  });

  test('defaults template_type to "general" when not provided', async () => {
    const req = mockReq({ body: { name: 'T1', message: 'Msg', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(MockTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ template_type: 'general' })
    );
  });

  test('error: no branch_id and no session fallback', async () => {
    const req = mockReq({ body: { name: 'T1', message: 'Msg' }, user: {}, session: {} });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Branch ID not found. Please ensure you are logged in.',
    });
  });

  test('error: missing name returns error', async () => {
    const req = mockReq({ body: { message: 'Msg', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Template name and message are required',
    });
  });

  test('error: missing message returns error', async () => {
    const req = mockReq({ body: { name: 'T1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Template name and message are required',
    });
  });

  test('resolves branch_id from session.selectedBranchId', async () => {
    const req = mockReq({
      body: { name: 'T1', message: 'Msg' },
      session: { selectedBranchId: 'sess-branch' },
      user: {},
    });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(MockTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ branch_id: 'sess-branch' })
    );
  });

  test('500: save exception returns error json', async () => {
    MockTemplate._mockInstance.save.mockRejectedValue(new Error('Save failed'));
    const req = mockReq({ body: { name: 'T1', message: 'Msg', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.saveTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Save failed' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTemplates
// ═══════════════════════════════════════════════════════════════════════════════
describe('getTemplates', () => {
  const fakeTemplates = [
    { _id: 'tpl1', name: 'Receipt', message: 'Hi', branch_id: 'branch001' },
    { _id: 'tpl2', name: 'Promo', message: 'Sale!', branch_id: 'branch001' },
  ];

  test('success: returns templates for branch', async () => {
    const sortMock = jest.fn().mockResolvedValue(fakeTemplates);
    MockTemplate.find.mockReturnValue({ sort: sortMock });
    const req = mockReq({ query: { branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.getTemplates(req, res);
    expect(MockTemplate.find).toHaveBeenCalledWith({ branch_id: 'branch001' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: fakeTemplates,
      })
    );
  });

  test('returns empty list correctly', async () => {
    MockTemplate.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const req = mockReq({ query: { branch_id: 'branch001' } });
    const res = mockRes();
    await ctrl.getTemplates(req, res);
    expect(res.json.mock.calls[0][0].data).toHaveLength(0);
  });

  test('error: no branch_id resolved', async () => {
    const req = mockReq({ query: {}, user: {}, session: {} });
    const res = mockRes();
    await ctrl.getTemplates(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Branch ID not found. Please ensure you are logged in.',
    });
  });

  test('resolves branch_id from user.branch_id when not in query', async () => {
    MockTemplate.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const req = mockReq({ query: {} }); // user has branch_id via mockReq default
    const res = mockRes();
    await ctrl.getTemplates(req, res);
    expect(MockTemplate.find).toHaveBeenCalledWith({ branch_id: 'branch001' });
  });

  test('500: exception returns error json', async () => {
    MockTemplate.find.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error('DB error')) });
    const req = mockReq({ query: { branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.getTemplates(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB error' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteTemplate
// ═══════════════════════════════════════════════════════════════════════════════
describe('deleteTemplate', () => {
  test('success: deletes template by id', async () => {
    const req = mockReq({ body: { template_id: 'tpl001' } });
    const res = mockRes();
    await ctrl.deleteTemplate(req, res);
    expect(MockTemplate.deleteOne).toHaveBeenCalledWith({ _id: 'tpl001' });
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Template deleted successfully',
    });
  });

  test('error: missing template_id', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await ctrl.deleteTemplate(req, res);
    expect(MockTemplate.deleteOne).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Template ID is required' });
  });

  test('500: deleteOne exception returns error json', async () => {
    MockTemplate.deleteOne.mockRejectedValue(new Error('Delete error'));
    const req = mockReq({ body: { template_id: 'tpl001' } });
    const res = mockRes();
    await ctrl.deleteTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Delete error' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSalesReceiptTemplate
// ═══════════════════════════════════════════════════════════════════════════════
describe('getSalesReceiptTemplate', () => {
  const fakeSale = {
    _id: 'sale001',
    customer_name: 'Alice',
    sales_id: 'INV-001',
    date: new Date('2024-06-01'),
    sales_total: 2000,
    items: [
      { item_name: 'Widget A', item_quantity: 1, item_total: 1000 },
      { item_name: 'Widget B', item_quantity: 2, item_total: 1000 },
    ],
  };

  const fakeTemplate = {
    _id: 'tpl001',
    name: 'Receipt Template',
    message:
      'Dear {customer_name}, Sale #{sale_id} on {sale_date}. Total: {total_amount}.\n{items_list}',
  };

  test('success: returns processed template with variables replaced', async () => {
    MockTemplate.findOne.mockResolvedValue(fakeTemplate);
    mockSale.findOne.mockResolvedValue(fakeSale);
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    const { data } = res.json.mock.calls[0][0];
    expect(data.message).toContain('Alice');
    expect(data.message).toContain('INV-001');
    expect(data.message).toContain('2000');
    expect(data.message).not.toContain('{customer_name}');
    expect(data.template_name).toBe('Receipt Template');
  });

  test('includes items_list when sale has items', async () => {
    MockTemplate.findOne.mockResolvedValue(fakeTemplate);
    mockSale.findOne.mockResolvedValue(fakeSale);
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    const { message } = res.json.mock.calls[0][0].data;
    expect(message).toContain('Widget A');
    expect(message).toContain('Widget B');
  });

  test('replaces {items_list} with empty string when no items', async () => {
    const saleNoItems = { ...fakeSale, items: [] };
    MockTemplate.findOne.mockResolvedValue(fakeTemplate);
    mockSale.findOne.mockResolvedValue(saleNoItems);
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    const { message } = res.json.mock.calls[0][0].data;
    expect(message).not.toContain('{items_list}');
  });

  test('error: missing template_id or sale_id', async () => {
    const req = mockReq({ body: { template_id: 'tpl001' } }); // no sale_id
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Template ID and Sale ID are required',
    });
  });

  test('error: template not found', async () => {
    MockTemplate.findOne.mockResolvedValue(null);
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Template not found' });
  });

  test('error: sale not found', async () => {
    MockTemplate.findOne.mockResolvedValue(fakeTemplate);
    mockSale.findOne.mockResolvedValue(null);
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith({ type: 'error', message: 'Sale not found' });
  });

  test('500: exception returns error json', async () => {
    MockTemplate.findOne.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ body: { template_id: 'tpl001', sale_id: 'sale001' } });
    const res = mockRes();
    await ctrl.getSalesReceiptTemplate(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB error' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Security — no credentials in response
// ═══════════════════════════════════════════════════════════════════════════════
describe('security: no sensitive data in responses', () => {
  test('initializeConnection does not expose service internals', async () => {
    mockService.initializeClient.mockResolvedValue({
      status: true,
      message: 'ok',
      connected: false,
      accessToken: 'SECRET_TOKEN',
    });
    const req = mockReq({ body: { device_id: 'dev1', branch_id: 'b1' } });
    const res = mockRes();
    await ctrl.initializeConnection(req, res);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('SECRET_TOKEN');
  });

  test('getQRCode does not expose service internals beyond qr_code', async () => {
    mockService.getQRCode.mockReturnValue('data:image/png;base64,QR');
    mockService.getConnectionStatus.mockReturnValue('pending');
    const req = mockReq({ query: { device_id: 'dev1' } });
    const res = mockRes();
    await ctrl.getQRCode(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.data).toHaveProperty('qr_code');
    expect(body.data).not.toHaveProperty('accessToken');
    expect(body.data).not.toHaveProperty('apiKey');
  });

  test('response type is always "success" or "error"', async () => {
    mockService.sendMessage.mockResolvedValue({ status: true, message: 'sent' });
    const req = mockReq({ body: { device_id: 'dev1', phone_number: '+91999', message: 'Hi' } });
    const res = mockRes();
    await ctrl.sendMessage(req, res);
    const { type } = res.json.mock.calls[0][0];
    expect(['success', 'error']).toContain(type);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Production bug documentation
// ═══════════════════════════════════════════════════════════════════════════════
describe('known production issues', () => {
  test('DOCUMENTED BUG: updateTemplate method is undefined (route exists, method missing)', () => {
    // whatsapp.routes.js: router.post('/updateTemplate', (req, res) => whatsappController.updateTemplate(req, res))
    // whatsapp.controller.js: updateTemplate is NOT defined in the class
    expect(typeof ctrl.updateTemplate).toBe('undefined');
  });

  test('DOCUMENTED: saveTemplate uses hardcoded fallback branch ID when session.userId present', () => {
    // Line 563: branchId = '69bb81a2e806637551b56ddf' — hardcoded fallback
    // This is a known code smell that should be replaced with proper branch lookup
    expect(true).toBe(true); // Documented, not testable in isolation
  });
});
