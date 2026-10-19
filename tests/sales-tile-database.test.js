const { describe, test, before: beforeAll, after: afterAll } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('../api/node_modules/mongodb');
const { withDatabase, ciDatabaseName } = require('../api/tests/api/ci-database');
const demoData = require('../api/src/services/demo-data');
const originalDemoFilter = demoData.filter;
const ItemRepository = require('../api/src/repositories/item.repository');
const CategoryRepository = require('../api/src/repositories/category.repository');
const SettingsRepository = require('../api/src/repositories/settings.repository');
const originalResolveGroup = SettingsRepository.prototype.resolveGroup;
const describeDb = process.env.CI_MONGODB_URI ? describe : describe.skip;

describeDb('sales shelves page families in the database', () => {
  let client, db, repo;
  const branchId = new ObjectId(), licenseId = new ObjectId(), categoryId = new ObjectId();
  const context = { branchId, licenseId };
  beforeAll(async () => {
    client = new MongoClient(withDatabase(process.env.CI_MONGODB_URI, ciDatabaseName()), { serverSelectionTimeoutMS: 3000 });
    await client.connect(); db = client.db(); demoData.filter = async () => ({});
    SettingsRepository.prototype.resolveGroup = async () => ({ status: true, data: { values: {} } });
    repo = Object.create(ItemRepository.prototype); repo.collectionName = 'items'; repo.getCollection = async () => db.collection('items');
    const row = (name, extra = {}) => ({ name, branch_access: [{ branch_id: branchId }], license: licenseId,
      category_id: categoryId, track_inventory: false, selling_price: 1, ...extra });
    await db.collection('items').insertMany([
      ...Array.from({ length: 101 }, (_, i) => row('Item ' + String(i).padStart(3, '0'), { barcode_id: 'BC' + i })),
      row('Family A', { variant_group_id: 'family', variant_value: 'S' }),
      row('ZZ Family B', { variant_group_id: 'family', variant_value: 'L' }),
      row('Zero stock', { track_inventory: true, available_quantity: 0, barcode_id: 'EMPTY' }),
      row('Negative stock', { track_inventory: true, available_quantity: -2 }),
      row('Excluded ISO expiry', { items_expiry_date: '2000-01-01' }),
      row('Excluded epoch expiry', { items_expiry_date: '946684800000' }),
      row('Excluded deleted', { del_status: 1 }),
      row('Excluded branch', { branch_access: [{ branch_id: new ObjectId() }] }),
      row('Excluded tenant', { license: new ObjectId() }),
    ]);
  });
  afterAll(async () => { demoData.filter = originalDemoFilter; SettingsRepository.prototype.resolveGroup = originalResolveGroup; if (db) await db.dropDatabase(); if (client) await client.close(); });
  test('48 tiles on the first page, complete family, every item reachable exactly once', async () => {
    let offset = 0, ids = [];
    const first = await repo.getOnlineSalesItems({ tilePage: true, limit: 48 }, context);
    assert.equal(first.status, true); assert.equal(first.next_offset, 48);
    assert.equal(first.data.filter(i => i.variant_group_id === 'family').length, 2);
    do {
      const page = await repo.getOnlineSalesItems({ tilePage: true, limit: 48, offset }, context);
      assert.equal(page.status, true);
      const tiles = new Set(page.data.map(i => i.variant_group_id || i.id));
      assert.ok(tiles.size <= 48);
      assert.equal(page.data.some(i => i.name.startsWith('Excluded')), false);
      ids.push(...page.data.map(i => i.id)); offset = page.next_offset;
    } while (offset !== null);
    assert.equal(ids.length, 105); assert.equal(new Set(ids).size, 105);
  });
  test('a zero-stock imported catalogue stays visible without changing its stock policy', async () => {
    const page = await repo.getOnlineSalesItems({ tilePage: true, limit: 48 }, context);
    let rows = page.data, offset = page.next_offset;
    while (offset !== null) {
      const next = await repo.getOnlineSalesItems({ tilePage: true, limit: 48, offset }, context);
      rows = rows.concat(next.data); offset = next.next_offset;
    }
    const zero = rows.find(i => i.name === 'Zero stock');
    assert.equal(zero.available_quantity, '0');
    assert.equal(zero.track_inventory, true);
    assert.equal(zero.negative_stock, false);
    const search = await repo.getOnlineItemsAjaxList({ query: 'Zero stock' }, context);
    assert.equal(search.status, true);
    assert.ok(search.data.some(i => i.name === 'Zero stock' || i.item_name === 'Zero stock'));
  });
  test('category scope and full-catalogue barcode search do not depend on loaded pages', async () => {
    const empty = await repo.getOnlineSalesItems({ tilePage: true, categoryId: String(new ObjectId()) }, context);
    assert.deepEqual(empty.data, []); assert.equal(empty.next_offset, null);
    const result = await repo.getOnlineItemsAjaxList({ query: 'BC100', type: 'barcode' }, context);
    assert.equal(result.status, true); assert.ok(result.data.some(i => i.name === 'Item 100' || i.item_name === 'Item 100'));
  });
  test('categories containing only sold-out products remain visible and deleted products do not count', async () => {
    const otherBranch = new ObjectId(), stockedCategory = new ObjectId(), deletedCategory = new ObjectId();
    await db.collection('categories').insertMany([
      { _id: stockedCategory, name: 'Sold out', branch_id: otherBranch, license: licenseId },
      { _id: deletedCategory, name: 'Deleted only', branch_id: otherBranch, license: licenseId },
    ]);
    await db.collection('items').insertMany([
      { category_id: stockedCategory, branch_access: [{ branch_id: otherBranch }], license: licenseId, track_inventory: true, available_quantity: 0 },
      { category_id: deletedCategory, branch_access: [{ branch_id: otherBranch }], license: licenseId, track_inventory: true, available_quantity: 0, del_status: 1 },
    ]);
    const categories = Object.create(CategoryRepository.prototype);
    categories.model = { aggregate: pipeline => db.collection('categories').aggregate(pipeline).toArray() };
    const result = await categories.findByBranchWithItems(otherBranch, { license: licenseId });
    assert.deepEqual(result.map(r => r.name), ['Sold out']);
  });
});
