'use strict';

/*
 * Tests for messaging settings + the SMS sender. The DB is the in-memory
 * stand-in; axios is mocked so no real SMS leaves. The important guarantees:
 * secrets never come back over the wire, a blank secret on save keeps the stored
 * one, and sending reads the raw secret server-side.
 */

jest.mock('axios');
const axios = require('axios');
const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const MessagingService = require('../../../src/services/messaging.service');

function matches(doc, query) {
  return Object.keys(query).every((k) => String(doc[k]) === String(query[k]));
}
function makeCollection(seed = []) {
  const docs = seed.map((d) => ({ ...d }));
  return {
    _docs: docs,
    async findOne(q) {
      return docs.find((d) => matches(d, q)) || null;
    },
    async updateOne(q, update, opts = {}) {
      let doc = docs.find((d) => matches(d, q));
      if (!doc && opts.upsert) {
        doc = { ...q };
        if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
        docs.push(doc);
      }
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, upsertedCount: doc ? 1 : 0 };
    },
  };
}
function makeDb(collections) {
  return { collection: (n) => collections[n] || (collections[n] = makeCollection()) };
}

const BRANCH = '64e000000000000000000001';

test('Vonage Messages API retains the provider reference without exposing credentials', async () => {
  const svc = new MessagingService();
  jest.spyOn(svc, '_raw').mockResolvedValue({
    sms_enabled: true,
    sms_provider: 'vonage_messages',
    sms_config: { api_key: 'key', api_secret: 'private', sender: 'Posnic' },
  });
  axios.mockReset();
  axios.mockResolvedValue({ status: 202, data: { message_uuid: 'provider-reference' } });
  const result = await svc._sendSms(BRANCH, '+919494111161', 'POSNIC TEST');
  expect(result).toMatchObject({
    ok: true,
    provider: 'vonage_messages',
    messageId: 'provider-reference',
  });
  expect(JSON.stringify(result)).not.toContain('private');
});

describe('MessagingService.getSettings (masking)', () => {
  let svc;
  beforeEach(() => {
    svc = new MessagingService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('blanks secrets and reports which are set', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_enabled: true,
        sms_provider: 'twilio',
        sms_config: { account_sid: 'AC1', auth_token: 'super-secret', sender: '+1999' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));

    const out = await svc.getSettings(BRANCH);
    expect(out.sms_config.account_sid).toBe('AC1'); // non-secret returned
    expect(out.sms_config.sender).toBe('+1999');
    expect(out.sms_config.auth_token).toBeUndefined(); // secret NOT returned
    expect(out.sms_secrets_set.auth_token).toBe(true);
  });
});

describe('MessagingService.saveSettings (secret preservation)', () => {
  let svc;
  beforeEach(() => {
    svc = new MessagingService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('saving one channel preserves the other channel and its sending credentials', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_enabled: true,
        sms_provider: 'msg91',
        sms_config: { authkey: 'saved-key', sender: 'POSNIC', receipt_template_id: 'receipt' },
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: { access_token: 'saved-token', phone_number_id: '123' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    await svc.saveSettings(BRANCH, { whatsapp_enabled: false });
    expect(settings._docs[0].sms_enabled).toBe(true);
    expect(settings._docs[0].sms_config.authkey).toBe('saved-key');
    expect(settings._docs[0].sms_config.receipt_template_id).toBe('receipt');
    await svc.saveSettings(BRANCH, { sms_enabled: false });
    expect(settings._docs[0].whatsapp_enabled).toBe(false);
    expect(settings._docs[0].whatsapp_mode).toBe('cloud');
    expect(settings._docs[0].whatsapp_cloud.access_token).toBe('saved-token');
  });

  test('a blank secret keeps the stored one; other fields update', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_provider: 'twilio',
        sms_config: { account_sid: 'AC1', auth_token: 'stored-secret', sender: '+1999' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));

    await svc.saveSettings(BRANCH, {
      sms_enabled: true,
      sms_provider: 'twilio',
      sms_config: { account_sid: 'AC2', sender: '+1888', auth_token: '' }, // blank secret
    });

    const raw = settings._docs[0];
    expect(raw.sms_config.auth_token).toBe('stored-secret'); // preserved
    expect(raw.sms_config.account_sid).toBe('AC2'); // updated
    expect(raw.sms_config.sender).toBe('+1888');
  });

  test('a new secret value overwrites the stored one', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_provider: 'twilio',
        sms_config: { account_sid: 'AC1', auth_token: 'old', sender: '+1' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    await svc.saveSettings(BRANCH, {
      sms_provider: 'twilio',
      sms_config: { account_sid: 'AC1', sender: '+1', auth_token: 'brand-new' },
    });
    expect(settings._docs[0].sms_config.auth_token).toBe('brand-new');
  });
});

