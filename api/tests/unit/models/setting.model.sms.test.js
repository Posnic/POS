'use strict';
jest.mock('../../../src/services/sms.service', () => ({ sendSalesReceipt: jest.fn() }));
jest.mock('../../../src/services/messaging.service');
jest.mock('../../../src/services/receipt-document.service', () => ({ prepare: jest.fn() }));
const SettingModel = require('../../../src/models/setting.model');
const MessagingService = require('../../../src/services/messaging.service');
const legacy = require('../../../src/services/sms.service');
const receipt = require('../../../src/services/receipt-document.service');
const raw = jest.fn(),
  send = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  receipt.prepare.mockResolvedValue({ url: 'https://xbill.in/i/test-pdf' });
  MessagingService.mockImplementation(() => ({ _raw: raw, sendSms: send }));
});
const invoke = () =>
  SettingModel.prototype.salesSmsReceiptModel.call(
    { branchId: 'branch', licenseId: 'license', constructor: {}, user: {} },
    {
      customer_sms_id: 'sale',
      customer_sms_name: 'Sample',
      customer_sms_fullphone: '+919008427482',
    }
  );
test('receipt uses branch provider and named receipt parameters', async () => {
  raw.mockResolvedValue({ sms_provider: 'msg91' });
  send.mockResolvedValue({ ok: true });
  const result = await invoke();
  expect(raw).toHaveBeenCalledWith('branch');
  expect(receipt.prepare).toHaveBeenCalledWith('sale', 'branch');
  expect(send).toHaveBeenCalledWith('branch', '+919008427482', expect.any(String), {
    purpose: 'receipt',
    name: 'Sample',
    url: 'https://xbill.in/i/test-pdf',
  });
  expect(result.status).toBe(true);
  expect(result.data).toBe('accepted');
  expect(legacy.sendSalesReceipt).not.toHaveBeenCalled();
});
test('missing file storage does not send a broken receipt link', async () => {
  raw.mockResolvedValue({ sms_provider: 'vonage_messages' });
  receipt.prepare.mockResolvedValue({ url: null });
  expect(await invoke()).toMatchObject({
    status: false,
    message: expect.stringContaining('Receipt sharing is unavailable'),
  });
  expect(send).not.toHaveBeenCalled();
  expect(legacy.sendSalesReceipt).not.toHaveBeenCalled();
});
test('without storage, receipt uses the trusted shop viewer after outlet validation', async () => {
  raw.mockResolvedValue({ sms_provider: 'vonage_messages' });
  receipt.prepare.mockResolvedValue({ url: null });
  send.mockResolvedValue({ ok: true });
  const result = await SettingModel.prototype.salesSmsReceiptModel.call(
    {
      branchId: 'branch',
      licenseId: 'license',
      constructor: {},
      user: {},
      receiptPublicBase: 'https://shop.posnic.io',
    },
    {
      customer_sms_id: 'sale',
      customer_sms_name: 'Sample',
      customer_sms_fullphone: '+919008427482',
    }
  );
  expect(result.status).toBe(true);
  expect(send.mock.calls[0][3].url).toMatch(
    /^https:\/\/shop\.posnic\.io\/customersMailPrint\.html\?id=/
  );
  expect(receipt.prepare).toHaveBeenCalledWith('sale', 'branch');
});
test('shop rejection never falls back to a second sender', async () => {
  raw.mockResolvedValue({ sms_provider: 'msg91' });
  send.mockResolvedValue({ ok: false, error: 'SMS disabled' });
  expect(await invoke()).toMatchObject({ status: false, message: 'SMS disabled' });
  expect(legacy.sendSalesReceipt).not.toHaveBeenCalled();
});
test('existing platform receipt configuration remains available without shop provider', async () => {
  raw.mockResolvedValue({});
  legacy.sendSalesReceipt.mockResolvedValue({ status: true });
  expect(await invoke()).toMatchObject({ status: true });
  expect(legacy.sendSalesReceipt).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
