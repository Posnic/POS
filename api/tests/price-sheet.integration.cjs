const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const BaseModel = require('../src/models/base.model');
const service = require('../src/services/price-sheet');
let server, client, database;
const context = {
  branchId: new ObjectId().toString(),
  licenseId: new ObjectId().toString(),
  userName: 'Store owner',
  userId: new ObjectId().toString(),
};
const itemId = new ObjectId('123456789012345678901234');
test('rejects inherited field names and retains precise current prices for conflict checks', () => {
  assert.throws(
    () =>
      service.normalize(
        { id: String(itemId), changes: { constructor: { old: 0, value: 1 } } },
        true
      ),
    /Unsupported/
  );
  assert.equal(
    service.normalize(
      { id: String(itemId), changes: { selling_price: { old: 28.5714, value: 29 } } },
      false
    ).changes.selling_price.old,
    28.5714
  );
});
test('invalid raw values appear in reports and recovery sheets include only existing unresolved items', async () => {
  const job = await staged([row({ selling_price: { old: 20, value: '=bad' } })]);
  const report = await service.sheet(context, { jobId: job });
  assert.equal(report.worksheets[0].getRow(2).getCell(6).value, "'=bad");
  const retry = await service.sheet(context, { retryJobId: job });
  assert.equal(retry.worksheets[0].rowCount, 2);
});
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  database = client.db('pricing');
  BaseModel.getDb = async () => database;
});
after(async () => {
  await client?.close();
  await server?.stop();
});
beforeEach(async () => {
  for (const n of [
    'items',
    'price_sheet_jobs',
    'price_sheet_rows',
    'price_history',
    'bulk_price_updates',
  ])
    await database.collection(n).deleteMany({});
  await database.collection('items').insertOne({
    _id: itemId,
    branch_id: new ObjectId(context.branchId),
    license: new ObjectId(context.licenseId),
    name: 'Onion',
    itemid: '001',
    unit: 'Kg',
    selling_price: 20,
    company_price: 10,
    mrp_price: 30,
    available_quantity: 7,
  });
});
function row(changes = { selling_price: { old: 20, value: 22 } }) {
  return { id: itemId.toString(), name: 'Onion', changes };
}
async function staged(rows, allowZero = false) {
  const jobId = new ObjectId().toString();
  await service.create(context, { jobId, allowZero });
  await service.append(context, jobId, { start: 0, rows });
  await service.finish(context, jobId, rows.length);
  return jobId;
}
test('updates selected cost/MRP fields without selling-price, stock or sales changes', async () => {
  const job = await staged([
    row({ company_price: { old: 10, value: 12 }, mrp_price: { old: 30, value: 35 } }),
  ]);
  const result = await service.processBatch(context, job, false);
  assert.equal(result.counts.updated, 1);
  const it = await database.collection('items').findOne({ _id: itemId });
  assert.equal(it.company_price, 12);
  assert.equal(it.mrp_price, 35);
  assert.equal(it.selling_price, 20);
  assert.equal(it.available_quantity, 7);
  assert.equal(await database.collection('price_history').countDocuments({}), 2);
  assert.equal((await service.processBatch(context, job, false)).counts.updated, 1);
  assert.equal(await database.collection('price_history').countDocuments({}), 2);
});
test('blank/zero preservation and explicit zero confirmation', async () => {
  assert.deepEqual(
    service.normalize(
      row({ selling_price: { old: 20, value: '' }, company_price: { old: 10, value: 0 } }),
      false
    ).changes,
    {}
  );
  const job = await staged([row({ selling_price: { old: 20, value: 0 } })], true);
  await service.processBatch(context, job, false);
  assert.equal((await database.collection('items').findOne({ _id: itemId })).selling_price, 0);
});
test('invalid and duplicate rows do not change prices without explicit skipping', async () => {
  const job = await staged([row(), row()]);
  assert.equal((await service.status(context, job)).counts.invalid, 2);
  await assert.rejects(service.processBatch(context, job, false), /invalid/);
  await service.processBatch(context, job, true);
  assert.equal((await database.collection('items').findOne({ _id: itemId })).selling_price, 20);
  assert.throws(
    () => service.normalize(row({ available_quantity: { old: 7, value: 9 } }), false),
    /Unsupported/
  );
  assert.throws(() => service.money('2e4'));
});
test('branch and tenant isolation on jobs, exports and item matching', async () => {
  const job = await staged([row()]);
  const other = { ...context, branchId: new ObjectId().toString() };
  await assert.rejects(service.status(other, job), /not found|unauthorized/);
  assert.equal((await service.sheet(other)).worksheets[0].rowCount, 1);
  const otherJob = new ObjectId().toString();
  await service.create(other, { jobId: otherJob });
  await service.append(other, otherJob, { start: 0, rows: [row()] });
  assert.equal((await service.finish(other, otherJob, 1)).counts.skipped, 1);
});
test('changes after preview are conflicts and never overwrite new values', async () => {
  const job = await staged([row()]);
  await database.collection('items').updateOne({ _id: itemId }, { $set: { selling_price: 24 } });
  const result = await service.processBatch(context, job, false);
  assert.equal(result.counts.conflict, 1);
  assert.equal((await database.collection('items').findOne({ _id: itemId })).selling_price, 24);
});
test('recovering after item write/row acknowledgement cannot apply twice', async () => {
  const job = await staged([row()]);
  await service.processBatch(context, job, false);
  await database
    .collection('price_sheet_rows')
    .updateMany({ job_id: new ObjectId(job) }, { $set: { status: 'pending' } });
  await database
    .collection('price_sheet_jobs')
    .updateOne({ _id: new ObjectId(job) }, { $set: { status: 'running' } });
  await database.collection('items').updateOne({ _id: itemId }, { $set: { selling_price: 27 } });
  await service.processBatch(context, job, false);
  assert.equal((await database.collection('items').findOne({ _id: itemId })).selling_price, 27);
  assert.equal(await database.collection('price_history').countDocuments({}), 1);
});
test('XLSX round trip preserves IDs, blank fields and validates branch', async () => {
  const wb = await service.sheet(context, { fields: 'selling_price,company_price' }),
    ws = wb.worksheets[0];
  ws.getRow(2).getCell(ws.getRow(1).values.indexOf('New Selling price')).value = 23;
  const file = { originalname: 'prices.xlsx', buffer: await wb.xlsx.writeBuffer() };
  const result = await service.importSheet(context, { jobId: new ObjectId().toString() }, file);
  assert.equal(result.counts.pending, 1);
  assert.equal(result.rows[0].changes.selling_price.value, 23);
  assert.equal(result.rows[0].changes.company_price, undefined);
  const csv = await service.importSheet(
    context,
    { jobId: new ObjectId().toString() },
    { originalname: 'prices.csv', buffer: await wb.csv.writeBuffer() }
  );
  assert.equal(csv.rows[0].itemId, String(itemId));
  assert.equal(csv.counts.pending, 1);
  await assert.rejects(
    service.importSheet(
      { ...context, branchId: new ObjectId().toString() },
      { jobId: new ObjectId().toString() },
      file
    ),
    /different branch|unselected branch/
  );
});
test('CSV export filters and result reports do not return whole catalogue', async () => {
  assert.equal((await service.sheet(context, { search: 'Missing' })).worksheets[0].rowCount, 1);
  const job = await staged([row()]);
  const report = await service.sheet(context, { jobId: job });
  assert.equal(report.worksheets[0].rowCount, 2);
  assert.equal(report.worksheets[0].getRow(1).getCell(1).value, 'Row');
});
test(
  '10,000 items stage, validate and update in bounded batches with complete audit counts',
  { timeout: 180000 },
  async () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({
      _id: new ObjectId(),
      branch_id: new ObjectId(context.branchId),
      license: new ObjectId(context.licenseId),
      name: 'Product ' + i,
      selling_price: 10,
      company_price: 5,
      mrp_price: 20,
    }));
    await database.collection('items').insertMany(items);
    const jobId = new ObjectId().toString();
    await service.create(context, { jobId });
    const rows = items.map((it) => ({
      id: String(it._id),
      name: it.name,
      changes: { selling_price: { old: 10, value: 11 } },
    }));
    for (let start = 0; start < rows.length; start += 500)
      await service.append(context, jobId, { start, rows: rows.slice(start, start + 500) });
    assert.equal((await service.finish(context, jobId, 10000)).counts.pending, 10000);
    assert.equal((await service.status(context, jobId, 2)).rows[0].number, 51);
    let result,
      batches = 0;
    do {
      result = await service.processBatch(context, jobId, false);
      assert.ok(result.processed.length <= 100);
      batches++;
    } while (result.job.status !== 'complete');
    assert.equal(batches, 100);
    assert.equal(result.counts.updated, 10000);
    assert.equal(
      await database.collection('price_history').countDocuments({ batch_id: new ObjectId(jobId) }),
      10000
    );
    assert.equal(await database.collection('items').countDocuments({ selling_price: 11 }), 10000);
  }
);

