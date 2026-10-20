const BaseModel = require('../../../src/models/base.model');
const MessagingService = require('../../../src/services/messaging.service');
describe('WhatsApp attempt history', () => {
  let original;
  beforeEach(() => {
    original = BaseModel.getDb;
    BaseModel.license = 'shop-a';
  });
  afterEach(() => {
    BaseModel.getDb = original;
    jest.restoreAllMocks();
  });
  test('records queued acceptance without full message, phone or credentials', async () => {
    const insertOne = jest.fn();
    BaseModel.getDb = jest.fn().mockResolvedValue({ collection: () => ({ insertOne }) });
    const svc = new MessagingService();
    jest
      .spyOn(svc, '_sendWhatsapp')
      .mockResolvedValue({ ok: true, queued: true, messageId: 'job-1' });
    await svc.sendWhatsapp('branch-a', '919876543210', 'Private bill', { purpose: 'Receipt' });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        license: 'shop-a',
        branch_id: 'branch-a',
        recipient_last4: '3210',
        status: 'queued',
      })
    );
    expect(JSON.stringify(insertOne.mock.calls[0][0])).not.toMatch(/Private bill|919876543210/);
  });
  test('logging failure never turns an accepted send into a retry', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    BaseModel.getDb = jest.fn().mockRejectedValue(new Error('history unavailable'));
    const svc = new MessagingService();
    jest.spyOn(svc, '_sendWhatsapp').mockResolvedValue({ ok: true, messageId: 'wamid' });
    expect(await svc.sendWhatsapp('branch-a', '12345678', 'Hello')).toEqual({
      ok: true,
      messageId: 'wamid',
    });
  });
  test('history is restricted to active tenant and branch', async () => {
    const cursor = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    };
    const find = jest.fn().mockReturnValue(cursor);
    BaseModel.getDb = jest.fn().mockResolvedValue({ collection: () => ({ find }) });
    await new MessagingService().history('branch-a');
    expect(find).toHaveBeenCalledWith({ license: 'shop-a', branch_id: 'branch-a' });
    expect(cursor.limit).toHaveBeenCalledWith(100);
  });
  test('queue history follows the current outbox result instead of staying waiting forever', async () => {
    const rows = [
      { status: 'queued', provider: 'whatsapp_connector', provider_message_id: 'job-a' },
    ];
    const eventCursor = {
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      toArray: async () => rows,
    };
    const jobs = jest
      .fn()
      .mockReturnValue({ toArray: async () => [{ _id: 'job-a', status: 'sent' }] });
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue({
        collection: (name) =>
          name === 'messaging_events' ? { find: () => eventCursor } : { find: jobs },
      });
    const result = await new MessagingService().history('branch-a');
    expect(result[0].status).toBe('accepted');
    expect(jobs).toHaveBeenCalledWith({
      license: 'shop-a',
      branch_id: 'branch-a',
      _id: { $in: ['job-a'] },
    });
  });
});

describe('SMS attempt history', () => {
  let original;
  beforeEach(() => {
    original = BaseModel.getDb;
    BaseModel.license = 'shop-a';
  });
  afterEach(() => {
    BaseModel.getDb = original;
    jest.restoreAllMocks();
  });
  test('records provider reference without message or full recipient', async () => {
    const insertOne = jest.fn();
    BaseModel.getDb = jest.fn().mockResolvedValue({ collection: () => ({ insertOne }) });
    const svc = new MessagingService();
    jest
      .spyOn(svc, '_sendSms')
      .mockResolvedValue({ ok: true, provider: 'msg91', messageId: 'request-1' });
    await svc.sendSms('branch-a', '919008427482', 'private', { purpose: 'receipt' });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        status: 'accepted',
        recipient_last4: '7482',
        provider_message_id: 'request-1',
      })
    );
    expect(JSON.stringify(insertOne.mock.calls)).not.toMatch(/919008427482|private/);
  });
  test('a history outage does not turn accepted SMS into a resend', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    BaseModel.getDb = jest.fn().mockRejectedValue(new Error('offline'));
    const svc = new MessagingService();
    jest.spyOn(svc, '_sendSms').mockResolvedValue({ ok: true });
    expect(await svc.sendSms('branch-a', '919008427482', 'test')).toEqual({ ok: true });
  });
});
