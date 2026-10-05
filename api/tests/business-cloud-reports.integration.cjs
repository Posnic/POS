'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { readBusinessOverview, readBusinessItems } = require('../src/services/business-reports');
const {
  ensureCloudReportingIndexes,
  dayRanges,
} = require('../src/services/business-cloud-reports');
let mongo, client, db;
const day = '2026-10-05';
const options = { cloud: true, now: () => Date.parse('2026-10-05T12:00:00Z') };
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('business_cloud');
  await ensureCloudReportingIndexes(db);
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
function context() {
  return {
    businessId: String(new ObjectId()),
    capabilities: ['overview.read', 'items.read'],
    branches: [
      { id: String(new ObjectId()), currency: 'INR', currencyDigits: 2, timezone: 'Asia/Kolkata' },
    ],
  };
}
function sale(c, extra = {}) {
  return {
    _id: new ObjectId(),
    license: new ObjectId(c.businessId),
    branch_id: new ObjectId(c.branches[0].id),
    sale_process: 'Add',
    payment_status: 'Paid',
    date: new Date('2026-10-05T06:00:00Z'),
    updated_date: new Date('2026-10-05T07:00:00Z'),
    sales_total: 500,
    ...extra,
  };
}
const query = (c) => ({ branchId: c.branches[0].id, businessDate: day });
const read = (c) => readBusinessOverview(db, c, query(c), options);
const refund = (amount, date = '2026-10-05T06:00:00Z') => ({
  returnArray: {
    returnObjId: new ObjectId(),
    returnDate: new Date(date),
    itemsTotalAmount: amount,
  },
});

test('cloud-only business shows real zero and then sales without desktop or publisher', async () => {
  const c = context();
  assert.equal((await read(c)).completedSales, 0);
  await db.collection('sales').insertOne(sale(c));
  const result = await read(c);
  assert.equal(result.completedSales, 1);
  assert.equal(result.salesAfterReturnsMinor, 50000);
  assert.equal(result.freshness.complete, false);
  assert.equal(result.freshness.sourceUpdatedAt, '2026-10-05T07:00:00.000Z');
  assert.equal(await db.collection('business_reporting_requests').countDocuments({}), 0);
});
test('replayed upload, edits, cancellation and physical deletion never leave accumulated contributions', async () => {
  const c = context(),
    s = sale(c);
  for (let n = 0; n < 3; n++)
    await db.collection('sales').replaceOne({ _id: s._id }, s, { upsert: true });
  assert.equal((await read(c)).completedSales, 1);
  await db.collection('sales').updateOne({ _id: s._id }, { $set: { sales_total: 250 } });
  assert.equal((await read(c)).salesAfterReturnsMinor, 25000);
  await db.collection('sales').updateOne({ _id: s._id }, { $set: { sale_process: 'Cancel' } });
  assert.equal((await read(c)).completedSales, 0);
  await db.collection('sales').deleteOne({ _id: s._id });
  assert.equal((await read(c)).salesAfterReturnsMinor, 0);
});
test('today includes old-bill refunds exactly once, excluding older refunds', async () => {
  const c = context();
  await db
    .collection('sales')
    .insertMany([
      sale(c, { items_return_total: 25, items_return: [refund(25)] }),
      sale(c, {
        date: new Date('2025-01-01T00:00:00Z'),
        items_return_total: 75,
        items_return: [refund(50), refund(25, '2026-10-01T10:00:00Z')],
      }),
    ]);
  const result = await read(c);
  assert.equal(result.billedSalesMinor, 50000);
  assert.equal(result.completedSales, 1);
  assert.equal(result.refundsMinor, 7500);
  assert.equal(result.salesAfterReturnsMinor, 42500);
});
test('branch midnight, legacy ISO offsets, string scope IDs and cloud/device sales coexist', async () => {
  const c = context();
  await db
    .collection('sales')
    .insertMany([
      sale(c, { date: new Date('2026-10-04T18:30:00Z') }),
      sale(c, { date: new Date('2026-10-04T18:29:59Z') }),
      sale(c, {
        date: '2026-10-05T23:59:59+05:30',
        license: c.businessId,
        branch_id: c.branches[0].id,
      }),
      sale(c, { date: '2026-10-06T00:00:00+05:30' }),
      sale(c, { _syncMeta: { src: 'test-till', at: new Date() } }),
    ]);
  assert.equal((await read(c)).completedSales, 3);
  // A late upload revises the earlier day without restarting anything.
  await db
    .collection('sales')
    .insertOne(sale(c, { updated_date: new Date('2026-10-04T00:00:00Z') }));
  assert.equal((await read(c)).completedSales, 4);
});
test('held/training/open tables excluded; paid table included; foreign scope cannot leak', async () => {
  const c = context();
  await db
    .collection('sales')
    .insertMany([
      sale(c, { sale_process: 'Hold' }),
      sale(c, { training: true }),
      sale(c, { sale_process: 'KOT', payment_status: 'Unpaid' }),
      sale(c, { sale_process: 'KOT', payment_status: 'Paid' }),
      sale(c, { license: new ObjectId() }),
      sale(c, { branch_id: new ObjectId() }),
    ]);
  assert.equal((await read(c)).completedSales, 1);
  await assert.rejects(
    readBusinessOverview(db, c, { ...query(c), branchId: String(new ObjectId()) }, options),
    { code: 'access_denied' }
  );
  await assert.rejects(read({ ...c, capabilities: [] }), { code: 'access_denied' });
});
test('invalid money refuses the whole response instead of showing a partial total', async () => {
  const c = context();
  await db.collection('sales').insertMany([sale(c), sale(c, { sales_total: 'broken' })]);
  await assert.rejects(read(c), { code: 'summary_unavailable' });
});
test('DST date boundaries span 23 and 25 hours', () => {
  for (const [date, hours] of [
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ]) {
    const [range] = dayRanges(date, 'America/New_York');
    assert.equal((range.$lt - range.$gte) / 3600000, hours);
  }
});
test('cloud item view is available without desktop and enforces item ACL', async () => {
  const c = context();
  await db
    .collection('sales')
    .insertOne(
      sale(c, {
        items: [
          {
            item_id: String(new ObjectId()),
            item_name: 'Fish',
            item_unit: 'plate',
            item_quantity: 1,
            total_amount: 500,
          },
        ],
      })
    );
  const result = await readBusinessItems(db, c, query(c), options);
  assert.equal(result.itemInsights.state, 'available');
  assert.equal(result.itemInsights.items[0].salesAfterReturnsMinor, 50000);
  await assert.rejects(
    readBusinessItems(db, { ...c, capabilities: ['overview.read'] }, query(c), options),
    { code: 'access_denied' }
  );
});
test('an oversized day fails closed with no partial sum', async () => {
  const c = context();
  await db.collection('sales').insertMany(Array.from({ length: 10001 }, () => sale(c)));
  await assert.rejects(read(c), { code: 'summary_unavailable' });
});
