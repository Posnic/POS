// Exercise actual Mongo filters and writes, including imports and the desktop
// health scan. No shop database or customer records are used.
const { test, before: beforeAll, after: afterAll, beforeEach } = require('node:test');
const { expect } = require('expect');
const jest = require('jest-mock');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const BaseModel = require('../../src/models/base.model');
const Branch = require('../../src/models/branch.model');
const ItemRepository = require('../../src/repositories/item.repository');
const ItemService = require('../../src/services/item.service');
const { runDatabaseHealthCheck } = require('../../../src/database-health');

let mem, client, db, repo, ctx;
const code = '6223014652308';
const input = (overrides = {}) => ({
  name: 'Milk',
  sku_id: 'MILK',
  barcode_id: code,
  mrp_price: '10',
  company_price: '5',
  selling_price: '8',
  available_quantity: '0',
  track_inventory: false,
  ...overrides,
});
const csv = (overrides = {}) => ({
  name: 'Milk',
  itemid: 'MILK',
  barcode_id: code,
  supplier_name: 'Supplier',
  category_name: 'Groceries',
  discount_amount: 0,
  discount_percentage: 0,
  tax: 0,
  tax_type: 'exclusive',
  mrp_price: 10,
  company_price: 5,
  selling_price: 8,
  available_quantity: 0,
  unit: 'qty',
  sort_order: 1,
  ...overrides,
});
const seed = async (extra = {}) => {
  const doc = {
    name: 'Milk',
    itemid: 'MILK',
    barcode_id: code,
    license: ctx.licenseId,
    branch_id: ctx.branchId,
    branch_access: [{ branch_id: ctx.branchId }],
    ...extra,
  };
  const { insertedId } = await db.collection('items').insertOne(doc);
  return { ...doc, _id: insertedId };
};
beforeAll(
  async () => {
    mem = await MongoMemoryServer.create();
    client = await MongoClient.connect(mem.getUri());
    db = client.db('barcode-validation-test');
    BaseModel.database = db;
    jest.spyOn(Branch, 'findOne').mockImplementation((filter) => ({
      select: () => ({ lean: () => db.collection('branches').findOne(filter) }),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  },
  { timeout: 120000 }
);
beforeEach(async () => {
  await db.dropDatabase();
  ctx = { branchId: new ObjectId(), licenseId: new ObjectId() };
  await db.collection('branches').insertOne({
    _id: ctx.branchId,
    license: ctx.licenseId,
    branch_name: 'Main',
    register: [],
    cashdenom_fields: [],
    currency_value: [],
    time_zone: 'UTC',
  });
  repo = new ItemRepository();
  repo.checkPlan = jest.fn().mockResolvedValue(0);
  repo.logItemChanges = jest.fn().mockResolvedValue();
});
afterAll(async () => {
  Branch.findOne.mockRestore();
  console.log.mockRestore();
  BaseModel.database = null;
  await client?.close();
  await mem?.stop();
});

test('creation names the existing item and refuses a primary/alternate collision', async () => {
  await seed({ name: 'Milk small', barcode_id: 'SMALL', barcodes: [code] });
  const r = await repo.upsertItem(input({ name: 'Milk large' }), '', ctx);
  expect(r.status).toBe('exist');
  expect(r.message).toContain(code);
  expect(r.message).toContain('Milk small');
  expect(await db.collection('items').countDocuments()).toBe(1);
});

test('editing excludes itself in Mongo and still finds a second legacy duplicate', async () => {
  const own = await seed(); // this row is returned first by an unscoped findOne
  await seed({ name: 'Other milk', itemid: 'OTHER' });
  const r = await repo.upsertItem(input(), String(own._id), ctx);
  expect(r.status).toBe('exist');
  expect(r.message).toContain('Other milk');
  expect(await db.collection('items').findOne({ _id: own._id })).not.toHaveProperty('updated_date');
});

test('an item can keep its own barcode and can remove an old collision', async () => {
  const own = await seed();
  expect((await repo.upsertItem(input(), String(own._id), ctx)).status).toBe(true);
  await seed({ name: 'Other milk', itemid: 'OTHER' });
  expect((await repo.upsertItem(input({ barcode_id: 'NEW' }), String(own._id), ctx)).status).toBe(
    true
  );
});

test('deleted records, another shop and a disjoint branch do not reserve a barcode', async () => {
  await seed({ del_status: 1 });
  await seed({ license: new ObjectId() });
  await seed({ branch_access: [{ branch_id: new ObjectId() }] }); // stale branch_id
  expect((await repo.upsertItem(input({ name: 'New milk' }), '', ctx)).status).toBe(true);
});

test('legacy branch-only and multi-branch items reserve their scanned codes', async () => {
  const legacy = await seed({ name: 'Legacy', branch_access: [] });
  expect((await repo.upsertItem(input({ name: 'New' }), '', ctx)).status).toBe('exist');
  await db.collection('items').deleteOne({ _id: legacy._id });
  await seed({
    name: 'Shared',
    branch_id: new ObjectId(),
    branch_access: [{ branch_id: new ObjectId() }, { branch_id: ctx.branchId }],
  });
  const r = await repo.upsertItem(input({ name: 'New' }), '', ctx);
  expect(r.status).toBe('exist');
  expect(r.message).toContain('Shared');
});

test('blank barcodes are allowed and supplied alternate codes are normalized', async () => {
  expect(
    (
      await repo.upsertItem(
        input({ name: 'Loose rice', barcode_id: '', barcodes: [' ALT ', 'ALT'] }),
        '',
        ctx
      )
    ).status
  ).toBe(true);
  expect(
    (await repo.upsertItem(input({ name: 'Loose flour', barcode_id: '' }), '', ctx)).status
  ).toBe(true);
  const r = await repo.upsertItem(input({ name: 'Bag', barcode_id: 'ALT' }), '', ctx);
  expect(r.status).toBe('exist');
});

test('moving an item checks retained alternate codes in the target branch', async () => {
  const own = await seed({
    branch_access: [{ branch_id: new ObjectId() }],
    barcode_id: 'OLD',
    barcodes: ['ALT'],
  });
  await seed({ name: 'Other', barcode_id: 'ALT' });
  const r = await repo.upsertItem(input({ barcode_id: 'NEW' }), String(own._id), ctx);
  expect(r.status).toBe('exist');
  expect(r.message).toContain('ALT');
  expect((await db.collection('items').findOne({ _id: own._id })).barcode_id).toBe('OLD');
});

test('an import with two new items sharing a barcode writes nothing and names both rows', async () => {
  const r = await repo.importItems([csv(), csv({ name: 'Milk large', itemid: 'LARGE' })], ctx);
  expect(r.status).toBe(false);
  expect(r.message).toContain('CSV rows 2 and 3');
  expect(r.message).toContain(code);
  expect(r.message).toContain('Milk large');
  expect(r.message).toContain('Nothing was imported');
  for (const collection of ['items', 'suppliers', 'categories', 'grouptax', 'unit']) {
    expect(await db.collection(collection).countDocuments()).toBe(0);
  }
});

test('an import conflict against existing alternates rejects even earlier valid rows', async () => {
  await seed({ name: 'Existing milk', barcode_id: 'EXISTING', barcodes: [code] });
  const r = await repo.importItems(
    [csv({ name: 'Flour', itemid: 'FLOUR', barcode_id: 'FREE' }), csv()],
    ctx
  );
  expect(r.status).toBe(false);
  expect(r.message).toContain('CSV row 3');
  expect(r.message).toContain('Existing milk');
  expect(await db.collection('items').countDocuments()).toBe(1);
});

test('re-import keeps its own barcode, and rejects taking another item barcode', async () => {
  const own = await seed({ barcodes: ['ALT'] });
  const r = await repo.importItems([csv({ selling_price: 9 })], ctx);
  expect(r.status).toBe(true);
  expect(await db.collection('items').countDocuments()).toBe(1);
  expect((await db.collection('items').findOne({ _id: own._id })).barcodes).toEqual(['ALT']);
  await seed({ name: 'Other', barcode_id: 'TAKEN' });
  expect((await repo.importItems([csv({ barcode_id: 'TAKEN' })], ctx)).status).toBe(false);
  expect((await db.collection('items').findOne({ _id: own._id })).barcode_id).toBe(code);
});

test('two concurrent creates, or an import racing a create, cannot add the same code in this API', async () => {
  const results = await Promise.all([
    repo.upsertItem(input(), '', ctx),
    new ItemRepository().upsertItem(input({ name: 'Other' }), '', ctx),
    repo.importItems([csv({ name: 'Imported' })], ctx),
  ]);
  expect(results.filter((r) => r.status === true)).toHaveLength(1);
  expect(await db.collection('items').countDocuments()).toBe(1);
});

test('variants need different primary and alternate codes and roll back a database conflict', async () => {
  const svc = new ItemService();
  svc.repository = repo;
  const family = (items) => ({
    ...ctx,
    data: { items, variant_axis: 'Size', variant_parent_name: 'Milk' },
  });
  const a = input({ name: 'Milk small', variant_value: 'S', barcode_id: code });
  const b = input({
    name: 'Milk large',
    variant_value: 'L',
    barcode_id: 'LARGE',
    barcodes: [code],
  });
  expect((await svc.createItemFamily(family([a, b]))).status).toBe(false);
  expect(await db.collection('items').countDocuments()).toBe(0);
  await seed({ name: 'Existing large', barcode_id: 'LARGE' });
  const r = await svc.createItemFamily(family([a, { ...b, barcodes: [] }]));
  expect(r.status).toBe(false);
  expect(r.message).toContain('Existing large');
  expect(await db.collection('items').countDocuments()).toBe(1);
});

test('health report names variants, checks alternate codes and ignores tombstones and disjoint branches', async () => {
  await seed({ name: 'Milk', variant_value: 'Small', barcode_id: code, barcodes: [code, code] });
  await seed({ name: 'Milk', variant_value: 'Large', barcode_id: 'LARGE', barcodes: [code] });
  await seed({ del_status: true });
  await seed({ branch_access: [{ branch_id: new ObjectId() }] });
  await seed({ license: new ObjectId() });
  const before = await db.collection('items').find().toArray();
  const report = await runDatabaseHealthCheck({ db: () => db });
  expect(report.errors).toEqual([]);
  expect(report.duplicates).toHaveLength(1);
  expect(report.duplicates[0].count).toBe(2);
  expect(report.warnings[0]).toContain(`Barcode "${code}" is shared by 2 items`);
  expect(report.warnings[0]).toContain('Milk (Small)');
  expect(report.warnings[0]).toContain('Milk (Large)');
  expect(await db.collection('items').find().toArray()).toEqual(before);
});

test('names and barcode text cannot inject markup into a conflict toast', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  await seed({ name: malicious, barcode_id: malicious });
  const r = await repo.upsertItem(input({ name: 'Another', barcode_id: malicious }), '', ctx);
  expect(r.status).toBe('exist');
  expect(r.message).not.toContain('<img');
  expect(r.message).toContain('&lt;img');
});
