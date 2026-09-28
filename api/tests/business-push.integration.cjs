'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createBusinessAccess, opaque } = require('../src/services/business-access');
const { savePreference } = require('../src/services/business-notifications');
const push = require('../src/services/business-push');
let mongo, client, db;
const at = Date.parse('2026-09-28T17:30:00Z');
const config = {
  enabled: true,
  projectId: '11111111-1111-4111-8111-111111111111',
  accessToken: 'test-only',
};
const token = 'ExpoPushToken[abcdef1234567890]';
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
});
beforeEach(() => {
  db = client.db('push_' + new ObjectId());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const license = new ObjectId(),
    branch = {
      _id: new ObjectId(),
      license,
      branch_name: 'Central',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
    };
  const user = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'manager',
    branch_access: [{ branch_id: branch._id }],
    access: { dashboard: { read: true, financials: true } },
  };
  const session = {
    _id: opaque(),
    userId: user._id,
    license,
    tokenHash: opaque(),
    authVersion: 0,
    issuedAt: new Date(at - 60000),
    expiresAt: new Date(at + 30 * 86400000),
  };
  await db.collection('branches').insertOne(branch);
  await db.collection('users').insertOne(user);
  await db.collection('business_sessions').insertOne(session);
  const context = await createBusinessAccess(db, { now: () => at }).contextFor(user),
    identity = { user, session };
  await savePreference(
    db,
    context,
    String(branch._id),
    {
      expectedRevision: 0,
      enabled: true,
      time: '23:00',
      locale: 'en',
      quiet: { enabled: false, start: '22:00', end: '07:00' },
    },
    { now: () => at - 60000 }
  );
  await push.registerDevice(
    db,
    identity,
    { token, platform: 'android', projectId: config.projectId },
    { config, now: () => at - 1000 }
  );
  const event = {
    _id: new ObjectId(),
    eventKey: opaque(),
    accountId: String(user._id),
    license,
    branchId: String(branch._id),
    kind: 'daily_unavailable',
    createdAt: new Date(at),
    expiresAt: new Date(at + 90 * 86400000),
    pushPending: true,
  };
  await db.collection('business_inbox').insertOne(event);
  return { user, session, identity, event };
}
test('concurrent delivery is private, durable and tracks provider acceptance separately from receipt', async () => {
  const f = await fixture();
  let sends = 0,
    receipts = 0;
  const transport = {
    send: async (recipient, eventId) => {
      sends++;
      assert.equal(recipient, token);
      assert.equal(eventId, String(f.event._id));
      return '22222222-2222-4222-8222-222222222222';
    },
    receipt: async () => {
      receipts++;
      return 'provider_accepted';
    },
  };
  const options = { config, now: () => at, transport };
  await Promise.all([push.drainPush(db, options), push.drainPush(db, options)]);
  assert.equal(sends, 1);
  assert.equal(receipts, 0);
  assert.equal((await db.collection('business_push_deliveries').findOne({})).state, 'receipt');
  await push.drainPush(db, { ...options, now: () => at + 15 * 60000 });
  assert.equal(receipts, 1);
  assert.equal(
    (await db.collection('business_push_deliveries').findOne({})).state,
    'provider_accepted'
  );
  const status = await push.deviceStatus(db, f.identity, { config });
  assert.deepEqual(status, { available: true, projectId: config.projectId, enabled: true });
  assert.equal(JSON.stringify(status).includes(token), false);
});

test('actual scheduled Inbox materialization enters the push queue exactly once', async () => {
  const f = await fixture();
  await db.collection('business_inbox').deleteOne({ _id: f.event._id });
  const { drainDue } = require('../src/services/business-notifications');
  await drainDue(db, {
    now: () => at,
    readSummary: async () => {
      throw Object.assign(new Error('summary_unavailable'), { code: 'summary_unavailable' });
    },
  });
  const event = await db.collection('business_inbox').findOne({ accountId: String(f.user._id) });
  assert.equal(event.kind, 'daily_unavailable');
  assert.equal(event.pushPending, true);
  let sends = 0;
  const transport = {
    send: async (_token, eventId) => {
      sends++;
      assert.equal(eventId, String(event._id));
      return '22222222-2222-4222-8222-222222222222';
    },
  };
  await push.drainPush(db, { config, now: () => at, transport });
  await push.drainPush(db, { config, now: () => at, transport });
  assert.equal(sends, 1);
});

