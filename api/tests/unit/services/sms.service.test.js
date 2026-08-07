'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('axios');

jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  const MockS3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  MockS3Client.__mockSend = mockSend;
  return {
    S3Client: MockS3Client,
    PutObjectCommand: jest.fn().mockImplementation((params) => params),
  };
});

jest.mock('../../../src/config/config', () => ({
  sms: {
    provider: 'msg91',
    msg91: {
      authKey: 'FAKE_MSG91_AUTH_KEY',
      templateId: 'FAKE_TEMPLATE_ID',
      apiUrl: 'https://mock.msg91.api/v5/flow',
    },
    brevo: {
      apiKey: 'FAKE_BREVO_API_KEY',
      sender: 'TESTSHOP',
    },
  },
  s3: {
    region: 'us-east-1',
    key: 'FAKE_S3_KEY',
    secret: 'FAKE_S3_SECRET',
    smsBucket: 'fake-sms-bucket',
  },
  encryption: { key: 'FAKE_ENC_KEY', iv: 'FAKE_IV' },
}));

jest.mock('../../../src/utils/encryption', () => ({
  generateEncryptedId: jest.fn().mockReturnValue('FAKE_ENC_ID'),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ─── Requires ─────────────────────────────────────────────────────────────────

const axios = require('axios');
const { S3Client } = require('@aws-sdk/client-s3');
const Encryption = require('../../../src/utils/encryption');
const smsService = require('../../../src/services/sms.service');

const mockS3Send = S3Client.__mockSend;

const makeData = (o = {}) => ({
  customer_sms_id: 'SALE_001',
  customer_sms_name: 'Test Customer',
  customer_sms_fullphone: '+919876543210',
  license: 'LIC_ABC',
  timezone: 'Asia/Kolkata',
  ...o,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    Encryption.generateEncryptedId.mockReturnValue('FAKE_ENC_ID');
    smsService.provider = 'msg91';
  });

  // ── sendSalesReceipt ─────────────────────────────────────────────────────────

  describe('sendSalesReceipt – msg91', () => {
    beforeEach(() => {
      smsService.provider = 'msg91';
    });

    test('returns status:true + delivered on MSG91 success', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r).toEqual({ status: true, data: 'delivered', message: 'Message has been sent' });
    });

    test('calls Encryption.generateEncryptedId with customer_sms_id', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSalesReceipt(makeData({ customer_sms_id: 'INV-42' }));
      expect(Encryption.generateEncryptedId).toHaveBeenCalledWith('INV-42');
    });

    test('returns status:false with provider error message', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: { type: 'error', message: 'Bad template' },
      });
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r.status).toBe(false);
      expect(r.message).toBe('Bad template');
    });

    test('uses MSG91 own fallback "MSG91 API error" when error has no message', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'error' } });
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r.status).toBe(false);
      // sendSmsViaMsg91 returns { error: 'MSG91 API error' } as its own fallback,
      // so errorDetails is truthy and 'SMS delivery failed' is never reached
      expect(r.message).toBe('MSG91 API error');
    });

    test('returns status:false when axios throws', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r.status).toBe(false);
    });
  });

  describe('sendSalesReceipt – brevo', () => {
    beforeEach(() => {
      smsService.provider = 'brevo';
    });

    test('returns status:true when Brevo delivers', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r).toEqual({ status: true, data: 'delivered', message: 'Message has been sent' });
    });

    test('returns status:false when Brevo does not deliver', async () => {
      axios.post.mockResolvedValue({ data: { status: 'failed' } });
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r.status).toBe(false);
      expect(r.data).toBe('failed');
    });

    test('returns status:false when Brevo throws', async () => {
      axios.post.mockRejectedValue(new Error('Timeout'));
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r.status).toBe(false);
    });
  });

  describe('sendSalesReceipt – unknown provider', () => {
    beforeEach(() => {
      smsService.provider = 'unknown';
    });

    test('returns no-provider error', async () => {
      const r = await smsService.sendSalesReceipt(makeData());
      expect(r).toEqual({
        status: false,
        data: null,
        message: 'No SMS provider configured (brevo or msg91)',
      });
    });

    test('calls S3 log with no_provider status', async () => {
      await smsService.sendSalesReceipt(makeData());
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(body.status).toBe('no_provider');
    });

    test('S3 log body contains phone and licenseId', async () => {
      await smsService.sendSalesReceipt(
        makeData({ customer_sms_fullphone: '+911111111111', license: 'LIC_X' })
      );
      const body = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(body.phone_number).toBe('+911111111111');
      expect(body.client_id).toBe('LIC_X');
    });

    test('does not call axios.post', async () => {
      await smsService.sendSalesReceipt(makeData());
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('sendSalesReceipt – catch path', () => {
    test('returns {status:false,data:null,message} when encryption throws', async () => {
      Encryption.generateEncryptedId.mockImplementation(() => {
        throw new Error('Enc fail');
      });
      smsService.provider = 'msg91';
      expect(await smsService.sendSalesReceipt(makeData())).toEqual({
        status: false,
        data: null,
        message: 'Enc fail',
      });
    });

    test('API keys are not returned in success response', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      smsService.provider = 'msg91';
      const r = JSON.stringify(await smsService.sendSalesReceipt(makeData()));
      expect(r).not.toContain('FAKE_MSG91_AUTH_KEY');
      expect(r).not.toContain('FAKE_BREVO_API_KEY');
      expect(r).not.toContain('FAKE_S3_KEY');
    });

    test('API keys are not returned in error response', async () => {
      axios.post.mockRejectedValue(new Error('fail'));
      smsService.provider = 'brevo';
      const r = JSON.stringify(await smsService.sendSalesReceipt(makeData()));
      expect(r).not.toContain('FAKE_BREVO_API_KEY');
    });
  });

  // ── sendSmsViaBrevo ──────────────────────────────────────────────────────────

  describe('sendSmsViaBrevo', () => {
    test('returns "delivered" when Brevo responds with status:delivered', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      expect(await smsService.sendSmsViaBrevo(makeData(), 'ENC')).toBe('delivered');
    });

    test('returns "failed" when Brevo responds with non-delivered status', async () => {
      axios.post.mockResolvedValue({ data: { status: 'rejected' } });
      expect(await smsService.sendSmsViaBrevo(makeData(), 'ENC')).toBe('failed');
    });

    test('returns "failed" when response has no status field', async () => {
      axios.post.mockResolvedValue({ data: {} });
      expect(await smsService.sendSmsViaBrevo(makeData(), 'ENC')).toBe('failed');
    });

    test('returns "failed" on network error', async () => {
      axios.post.mockRejectedValue(new Error('timeout'));
      expect(await smsService.sendSmsViaBrevo(makeData(), 'ENC')).toBe('failed');
    });

    test('posts to correct Brevo API URL', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][0]).toBe('https://api.brevo.com/v3/transactionalSMS/sms');
    });

    test('uses api-key from config in headers', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][2].headers['api-key']).toBe('FAKE_BREVO_API_KEY');
    });

    test('payload has correct sender, recipient, type', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(
        makeData({ customer_sms_fullphone: '+917777777777' }),
        'ENC'
      );
      const payload = axios.post.mock.calls[0][1];
      expect(payload.sender).toBe('TESTSHOP');
      expect(payload.recipient).toBe('+917777777777');
      expect(payload.type).toBe('transactional');
    });

    test('content includes customer name and encrypted ID', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData({ customer_sms_name: 'Alice' }), 'ENC_ABC');
      const content = axios.post.mock.calls[0][1].content;
      expect(content).toContain('Alice');
      expect(content).toContain('ENC_ABC');
    });

    test('raw sale ID not included in content URL', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData({ customer_sms_id: 'RAW_ID' }), 'SAFE_ENC');
      const content = axios.post.mock.calls[0][1].content;
      expect(content).not.toContain('RAW_ID');
    });

    test('sets 30-second timeout', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][2].timeout).toBe(30000);
    });

    test('resolves (does not throw) on any error', async () => {
      axios.post.mockRejectedValue({ response: { data: { message: 'Bad key' } }, message: '401' });
      await expect(smsService.sendSmsViaBrevo(makeData(), 'ENC')).resolves.toBe('failed');
    });
  });

  // ── sendSmsViaMsg91 ──────────────────────────────────────────────────────────

  describe('sendSmsViaMsg91', () => {
    test('returns "delivered" on 200 + type:success', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      expect(await smsService.sendSmsViaMsg91(makeData(), 'ENC')).toBe('delivered');
    });

    test('returns failed object on 200 + type:error', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'error', message: 'Bad auth' } });
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.status).toBe('failed');
      expect(r.error).toBe('Bad auth');
      expect(r.errorType).toBe('error');
    });

    test('returns failed object on non-200 response', async () => {
      axios.post.mockResolvedValue({
        status: 500,
        data: { type: 'error', message: 'Server error' },
      });
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.status).toBe('failed');
    });

    test('returns failed object on network error', async () => {
      axios.post.mockRejectedValue(new Error('Connection refused'));
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.status).toBe('failed');
      expect(r.error).toBe('Connection refused');
      expect(r.errorType).toBe('exception');
    });

    test('strips + from phone number', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(
        makeData({ customer_sms_fullphone: '+919876543210' }),
        'ENC'
      );
      const payload = axios.post.mock.calls[0][1];
      expect(payload.recipients[0].mobiles).toBe('919876543210');
    });

    test('posts to config msg91 apiUrl', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][0]).toBe('https://mock.msg91.api/v5/flow');
    });

    test('uses Authkey from config in headers', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][2].headers.Authkey).toBe('FAKE_MSG91_AUTH_KEY');
    });

    test('payload template_id from config', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][1].template_id).toBe('FAKE_TEMPLATE_ID');
    });

    test('payload short_url and realTimeResponse are set', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      const p = axios.post.mock.calls[0][1];
      expect(p.short_url).toBe('0');
      expect(p.realTimeResponse).toBe('1');
    });

    test('recipient url contains encryptedId', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC_999');
      const recipient = axios.post.mock.calls[0][1].recipients[0];
      expect(recipient.url).toContain('ENC_999');
    });

    test('recipient name matches customer_sms_name', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData({ customer_sms_name: 'Bob' }), 'ENC');
      expect(axios.post.mock.calls[0][1].recipients[0].name).toBe('Bob');
    });

    test('uses orderId when provided', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData({ orderId: 'ORDER_XYZ' }), 'ENC');
      expect(axios.post.mock.calls[0][1].recipients[0].orderId).toBe('ORDER_XYZ');
    });

    test('falls back to customer_sms_id when orderId not provided', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][1].recipients[0].orderId).toBe('SALE_001');
    });

    test('fullResponse included in failed object', async () => {
      const fullData = { type: 'error', message: 'Quota exceeded' };
      axios.post.mockResolvedValue({ status: 429, data: fullData });
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.fullResponse).toEqual(fullData);
    });

    test('extracts provider error message from axios response on exception', async () => {
      axios.post.mockRejectedValue({
        response: { data: { type: 'auth_error', message: 'Invalid auth key' } },
        message: 'Request failed',
      });
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.error).toBe('Invalid auth key');
      expect(r.errorType).toBe('auth_error');
    });

    test('falls back to error.message when response has no data', async () => {
      axios.post.mockRejectedValue({ message: 'Timeout' });
      const r = await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(r.error).toBe('Timeout');
    });

    test('sets 30-second timeout', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await smsService.sendSmsViaMsg91(makeData(), 'ENC');
      expect(axios.post.mock.calls[0][2].timeout).toBe(30000);
    });

    test('resolves (does not throw) on hard failure', async () => {
      axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(smsService.sendSmsViaMsg91(makeData(), 'ENC')).resolves.toBeDefined();
    });
  });

  // ── logSmsStatusToS3 ─────────────────────────────────────────────────────────

  describe('logSmsStatusToS3', () => {
    test('calls s3Client.send once', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001');
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    test('uses correct bucket from config', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001');
      expect(mockS3Send.mock.calls[0][0].Bucket).toBe('fake-sms-bucket');
    });

    test('key matches msg91Logs/msg91-log-<timestamp>.json pattern', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001');
      expect(mockS3Send.mock.calls[0][0].Key).toMatch(/^msg91Logs\/msg91-log-\d+\.json$/);
    });

    test('ContentType is application/json', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001');
      expect(mockS3Send.mock.calls[0][0].ContentType).toBe('application/json');
    });

    test('Body contains phone_number, client_id, status, sent_at', async () => {
      await smsService.logSmsStatusToS3('+911234567890', 'failed', 'LIC999');
      const body = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(body.phone_number).toBe('+911234567890');
      expect(body.client_id).toBe('LIC999');
      expect(body.status).toBe('failed');
      expect(typeof body.sent_at).toBe('string');
    });

    test('client_id is stringified (coerces numbers)', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'delivered', 12345);
      const body = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(body.client_id).toBe('12345');
    });

    test('does not throw when S3 send rejects', async () => {
      mockS3Send.mockRejectedValue(new Error('S3 down'));
      await expect(
        smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001')
      ).resolves.toBeUndefined();
    });

    test('accepts custom timezone without throwing', async () => {
      await expect(
        smsService.logSmsStatusToS3('+919876543210', 'delivered', 'LIC001', 'America/New_York')
      ).resolves.not.toThrow();
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    test('logs no_provider status correctly', async () => {
      await smsService.logSmsStatusToS3('+919876543210', 'no_provider', 'LIC001');
      const body = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(body.status).toBe('no_provider');
    });
  });

  // ── Security & edge cases ────────────────────────────────────────────────────

  describe('security & edge cases', () => {
    test('encrypted ID used in MSG91 URL — raw sale ID not sent', async () => {
      smsService.provider = 'msg91';
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      Encryption.generateEncryptedId.mockReturnValue('SAFE_ENC');
      await smsService.sendSalesReceipt(makeData({ customer_sms_id: 'RAW_SALE_123' }));
      const recipient = axios.post.mock.calls[0][1].recipients[0];
      expect(recipient.url).toContain('SAFE_ENC');
      expect(recipient.url).not.toContain('RAW_SALE_123');
    });

    test('phone with special characters does not throw', async () => {
      smsService.provider = 'msg91';
      axios.post.mockResolvedValue({ status: 200, data: { type: 'success' } });
      await expect(
        smsService.sendSalesReceipt(makeData({ customer_sms_fullphone: '+1 (555) 123-4567' }))
      ).resolves.toBeDefined();
    });

    test('very long customer name passes through to Brevo payload', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      const longName = 'A'.repeat(300);
      await smsService.sendSmsViaBrevo(makeData({ customer_sms_name: longName }), 'ENC');
      expect(axios.post.mock.calls[0][1].content).toContain(longName);
    });

    test('Unicode/emoji in name passes through', async () => {
      axios.post.mockResolvedValue({ data: { status: 'delivered' } });
      await smsService.sendSmsViaBrevo(makeData({ customer_sms_name: '😊 رضا' }), 'ENC');
      expect(axios.post.mock.calls[0][1].content).toContain('😊 رضا');
    });

    test('MSG91 error response does not expose provider auth key', async () => {
      axios.post.mockRejectedValue(new Error('auth invalid'));
      smsService.provider = 'msg91';
      const r = await smsService.sendSalesReceipt(makeData());
      expect(JSON.stringify(r)).not.toContain('FAKE_MSG91_AUTH_KEY');
    });
  });
});
