const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const BaseModel = require('../src/models/base.model');
const service = require('../src/services/price-sheet');
const scope = require('../src/services/price-scope');
const worker = require('../src/services/price-schedule-worker');
const { runWithTenant } = require('../src/db/tenant-context');
const license = new ObjectId(),
  branchA = new ObjectId(),
  branchB = new ObjectId(),
  userId = new ObjectId();
let server, client, db, c, itemA, itemB;
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('scheduled-prices');
  BaseModel.getDb = async () => db;
});
after(async () => {
  await client?.close();
  await server?.stop();
});
beforeEach(async () => {
  for (const name of [
    'items',
    'branches',
    'users',
    'price_sheet_jobs',
    'price_sheet_rows',
    'price_history',
    'bulk_price_updates',
    'app_brand',
    'api_tokens',
    'categories',
  ])
    await db.collection(name).deleteMany({});
  await db.collection('branches').insertMany([
    { _id: branchA, license, branch_name: 'Main', price_code: 'ABC', time_zone: 'Asia/Kolkata' },
    {
      _id: branchB,
      license,
      branch_name: 'Market',
      price_code: 'MKT',
      time_zone: 'America/New_York',
    },
  ]);
  const user = {
    _id: userId,
    license,
    usertype: 'owner',
    activate: true,
    branch_access: [{ branch_id: branchA }, { branch_id: branchB }],
  };
  await db.collection('users').insertOne(user);
  c = await scope.context(user, branchA, license);
  itemA = new ObjectId();
  itemB = new ObjectId();
  await db.collection('items').insertMany([
    {
      _id: itemA,
      license,
      branch_id: branchA,
      name: 'Beans',
      itemid: '21',
      selling_price: 70,
      available_quantity: 0,
    },
    {
      _id: itemB,
      license,
      branch_id: branchB,
      name: 'Beans',
      itemid: '21',
      selling_price: 72,
      available_quantity: 12,
    },
  ]);
});
async function prepared(extra = {}) {
  return service.prepare(c, {
    jobId: String(new ObjectId()),
    branches: 'all',
    items: [{ sku: '21', prices: { selling_price: 75 } }],
    ...extra,
  });
}
async function makeDue(job) {
  const past = new Date(Date.now() - 1000);
  await db
    .collection('price_sheet_jobs')
    .updateOne(
      { _id: job._id },
      { $set: { effectiveAt: past, dueByBranch: { [branchA]: past, [branchB]: past } } }
    );
}
test('all means permitted branches, duplicate codes are rejected, and missing items are skipped', async () => {
  const restricted = { ...c, branches: [c.branches.find((b) => b.id === String(branchA))] };
  assert.throws(() => scope.selected(restricted, [String(branchB)]), /unauthorized/);
  assert.deepEqual(scope.selected(restricted, 'all'), [String(branchA)]);
  await db.collection('items').deleteOne({ _id: itemB });
  const r = await prepared();
  assert.equal(r.counts.pending, 1);
  assert.equal(r.counts.skipped, 1);
  await db.collection('items').insertOne({
    _id: new ObjectId(),
    license,
    branch_id: branchA,
    itemid: '21',
    selling_price: 70,
  });
  const duplicate = await prepared();
  assert.equal(duplicate.counts.invalid, 1);
});
test('tomorrow uses each branch timezone, never applies early, then runs once without stock changes', async () => {
  const r = await prepared();
  const configured = await service.configure(c, r.job._id, {
    when: 'tomorrow',
    note: 'Diwali offer',
  });
  assert.notEqual(
    +configured.job.dueByBranch[String(branchA)],
    +configured.job.dueByBranch[String(branchB)]
  );
  await worker.drain(db);
  assert.equal((await db.collection('items').findOne({ _id: itemA })).selling_price, 70);
  await makeDue(configured.job);
  await runWithTenant({ db }, () => worker.drain(db));
  await worker.drain(db);
  assert.equal((await db.collection('items').findOne({ _id: itemA })).selling_price, 75);
  assert.equal((await db.collection('items').findOne({ _id: itemA })).available_quantity, 0);
  assert.equal((await db.collection('items').findOne({ _id: itemB })).available_quantity, 12);
  assert.equal(await db.collection('price_history').countDocuments({ note: 'Diwali offer' }), 2);
  assert.equal((await service.status(c, r.job._id)).job.status, 'complete');
});
test('cancelled schedule cannot run and revoked branch membership requires attention', async () => {
  const r = await prepared();
  await service.configure(c, r.job._id, { when: 'tomorrow' });
  await makeDue(r.job);
  await service.cancel(c, r.job._id, { revision: 1 });
  await worker.drain(db);
  assert.equal((await db.collection('items').findOne({ _id: itemA })).selling_price, 70);
  const second = await prepared();
  await service.configure(c, second.job._id, { when: 'tomorrow' });
  await makeDue(second.job);
  await db
    .collection('users')
    .updateOne({ _id: userId }, { $set: { branch_access: [{ branch_id: branchA }] } });
  await worker.drain(db);
  assert.equal((await service.status(c, second.job._id)).job.status, 'attention');
});
test('new selling-price hold after scheduling stops the row, explicit replacement is audited', async () => {
  const r = await prepared({ branches: [String(branchA)] });
  await service.configure(c, r.job._id, { when: 'tomorrow' });
  await makeDue(r.job);
  await db
    .collection('items')
    .updateOne(
      { _id: itemA },
      { $set: { selling_price_hold_until: new Date(Date.now() + 86400000) } }
    );
  await worker.drain(db);
  let result = await service.status(c, r.job._id);
  assert.equal(result.counts.held, 1);
  assert.equal(result.job.status, 'attention');
  await service.configure(c, r.job._id, {
    when: 'now',
    revision: result.job.revision,
    holdOverrides: [String(itemA)],
  });
  result = await service.processBatch(c, r.job._id, false);
  assert.equal(result.counts.updated, 1);
  assert.equal(
    (await db.collection('price_history').findOne({ item_id: itemA })).hold_overridden,
    true
  );
});
test('API request identity, note pagination, stable Excel IDs and dated brand filenames', async () => {
  const id = String(new ObjectId()),
    input = { jobId: id, branches: 'all', items: [{ sku: '21', prices: { selling_price: 75 } }] };
  await service.prepare(c, input);
  assert.equal((await service.prepare(c, input)).counts.pending, 2);
  await assert.rejects(
    service.prepare(c, { ...input, items: [{ sku: '21', prices: { selling_price: 80 } }] }),
    /reused/
  );
  await db.collection('app_brand').insertOne({ _id: 'brand', enabled: true, name: 'GSHCL' });
  const wb = await service.sheet(c, { branches: 'all' });
  assert.match(wb.priceFilename, /^GSHCL-All-items-ABC-MKT-\d{4}-\d{2}-\d{2}-\d{4}$/);
  const ws = wb.worksheets[0],
    headers = ws.getRow(1).values.slice(1);
  assert.ok(headers.includes('Exported at'));
  assert.ok(headers.includes('Branch code'));
  ws.getRow(2).getCell(headers.indexOf('New Selling price') + 1).value = 78;
  const imported = await service.importSheet(
    c,
    { jobId: String(new ObjectId()), branches: 'all' },
    { originalname: 'renamed.xlsx', buffer: await wb.xlsx.writeBuffer() }
  );
  assert.equal(imported.counts.pending, 1);
  assert.equal(imported.job.exportedAt.length, 1);
  const list = await service.list(c, { page: 1, pageSize: 10 });
  assert.equal(list.total, 2);
});
test('exact numeric lookup preserves leading zeroes and excludes prefix matches', () => {
  const { exactNumericCodes } = require('../src/helpers/sales-search-fields');
  const normal = exactNumericCodes('21', ['sku']);
  assert.deepEqual(normal, [{ itemid: { $in: ['21', 21] } }, { item_code: { $in: ['21', 21] } }]);
  assert.deepEqual(exactNumericCodes('021', ['plu']), [
    { short_code: { $in: ['021'] } },
    { plu_code: { $in: ['021'] } },
  ]);
});