test('styled Excel hides trailing IDs and sorted rows still update the correct duplicate-name item', async () => {
  const otherId = new ObjectId();
  await database.collection('items').insertOne({
    _id: otherId,
    branch_id: new ObjectId(context.branchId),
    license: new ObjectId(context.licenseId),
    name: 'Onion',
    itemid: '001',
    selling_price: 40,
    available_quantity: 0,
  });
  const wb = await service.sheet(context);
  const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), [
    'Item name',
    'SKU',
    'Unit',
    'Current Selling price',
    'New Selling price',
    'Branch ID',
    'Item ID',
    'Exported at',
    'Categories',
  ]);
  assert.equal(ws.getColumn(6).hidden, true);
  assert.equal(ws.getColumn(7).hidden, true);
  assert.equal(ws.views[0].ySplit, 1);
  const row2 = ws.getRow(2).values;
  ws.getRow(2).values = ws.getRow(3).values;
  ws.getRow(3).values = row2;
  const target = [ws.getRow(2), ws.getRow(3)].find((r) => r.getCell(7).value === String(otherId));
  target.getCell(5).value = 45;
  const file = { originalname: 'sorted.xlsx', buffer: await wb.xlsx.writeBuffer() };
  const result = await service.importSheet(context, { jobId: new ObjectId().toString() }, file);
  assert.equal(result.counts.pending, 1);
  assert.equal(result.counts.unchanged, 1);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].itemId, String(otherId));
  assert.equal((await service.status(context, result.job._id, 1, '')).total, 2);
  await service.processBatch(context, result.job._id, false);
  assert.equal((await database.collection('items').findOne({ _id: otherId })).selling_price, 45);
  assert.equal(
    (await database.collection('items').findOne({ _id: otherId })).available_quantity,
    0
  );
  assert.equal((await database.collection('items').findOne({ _id: itemId })).selling_price, 20);
  assert.equal((await service.sheet(context, { jobId: result.job._id })).worksheets[0].rowCount, 2);
});

