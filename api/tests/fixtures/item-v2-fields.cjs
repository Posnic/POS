const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const mocks = require('jest-mock');
const BaseModel = require('../../src/models/base.model');
const Branch = require('../../src/models/branch.model');
const ItemService = require('../../src/services/item.service');
const fixture = require('./item-v2-input.json');
let mongo, client, db, service, ctx, branchSpy;
before(
  async () => {
    mongo = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongo.getUri());
    db = client.db('item-v2-fields');
    BaseModel.database = db;
    ctx = { branchId: new ObjectId(), licenseId: new ObjectId() };
    await db
      .collection('branches')
      .insertOne({
        _id: ctx.branchId,
        license: ctx.licenseId,
        branch_name: 'Test',
        register: [],
        cashdenom_fields: [],
        currency_value: [],
        time_zone: 'UTC',
      });
    branchSpy = mocks
      .spyOn(Branch, 'findOne')
      .mockImplementation((filter) => ({
        select: () => ({ lean: () => db.collection('branches').findOne(filter) }),
      }));
    service = new ItemService();
    service.repository.checkPlan = async () => 0;
    service.repository.logItemChanges = async () => {};
  },
  { timeout: 120000 }
);
after(async () => {
  branchSpy?.mockRestore();
  BaseModel.database = null;
  await client?.close();
  await mongo?.stop();
});
test('advanced item fields from the v2 browser persist and read back', async () => {
  const supplierId = new ObjectId(),
    categoryId = new ObjectId(),
    unitId = new ObjectId();
  const data = {
    ...fixture,
    supplier_id: String(supplierId),
    category_id: String(categoryId),
    unit_id: String(unitId),
    image: [],
    cover_image: 'item.svg',
  };
  const result = await service.addItem({ data, ...ctx });
  assert.equal(result.status, true, JSON.stringify(result));
  const item = await db.collection('items').findOne({ name: fixture.name });
  assert.ok(item);
  for (const key of [
    'mrp_price',
    'company_price',
    'selling_price',
    'available_quantity',
    'unit',
    'reorder_point',
    'discount_amount',
    'conversion_factor',
    'purchase_unit',
    'brand',
    'items_mfg_date',
    'items_expiry_date',
    'description',
    'default_language',
    'plu_code',
    'gtin',
    'tile_color',
    'tile_shape',
  ])
    assert.deepEqual(item[key], data[key], key);
  assert.equal(String(item.supplier_id), data.supplier_id);
  assert.equal(String(item.category_id), data.category_id);
  assert.deepEqual(item.translations, fixture.translations);
  assert.deepEqual(item.tags, fixture.tags);
  assert.deepEqual(item.barcodes, fixture.barcodes);
  assert.equal(item.gtin14, '04006381333931');
  assert.equal(item.track_inventory, true);
  assert.equal(item.hsncode, '3304');
  assert.equal(item.tax, 5);
  const legacy = { ...data };
  delete legacy.gtin;
  let updated = await service.updateItem({ id: String(item._id), data: legacy, ...ctx });
  assert.equal(updated.status, true);
  assert.equal((await db.collection('items').findOne({ _id: item._id })).gtin, data.gtin);
  updated = await service.updateItem({
    id: String(item._id),
    data: { ...data, gtin: 'invalid' },
    ...ctx,
  });
  assert.equal(updated.status, true);
  const cleared = await db.collection('items').findOne({ _id: item._id });
  assert.equal(cleared.gtin, '');
  assert.equal(cleared.gtin14, '');
});
test('restaurant details and open-price service survive persistence', async () => {
  const dish = {
    ...fixture,
    name: 'V2 dish',
    sku_id: 'V2-DISH',
    barcode_id: 'DISH',
    barcodes: [],
    gtin: '',
    image: [],
    cover_image: 'item.svg',
    supplier_id: '',
    category_id: '',
    unit_id: '',
    inventory: false,
    discount_amount: 0,
    discount_percentage: 2.5,
    diet: 'veg',
    daypart_ids: ['lunch'],
    prep_minutes: 12,
    prep_note: 'Serve hot',
    nutrition: { kcal: 300, protein_g: 12 },
    food_tags: ['organic'],
    menu_marks: ['signature'],
    spice_choice: true,
    channel_off: ['online'],
    show_on_menu: false,
  };
  let r = await service.addItem({ data: dish, ...ctx });
  assert.equal(r.status, true, JSON.stringify(r));
  const stored = await db.collection('items').findOne({ name: dish.name });
  for (const key of [
    'diet',
    'daypart_ids',
    'prep_minutes',
    'prep_note',
    'food_tags',
    'menu_marks',
    'spice_choice',
    'channel_off',
    'show_on_menu',
  ])
    assert.deepEqual(stored[key], dish[key], key);
  assert.equal(stored.nutrition.kcal, 300);
  assert.equal(stored.discount_percentage, 2.5);
  r = await service.addItem({
    data: {
      ...dish,
      name: 'V2 service',
      sku_id: 'V2-SERVICE',
      barcode_id: 'SERVICE',
      item_kind: 'service',
      service_unit: 'hour',
      open_price: true,
      selling_price: 0,
    },
    ...ctx,
  });
  assert.equal(r.status, true, JSON.stringify(r));
  const saved = await db.collection('items').findOne({ name: 'V2 service' });
  assert.equal(saved.item_kind, 'service');
  assert.equal(saved.open_price, true);
  assert.equal(saved.service_unit, 'hour');
  assert.equal(saved.track_inventory, false);
});
test('variant family stores independent prices, stock and identity', async () => {
  const rows = ['S', 'M'].map((v, i) => ({
    ...fixture,
    name: 'V2 shirt / ' + v,
    variant_value: v,
    sku_id: 'V2-' + v,
    barcode_id: 'V2-' + v,
    barcodes: [],
    gtin: '',
    image: [],
    cover_image: 'item.svg',
    supplier_id: '',
    category_id: '',
    unit_id: '',
    selling_price: 200 + i * 50,
    available_quantity: i + 2,
  }));
  const r = await service.createItemFamily({
    data: { items: rows, variant_axis: 'Size', variant_parent_name: 'V2 shirt' },
    ...ctx,
  });
  assert.equal(r.status, true, JSON.stringify(r));
  const stored = await db
    .collection('items')
    .find({ variant_parent_name: 'V2 shirt' })
    .sort({ selling_price: 1 })
    .toArray();
  assert.equal(stored.length, 2);
  assert.deepEqual(
    stored.map((r) => r.available_quantity),
    [2, 3]
  );
  assert.deepEqual(
    stored.map((r) => r.selling_price),
    [200, 250]
  );
});
