const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { readBusinessInsights } = require('../src/services/business-insights');
const { ensureCloudReportingIndexes } = require('../src/services/business-cloud-reports');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('insights');
  await ensureCloudReportingIndexes(db);
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
test('restaurant insights follow the current authorized branch module setting', async () => {
  const { createBusinessAccess } = require('../src/services/business-access');
  const license = new ObjectId(),
    id = new ObjectId(),
    foreign = new ObjectId();
  await db.collection('branches').insertMany([
    {
      _id: id,
      license,
      branch_name: 'Restaurant',
      currency: 'INR',
      time_zone: 'UTC',
      table_options: 'enable',
    },
    {
      _id: foreign,
      license: new ObjectId(),
      branch_name: 'Other tenant',
      currency: 'INR',
      time_zone: 'UTC',
      table_options: true,
    },
  ]);
  const user = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'admin',
    branch_access: [{ branch_id: id }, { branch_id: foreign }],
  };
  const access = createBusinessAccess(db);
  const enabled = await access.contextFor(user);
  assert.equal(enabled.branches.length, 1);
  assert.equal(enabled.branches[0].restaurantEnabled, true);
  await db.collection('branches').updateOne({ _id: id }, { $set: { table_options: false } });
  assert.equal((await access.contextFor(user)).branches[0].restaurantEnabled, false);
  await db.collection('branches').updateOne({ _id: id }, { $unset: { table_options: '' } });
  assert.equal((await access.contextFor(user)).branches[0].restaurantEnabled, false);
});
test('cloud projection retains Captain and desktop ownership without crediting a later cashier', async () => {
  const businessId = String(new ObjectId()),
    branchId = String(new ObjectId());
  const captainId = new ObjectId();
  const context = {
    businessId,
    capabilities: ['overview.read', 'reporting.manage'],
    branches: [
      {
        id: branchId,
        currency: 'INR',
        currencyDigits: 2,
        timezone: 'Asia/Kolkata',
        restaurantEnabled: true,
      },
    ],
  };
  const base = {
    table_id: 'table8',
    table_number: 'Table 8',
    license: businessId,
    branch_id: branchId,
    date: new Date('2026-10-05T06:00:00Z'),
    sale_process: 'Add',
    sales_total: 500,
    items_return_total: 0,
  };
  await db.collection('sales').insertMany([
    {
      ...base,
      channel: 'tableside',
      client: { staff_id: captainId, staff_name: 'Rajan' },
      user_id: 'cashier',
      user_name: 'Cashier',
      created_by: 'Owner',
    },
    {
      ...base,
      channel: 'tableside',
      client: { staff_id: String(captainId), staff_name: 'Rajan' },
      kitchen_actor: { name: 'Handover staff' },
    },
    { ...base, user_id: 'karthi', user_name: 'Karthi' },
    { ...base, origin: { actor_id: 'jack', actor_name: 'Jack' } },
    { ...base },
    { ...base, license: String(new ObjectId()), user_name: 'Other business' },
  ]);
  const query = { branchId, from: '2026-10-05', to: '2026-10-11' };
  const options = { now: () => Date.parse('2026-10-14T10:00:00Z') };
  const result = await readBusinessInsights(db, context, query, options);
  assert.deepEqual(
    result.staff.map((s) => [s.name, s.salesAfterReturnsMinor]),
    [
      ['Rajan', 100000],
      ['Karthi', 50000],
      ['Jack', 50000],
      ['Unassigned', 50000],
    ]
  );
  assert.equal(
    result.staff.reduce((n, s) => n + s.salesAfterReturnsMinor, 0),
    result.salesAfterReturnsMinor
  );
  assert.equal(result.restaurant.bySales[0].name, 'Table 8');
  assert.equal(result.restaurant.bySales[0].bills, 5);
  const restricted = await readBusinessInsights(
    db,
    { ...context, capabilities: ['overview.read'] },
    query,
    options
  );
  assert.equal(restricted.staff, null);
});
test('indexed range reads include old-bill returns once, exclude other tenants, and support all time', async () => {
  const businessId = String(new ObjectId()),
    branchId = String(new ObjectId());
  const context = {
    businessId,
    capabilities: ['overview.read', 'reporting.manage'],
    branches: [{ id: branchId, currency: 'INR', currencyDigits: 2, timezone: 'Asia/Kolkata' }],
  };
  const base = {
    license: new ObjectId(businessId),
    branch_id: new ObjectId(branchId),
    date: new Date('2026-10-05T06:00:00Z'),
    sale_process: 'Add',
    sales_total: 500,
    items_return_total: 0,
    created_by: 'Priya',
  };
  await db.collection('sales').insertMany([
    { ...base },
    { ...base, date: '2026-10-11T23:59:59+05:30' },
    {
      ...base,
      date: new Date('2026-09-01T06:00:00Z'),
      items_return_total: 50,
      items_return: [
        {
          returnArray: {
            returnObjId: new ObjectId(),
            returnDate: new Date('2026-10-05T06:00:00Z'),
            itemsTotalAmount: 50,
          },
        },
      ],
    },
    { ...base, license: new ObjectId() },
  ]);
  const opts = { now: () => Date.parse('2026-10-14T10:00:00Z') };
  const r = await readBusinessInsights(
    db,
    context,
    { branchId, from: '2026-10-05', to: '2026-10-11' },
    opts
  );
  assert.equal(r.bills, 2);
  assert.equal(r.salesAfterReturnsMinor, 95000);
  assert.equal(r.returns.transactions, 1);
  const all = await readBusinessInsights(db, context, { branchId, period: 'all' }, opts);
  assert.equal(all.from, '2026-09-01');
  assert.equal(all.salesAfterReturnsMinor, 145000);
});