test('recipient languages belong to each session device and legacy renewal preserves the preference', async () => {
  const f = await fixture();
  const registration = { token, platform: 'android', projectId: config.projectId };
  await push.registerDevice(db, f.identity, { ...registration, locale: 'fr' }, { config });
  await push.registerDevice(db, f.identity, registration, { config });
  const legacy = await push.deviceStatus(db, f.identity, { config });
  assert.equal(Object.hasOwn(legacy, 'locale'), false);
  const localized = await push.deviceStatus(db, f.identity, { config, includeLanguages: true });
  assert.equal(localized.locale, 'fr');
  assert.equal(localized.supportedLanguages.length, 18);
  for (const locale of ['constructor', 'fr-CA', '', null, { en: true }])
    await assert.rejects(
      push.registerDevice(db, f.identity, { ...registration, locale }, { config }),
      { code: 'invalid_request' }
    );
  const second = { ...f.session, _id: opaque(), tokenHash: opaque() };
  await db.collection('business_sessions').insertOne(second);
  const secondToken = 'ExpoPushToken[seconddevice12345]';
  await push.registerDevice(
    db,
    { user: f.user, session: second },
    {
      ...registration,
      token: secondToken,
      locale: 'ar',
    },
    { config, now: () => at - 1000 }
  );
  const sent = new Map();
  await push.drainPush(db, {
    config,
    now: () => at,
    transport: {
      async send(recipient, event, locale) {
        assert.equal(event, String(f.event._id));
        sent.set(recipient, locale);
        return '22222222-2222-4222-8222-222222222222';
      },
    },
  });
  assert.deepEqual(
    sent,
    new Map([
      [token, 'fr'],
      [secondToken, 'ar'],
    ])
  );
});

test('a queued retry reads the current device language without creating another delivery', async () => {
  const f = await fixture();
  const languages = [];
  const transport = {
    async send(recipient, event, locale) {
      languages.push(locale);
      if (languages.length === 1) throw Object.assign(new Error('offline'), { retryable: true });
      return '22222222-2222-4222-8222-222222222222';
    },
  };
  await push.drainPush(db, { config, now: () => at, transport });
  await push.registerDevice(
    db,
    f.identity,
    { token, projectId: config.projectId, platform: 'android', locale: 'ta' },
    { config }
  );
  await push.drainPush(db, { config, now: () => at + 31000, transport });
  assert.deepEqual(languages, ['en', 'ta']);
  assert.equal(await db.collection('business_push_deliveries').countDocuments({}), 1);
});
test('revoked sessions and removed financial access cannot send even a generic alert', async () => {
  const f = await fixture();
  await db
    .collection('business_sessions')
    .updateOne({ _id: f.session._id }, { $set: { revokedAt: new Date(at) } });
  await push.drainPush(db, {
    config,
    now: () => at,
    transport: { send: async () => assert.fail('revoked session') },
  });
  assert.equal((await db.collection('business_push_deliveries').findOne({})).state, 'stopped');
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { access: {} } });
  await db
    .collection('business_inbox')
    .updateOne({ _id: f.event._id }, { $set: { pushPending: true } });
  await push.drainPush(db, {
    config,
    now: () => at,
    transport: { send: async () => assert.fail('removed access') },
  });
  assert.equal(
    (await db.collection('business_inbox').findOne({ _id: f.event._id })).pushPending,
    false
  );
});
test('temporary failures back off and a DeviceNotRegistered receipt removes its registration', async () => {
  await fixture();
  let calls = 0;
  const transport = {
    send: async () => {
      if (++calls === 1)
        throw Object.assign(new Error('offline'), {
          code: 'push_provider_unavailable',
          retryable: true,
        });
      return '22222222-2222-4222-8222-222222222222';
    },
    receipt: async () => {
      throw Object.assign(new Error('removed'), { code: 'push_device_removed', retryable: false });
    },
  };
  await push.drainPush(db, { config, now: () => at, transport });
  assert.equal(calls, 1);
  assert.equal((await db.collection('business_push_deliveries').findOne({})).attempts, 1);
  await push.drainPush(db, { config, now: () => at + 31000, transport });
  assert.equal(calls, 2);
  await push.drainPush(db, { config, now: () => at + 16 * 60000, transport });
  assert.equal(await db.collection('business_push_devices').countDocuments({}), 0);
});
test('registration cannot override another account and opt-out prevents queued delivery', async () => {
  const f = await fixture();
  await assert.rejects(
    push.registerDevice(
      db,
      { ...f.identity, user: { ...f.user, _id: new ObjectId() } },
      { token, platform: 'ios', projectId: config.projectId },
      { config }
    ),
    { code: 'device_already_registered' }
  );
  await push.unregisterDevice(db, f.identity);
  await push.drainPush(db, {
    config,
    now: () => at,
    transport: { send: async () => assert.fail('opted out') },
  });
  assert.equal(await db.collection('business_push_deliveries').countDocuments({}), 0);
});
test('a delayed invalid-device receipt cannot remove a newer registration', async () => {
  const f = await fixture();
  const transport = {
    send: async () => '22222222-2222-4222-8222-222222222222',
    receipt: async () => {
      throw Object.assign(new Error('removed'), { code: 'push_device_removed', retryable: false });
    },
  };
  await push.drainPush(db, { config, now: () => at, transport });
  await push.unregisterDevice(db, f.identity);
  await push.registerDevice(
    db,
    f.identity,
    { token, platform: 'android', projectId: config.projectId },
    { config, now: () => at + 1000 }
  );
  await push.drainPush(db, { config, now: () => at + 16 * 60000, transport });
  assert.equal(await db.collection('business_push_devices').countDocuments({}), 1);
});
