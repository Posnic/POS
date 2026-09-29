'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  getStockPreference,
  saveStockPreference,
} = require('../src/services/business-stock-notification-preferences');
let mongo, client, db;
const priorFlag = process.env.POSNIC_BUSINESS_STOCK_ALERTS;
before(async () => {
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_preferences');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
  if (priorFlag === undefined) delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
  else process.env.POSNIC_BUSINESS_STOCK_ALERTS = priorFlag;
});
const fixture = () => {
  const branchId = String(new ObjectId());
  return {
    branchId,
    context: {
      accountId: String(new ObjectId()),
      businessId: String(new ObjectId()),
      capabilities: ['stock.read', 'notifications.self.manage'],
      branches: [{ id: branchId, timezone: 'Asia/Kolkata' }],
    },
  };
};
const input = (expectedRevision = 0) => ({
  enabled: true,
  expectedRevision,
  minimumIntervalMinutes: 60,
  quiet: { enabled: true, start: '22:00', end: '07:00' },
});
const rowFor = (f) =>
  db
    .collection('business_stock_notification_preferences')
    .findOne({ _id: f.context.accountId + ':' + f.branchId });
test('stock-only users start opted out with an independent branch-scoped cadence', async () => {
  const f = fixture();
  assert.deepEqual(await getStockPreference(db, f.context, f.branchId), {
    branchId: f.branchId,
    timezone: 'Asia/Kolkata',
    revision: 0,
    enabled: false,
    minimumIntervalMinutes: 60,
    quiet: { enabled: false, start: '22:00', end: '07:00' },
  });
  const saved = await saveStockPreference(db, f.context, f.branchId, input());
  assert.equal(saved.enabled, true);
  assert.equal(saved.revision, 1);
  assert.equal(
    await db
      .collection('business_notification_preferences')
      .countDocuments({ accountId: f.context.accountId }),
    0
  );
  const other = { ...f.context, accountId: String(new ObjectId()) };
  assert.equal((await getStockPreference(db, other, f.branchId)).enabled, false);
});
test('concurrent edits cannot overwrite a preference revision', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    saveStockPreference(db, f.context, f.branchId, input()),
    saveStockPreference(db, f.context, f.branchId, { ...input(), minimumIntervalMinutes: 15 }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'preference_changed');
  assert.equal((await rowFor(f)).revision, 1);
});
test('editing settings preserves activation while disable and re-enable invalidate pending worker leases', async () => {
  const f = fixture();
  let at = Date.now();
  await saveStockPreference(db, f.context, f.branchId, input(), { now: () => at });
  const enabled = await rowFor(f);
  await db.collection('business_stock_notification_preferences').updateOne(
    { _id: enabled._id },
    {
      $set: {
        leaseId: 'old-lease',
        leaseUntil: new Date(at + 30000),
        cursor: 'old',
        lastNotifiedAt: new Date(at),
      },
    }
  );
  at++;
  await saveStockPreference(
    db,
    f.context,
    f.branchId,
    { ...input(1), minimumIntervalMinutes: 30 },
    { now: () => at }
  );
  assert.equal((await rowFor(f)).activationId, enabled.activationId);
  assert.deepEqual((await rowFor(f)).enabledAt, enabled.enabledAt);
  assert.equal((await rowFor(f)).leaseId, undefined);
  await saveStockPreference(
    db,
    f.context,
    f.branchId,
    { ...input(2), enabled: false },
    { now: () => at }
  );
  assert.equal((await rowFor(f)).nextScanAt, undefined);
  at++;
  await saveStockPreference(db, f.context, f.branchId, input(3), { now: () => at });
  const restarted = await rowFor(f);
  assert.notEqual(restarted.activationId, enabled.activationId);
  assert.equal(restarted.enabledAt.getTime(), at);
  assert.equal(restarted.cursor, undefined);
  assert.equal(restarted.lastNotifiedAt, undefined);
});
test('denied ACL, branch scope and disabled rollout perform no preference I/O', async () => {
  const f = fixture(),
    guarded = {
      collection() {
        throw new Error('unexpected_io');
      },
    };
  for (const context of [
    { ...f.context, capabilities: ['notifications.self.manage'] },
    { ...f.context, capabilities: ['stock.read'] },
    { ...f.context, branches: [] },
  ]) {
    await assert.rejects(getStockPreference(guarded, context, f.branchId), {
      code: 'access_denied',
    });
    await assert.rejects(saveStockPreference(guarded, context, f.branchId, input()), {
      code: 'access_denied',
    });
  }
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '0';
  try {
    await assert.rejects(getStockPreference(guarded, f.context, f.branchId), {
      code: 'stock_alerts_disabled',
    });
  } finally {
    process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  }
});
test('frequency, quiet hours, timezone injection and unknown fields are rejected before persistence', async () => {
  const f = fixture();
  for (const change of [
    { minimumIntervalMinutes: 1 },
    { minimumIntervalMinutes: '60' },
    { minimumIntervalMinutes: 1440 },
    { timezone: 'UTC' },
    { enabled: 'true' },
    { expectedRevision: -1 },
    { expectedRevision: Number.MAX_SAFE_INTEGER },
    { quiet: { enabled: true, start: '07:00', end: '07:00' } },
    { quiet: { enabled: false, start: '25:00', end: '07:00' } },
    { quiet: { enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' } },
  ])
    await assert.rejects(
      saveStockPreference(db, f.context, f.branchId, { ...input(), ...change }),
      { code: 'invalid_preference' }
    );
  assert.equal(await rowFor(f), null);
});
test('stored corruption is unavailable rather than silently resetting opt-in or revision', async () => {
  const f = fixture();
  await saveStockPreference(db, f.context, f.branchId, input());
  await db
    .collection('business_stock_notification_preferences')
    .updateOne(
      { _id: f.context.accountId + ':' + f.branchId },
      { $set: { minimumIntervalMinutes: 0 } }
    );
  await assert.rejects(getStockPreference(db, f.context, f.branchId), {
    code: 'preference_unavailable',
  });
  await assert.rejects(saveStockPreference(db, f.context, f.branchId, input(1)), {
    code: 'preference_unavailable',
  });
});