test('multi-branch conflicts retain their branch in recovery sheets and result reports', async () => {
  const r = await prepared({
    items: [
      {
        sku: '21',
        branchPrices: { [branchA]: { selling_price: 75 }, [branchB]: { selling_price: 80 } },
      },
    ],
  });
  await db.collection('items').updateOne({ _id: itemB }, { $set: { selling_price: 73 } });
  const result = await service.processBatch(c, r.job._id, false);
  assert.equal(result.counts.updated, 1);
  assert.equal(result.counts.conflict, 1);
  const wb = await service.sheet(c, { retryJobId: r.job._id });
  const ws = wb.worksheets[0],
    headers = ws.getRow(1).values.slice(1);
  assert.equal(ws.rowCount, 2);
  assert.equal(ws.getRow(2).getCell(headers.indexOf('Branch ID') + 1).value, String(branchB));
  assert.equal(ws.getRow(2).getCell(headers.indexOf('Current Selling price') + 1).value, 73);
  const report = (await service.sheet(c, { jobId: r.job._id })).worksheets[0];
  assert.equal(report.getRow(1).values.at(-1), 'Branch code');
  assert.equal(report.getRow(3).values.at(-1), 'MKT');
});

test('category selection maps to another selected branch without exposing other tenants', async () => {
  const catA = new ObjectId(),
    catB = new ObjectId(),
    foreign = new ObjectId();
  await db.collection('categories').insertMany([
    { _id: catA, license, branch_id: branchA, name: 'Vegetables' },
    { _id: catB, license, branch_id: branchB, name: 'Vegetables' },
    { _id: foreign, license: new ObjectId(), branch_id: branchB, name: 'Vegetables' },
  ]);
  const mapped = await scope.categoryFilter(c, String(catA), [String(branchB)]);
  assert.deepEqual(mapped.$in.map(String), [String(catB)]);
});