describe('MessagingService.sendSms', () => {
  let svc;
  beforeEach(() => {
    svc = new MessagingService();
    BaseModel.license = 'lic-test';
    axios.mockReset();
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('refuses when SMS is not configured', async () => {
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ messaging_settings: makeCollection([]) }));
    const r = await svc.sendSms(BRANCH, '+15551234567', 'hi');
    expect(r.ok).toBe(false);
  });

  test('sends via the configured provider and reads the raw secret server-side', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_enabled: true,
        sms_provider: 'twilio',
        sms_config: { account_sid: 'AC1', auth_token: 'tok', sender: '+1999' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    axios.mockResolvedValue({ status: 201, data: { sid: 'SM1' } });

    const r = await svc.sendSms(BRANCH, '+15551234567', 'hello');
    expect(r.ok).toBe(true);
    const req = axios.mock.calls[0][0];
    expect(req.url).toContain('/Accounts/AC1/Messages.json');
    expect(req.headers.Authorization).toBe('Basic ' + Buffer.from('AC1:tok').toString('base64'));
    expect(String(req.data)).toContain('Body=hello');
  });

  test('reports a provider failure without throwing', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        sms_enabled: true,
        sms_provider: 'twilio',
        sms_config: { account_sid: 'AC1', auth_token: 'tok', sender: '+1' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    axios.mockResolvedValue({ status: 401, data: { message: 'auth failed' } });
    const r = await svc.sendSms(BRANCH, '+15551234567', 'hi');
    expect(r.ok).toBe(false);
  });
});