test('legacy sheets with leading IDs still import and unchanged sheets show no changes', async () => {
  const header = 'Branch ID,Item ID,Item name,SKU,Unit,Current Selling price,New Selling price';
  const file = {
    originalname: 'legacy.csv',
    buffer: Buffer.from(
      header + '\n' + [context.branchId, String(itemId), 'Onion', '001', 'Kg', 20, 20].join(',')
    ),
  };
  const result = await service.importSheet(context, { jobId: new ObjectId().toString() }, file);
  assert.equal(result.total, 0);
  assert.equal(result.counts.unchanged, 1);
  assert.equal((await service.status(context, result.job._id, 1, 'unchanged')).total, 1);
});

test('CSV file import crosses the 500-row staging boundary and reviews only changed prices', async () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    _id: new ObjectId(),
    branch_id: new ObjectId(context.branchId),
    license: new ObjectId(context.licenseId),
    name: 'Sheet item ' + i,
    selling_price: 10,
  }));
  await database.collection('items').insertMany(items);
  const wb = await service.sheet(context, { search: 'Sheet item' });
  const ws = wb.worksheets[0];
  ws.getRow(2).getCell(5).value = 12;
  ws.getRow(502).getCell(5).value = 13;
  const result = await service.importSheet(
    context,
    { jobId: new ObjectId().toString() },
    {
      originalname: '501-items.csv',
      buffer: await wb.csv.writeBuffer(),
    }
  );
  assert.equal(result.job.total, 501);
  assert.equal(result.counts.pending, 2);
  assert.equal(result.counts.unchanged, 499);
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.rows.map((r) => r.number),
    [1, 501]
  );
  assert.equal((await service.processBatch(context, result.job._id, false)).counts.updated, 2);
});

test('multiple categories select the same union for paged editing and sheet export', async () => {
  const Repository = require('../src/repositories/item.repository');
  const repository = Object.create(Repository.prototype);
  repository.getCollection = async () => database.collection('items');
  const cats = [new ObjectId(), new ObjectId(), new ObjectId()];
  await database.collection('items').deleteMany({});
  const base = {
    branch_id: new ObjectId(context.branchId),
    license: new ObjectId(context.licenseId),
    selling_price: 20,
  };
  await database
    .collection('items')
    .insertMany(
      cats.map((category_id, i) => ({
        ...base,
        _id: new ObjectId(),
        name: 'Product ' + i,
        category_id,
      }))
    );
  await database
    .collection('items')
    .insertOne({
      ...base,
      _id: new ObjectId(),
      name: 'Other branch',
      branch_id: new ObjectId(),
      category_id: cats[0],
    });
  const query = { category: cats.slice(0, 2).join(',') };
  const grid = await repository.priceGrid(query, context);
  assert.equal(grid.total, 2);
  const sheet = await service.sheet(context, query);
  assert.equal(sheet.worksheets[0].rowCount, 3);
  assert.deepEqual(
    sheet.worksheets[0].getColumn(1).values.slice(2),
    grid.items.map((i) => i.name)
  );
  assert.equal((await repository.priceGrid({ category: String(cats[0]) }, context)).total, 1);
  assert.equal(
    (await repository.priceGrid({ category: query.category, search: 'missing' }, context)).total,
    0
  );
  await assert.rejects(repository.priceGrid({ category: 'invalid' }, context), /Invalid category/);
  await assert.rejects(service.sheet(context, { category: 'invalid' }), /Invalid category/);
});