test('legacy catalogue writes preserve a held price but allow the same price and expired holds', async () => {
  const hold = require('../src/utils/selling-price-hold');
  const col = db.collection('items');
  await col.updateOne(
    { _id: itemA },
    { $set: { selling_price_hold_until: new Date(Date.now() + 86400000) } }
  );
  assert.equal(
    (await col.updateOne({ _id: itemA, ...hold.writable(80) }, { $set: { selling_price: 80 } }))
      .matchedCount,
    0
  );
  assert.equal(
    (await col.updateOne({ _id: itemA, ...hold.writable(70) }, { $set: { name: 'Beans renamed' } }))
      .matchedCount,
    1
  );
  await col.updateOne(
    { _id: itemA },
    { $set: { selling_price_hold_until: new Date(Date.now() - 1000) } }
  );
  assert.equal(
    (await col.updateOne({ _id: itemA, ...hold.writable(80) }, { $set: { selling_price: 80 } }))
      .matchedCount,
    1
  );
});

test('revoking a scoped API token prevents its scheduled changes', async () => {
  const tokenId = new ObjectId();
  const token = {
    _id: tokenId,
    license,
    usertype: 'api',
    active: true,
    access: { item: { read: true, write: true } },
    branch_access: [{ branch_id: branchA }],
  };
  await db.collection('api_tokens').insertOne(token);
  const tokenContext = await scope.context({ ...token, api_token: true }, branchA, license);
  const r = await service.prepare(tokenContext, {
    jobId: String(new ObjectId()),
    items: [{ sku: '21', prices: { selling_price: 90 } }],
  });
  await service.configure(tokenContext, r.job._id, { when: 'tomorrow' });
  await makeDue(r.job);
  await db.collection('api_tokens').updateOne({ _id: tokenId }, { $set: { active: false } });
  await worker.drain(db);
  assert.equal((await service.status(tokenContext, r.job._id)).job.status, 'attention');
  assert.equal((await db.collection('items').findOne({ _id: itemA })).selling_price, 70);
});

test('stale schedule edits and cancellation cannot replace a newer review', async () => {
  const r = await prepared();
  const first = await service.configure(c, r.job._id, { when: 'tomorrow', note: 'First' });
  await assert.rejects(service.configure(c, r.job._id, { when: 'now', note: 'Stale' }), /reload/);
  await assert.rejects(service.cancel(c, r.job._id), /reload/);
  const second = await service.configure(c, r.job._id, {
    when: 'tomorrow',
    revision: first.job.revision,
    note: 'Revised',
  });
  await assert.rejects(service.cancel(c, r.job._id, { revision: first.job.revision }), /reload/);
  assert.equal((await service.status(c, r.job._id)).job.note, 'Revised');
  await service.cancel(c, r.job._id, { revision: second.job.revision });
});

test('schedule status groups paginate without mixing completed or cancelled jobs', async () => {
  const r = await prepared();
  const original = await db.collection('price_sheet_jobs').findOne({ _id: r.job._id });
  for (let i = 0; i < 12; i++)
    await db
      .collection('price_sheet_jobs')
      .insertOne({ ...original, _id: new ObjectId(), status: 'scheduled' });
  for (const status of ['running', 'attention', 'complete', 'cancelled'])
    await db.collection('price_sheet_jobs').insertOne({ ...original, _id: new ObjectId(), status });
  const upcoming = await service.list(c, { status: 'upcoming', page: 2, pageSize: 10 });
  assert.equal(upcoming.total, 15);
  assert.equal(upcoming.jobs.length, 5);
  assert.ok(upcoming.jobs.every((j) => !['complete', 'cancelled'].includes(j.status)));
  for (const status of ['complete', 'cancelled']) {
    const result = await service.list(c, { status, page: 1, pageSize: 25 });
    assert.equal(result.total, 1);
    assert.equal(result.jobs[0].status, status);
  }
});
