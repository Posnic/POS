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