describe('MessagingService WhatsApp (mode + cloud)', () => {
  let svc;
  beforeEach(() => {
    svc = new MessagingService();
    BaseModel.license = 'lic-test';
    axios.mockReset();
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('getSettings blanks the cloud access token but reports it set', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: { access_token: 'secret-tok', phone_number_id: '12345' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    const out = await svc.getSettings(BRANCH);
    expect(out.whatsapp_mode).toBe('cloud');
    expect(out.whatsapp_cloud.phone_number_id).toBe('12345');
    expect(out.whatsapp_cloud.access_token).toBeUndefined();
    expect(out.whatsapp_secrets_set.access_token).toBe(true);
  });

  test('cloud mode posts to the Meta Graph API with a bearer token', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: { access_token: 'TOK', phone_number_id: '12345', api_version: 'v20.0' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    axios.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.1' }] } });

    const r = await svc.sendWhatsapp(BRANCH, '+15551234567', 'hello');
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ provider: 'whatsapp_cloud', messageId: 'wamid.1' });
    const req = axios.mock.calls[0][0];
    expect(req.url).toContain('graph.facebook.com/v20.0/12345/messages');
    expect(req.headers.Authorization).toBe('Bearer TOK');
    expect(req.data.text.body).toBe('hello');
  });

  test.each([{}, { messages: [{}] }, { messages: [{ id: '' }] }])(
    'cloud mode cannot claim success without a message ID: %j',
    async (data) => {
      const svc = new MessagingService();
      jest
        .spyOn(svc, '_raw')
        .mockResolvedValue({
          whatsapp_enabled: true,
          whatsapp_mode: 'cloud',
          whatsapp_cloud: { access_token: 'synthetic', phone_number_id: '12345' },
        });
      axios.mockResolvedValue({ status: 200, data });
      const result = await svc.sendWhatsapp(BRANCH, '+15551234567', 'Synthetic test');
      expect(result.ok).toBe(false);
      expect(result.messageId).toBeUndefined();
    }
  );

  test('approved template uses the configured language and body parameter', async () => {
    const svc = new MessagingService();
    jest
      .spyOn(svc, '_raw')
      .mockResolvedValue({
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: {
          access_token: 'synthetic',
          phone_number_id: '12345',
          template_name: 'receipt_update',
          template_lang: 'en',
        },
      });
    axios.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.test' }] } });
    expect((await svc.sendWhatsapp(BRANCH, '+15551234567', 'Synthetic receipt')).ok).toBe(true);
    expect(axios.mock.calls[0][0].data).toMatchObject({
      type: 'template',
      template: {
        name: 'receipt_update',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Synthetic receipt' }] }],
      },
    });
  });

  test('cloud mode refuses when not configured', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: {},
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    const r = await svc.sendWhatsapp(BRANCH, '+15551234567', 'hi');
    expect(r.ok).toBe(false);
  });

  test('saveSettings keeps a blank cloud token but updates the phone id', async () => {
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        whatsapp_mode: 'cloud',
        whatsapp_cloud: { access_token: 'stored', phone_number_id: 'OLD' },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    await svc.saveSettings(BRANCH, {
      whatsapp_enabled: true,
      whatsapp_mode: 'cloud',
      whatsapp_cloud: { access_token: '', phone_number_id: 'NEW' },
    });
    expect(settings._docs[0].whatsapp_cloud.access_token).toBe('stored');
    expect(settings._docs[0].whatsapp_cloud.phone_number_id).toBe('NEW');
  });
});

describe('WhatsApp provider switching', () => {
  test('preserves credentials on unrelated saves and isolates a new provider', async () => {
    BaseModel.license = 'lic-test';
    const svc = new MessagingService();
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        whatsapp_mode: 'cloud',
        whatsapp_cloud: {
          provider: 'brevo',
          api_key: 'brevo-secret',
          sender_number: '919008427482',
        },
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ messaging_settings: settings }));
    await svc.saveSettings(BRANCH, { sms_template: 'note' });
    expect(settings._docs[0].whatsapp_cloud.api_key).toBe('brevo-secret');
    const out = await svc.saveSettings(BRANCH, {
      whatsapp_cloud: { provider: 'msg91', api_key: '' },
    });
    expect(settings._docs[0].whatsapp_cloud.api_key).toBe('');
    expect(out.whatsapp_cloud.api_key).toBeUndefined();
    expect(out.whatsapp_providers.map((p) => p.id)).toContain('brevo');
  });
  test('all WhatsApp workflows route through the branch-selected provider', async () => {
    const svc = new MessagingService();
    jest
      .spyOn(svc, '_raw')
      .mockResolvedValue({
        whatsapp_enabled: true,
        whatsapp_mode: 'cloud',
        whatsapp_cloud: { provider: 'brevo', api_key: 'private', sender_number: '919008427482' },
      });
    axios.mockReset();
    axios.mockResolvedValue({ status: 201, data: { messageId: 'brevo-ref' } });
    expect(
      await svc.sendWhatsapp(BRANCH, '+919008427482', 'Report TEST', { purpose: 'Report' })
    ).toMatchObject({ ok: true, provider: 'whatsapp_brevo', messageId: 'brevo-ref' });
    expect(axios.mock.calls[0][0].url).toBe('https://api.brevo.com/v3/whatsapp/sendMessage');
  });
});
