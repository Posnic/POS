'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const products = require('../src/services/mobile-products');
const mobile = require('../src/services/mobile-pos');
let server, client, db, req, license, branch, user;
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('products');
});
after(async () => {
  await client?.close();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  license = new ObjectId();
  branch = new ObjectId();
  user = new ObjectId();
  await db
    .collection('branches')
    .insertOne({ _id: branch, license, module_mobile_pos_enable: true });
  req = {
    db,
    user: { _id: user, usertype: 'owner', username: 'Owner' },
    tenantContext: { licenseId: String(license), branchId: String(branch) },
    body: {
      id: 'product-test-00001',
      scope: {
        shopId: mobile.hash(String(license)).slice(0, 24),
        branchId: String(branch),
        staffId: String(user),
      },
      product: {
        name: 'Milk 1 L',
        barcode: '8900000000001',
        price: 6500,
        cost: 5000,
        mrp: 7000,
        opening: 12000,
        tracked: true,
        weighed: false,
        taxInclusive: true,
        available: true,
      },
    },
  };
});
test('product and opening stock are created once across concurrent retries; later sales are not overwritten', async () => {
  const [a, b] = await Promise.all([products.create(req), products.create(req)]);
  assert.equal(a.item.id, b.item.id);
  const where = { _id: new ObjectId(a.item.id) };
  assert.equal((await db.collection('items').findOne(where)).available_quantity, 12);
  await db.collection('items').updateOne(where, { $inc: { available_quantity: -2 } });
  await products.create(req);
  assert.equal((await db.collection('items').findOne(where)).available_quantity, 10);
  assert.equal(await db.collection('items').countDocuments(), 1);
  assert.equal(await db.collection('stocklogs').countDocuments(), 1);
  const log = await db.collection('stocklogs').findOne({});
  assert.equal(log.opening_balance, 0);
  assert.equal(log.closing_balance, 12);
  assert.equal(String(log.changed_by_userid), String(user));
});
test('interrupted creation recovers the opening audit without reapplying stock', async () => {
  await assert.rejects(
    products.create(req, {
      afterInsert: () => {
        throw Error('crash');
      },
    }),
    /crash/
  );
  assert.equal(await db.collection('stocklogs').countDocuments(), 0);
  await products.create(req);
  assert.equal(await db.collection('stocklogs').countDocuments(), 1);
  assert.equal((await db.collection('items').findOne({})).available_quantity, 12);
});
test('hidden and alternate barcode matches prevent accidental recreation', async () => {
  await db
    .collection('items')
    .insertOne({
      _id: new ObjectId(),
      license,
      branch_id: branch,
      name: 'Hidden milk',
      available_for_sale: false,
      barcode_id: 'different',
      barcodes: ['8900000000001'],
    });
  await assert.rejects(products.create(req), { status: 409 });
  assert.equal(await db.collection('stocklogs').countDocuments(), 0);
});
test('changed replay, revoked permission and another branch are rejected', async () => {
  await products.create(req);
  req.body.product.opening = 20000;
  await assert.rejects(products.create(req), { status: 409 });
  req.body.product.opening = 12000;
  req.body.scope.branchId = String(new ObjectId());
  await assert.rejects(products.create(req), { status: 409 });
  req.user = { _id: user, usertype: 'employee', access: {} };
  await assert.rejects(products.create(req), { status: 403 });
});
test('explicit zero and fractional opening are supported; whole units reject fractions', async () => {
  req.body.product.opening = 0;
  await products.create(req);
  assert.equal((await db.collection('stocklogs').findOne({})).closing_balance, 0);
  req.body.id = 'product-test-00002';
  req.body.product.barcode = 'new';
  req.body.product.opening = 1250;
  await assert.rejects(products.create(req), { status: 400 });
  req.body.product.weighed = true;
  req.body.product.unit = 'kg';
  const result = await products.create(req);
  assert.equal(result.item.quantityScale, 1000);
  assert.equal(result.item.quantity, 1250);
});
test('category/supplier/tax choices are scoped; invalid references cannot create an item', async () => {
  const tax = new ObjectId();
  await db
    .collection('grouptax')
    .insertOne({ _id: tax, license, branch_id: branch, name: 'VAT 5%', rate: 5, tax_fields: [] });
  await db
    .collection('categories')
    .insertOne({ _id: new ObjectId(), license, branch_id: new ObjectId(), name: 'Other branch' });
  const options = await products.options(req);
  assert.equal(options.categories.length, 0);
  assert.equal(options.taxes[0].rate, 5);
  req.body.product.taxId = String(tax);
  const result = await products.create(req);
  assert.equal(result.item.taxBps, 500);
  req.body.id = 'product-test-00003';
  req.body.product.barcode = 'other';
  req.body.product.categoryId = String(new ObjectId());
  await assert.rejects(products.create(req), { status: 409 });
});
const receipt = require('../src/services/mobile-receipt-design');
test('product lookup includes hidden primary/alternate matches without requiring inventory mode', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { mobile_inventory_enabled: false } });
  await db.collection('items').insertMany([
    {
      _id: new ObjectId(),
      license,
      branch_id: branch,
      name: 'Hidden',
      barcode_id: 'other',
      barcodes: ['000123'],
      available_for_sale: false,
      selling_price: 12,
    },
    {
      _id: new ObjectId(),
      license,
      branch_id: branch,
      name: 'Available',
      barcode_id: '000123',
      selling_price: 15,
    },
    {
      _id: new ObjectId(),
      license,
      branch_id: new ObjectId(),
      name: 'Another branch',
      barcode_id: '000123',
    },
  ]);
  req.query = { barcode: '000123' };
  const result = await products.lookup(req);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.filter((r) => !r.active).length, 1);
  assert.deepEqual(result.rows.map((r) => r.price).sort(), [1200, 1500]);
  req.user = { _id: user, usertype: 'employee', access: {} };
  await assert.rejects(products.lookup(req), { status: 403 });
});
test('receipt snapshot contains only printable branch data and reports unavailable assets', async () => {
  const contract = require('../src/helpers/receipt-design');
  const design = contract.normalize({
    version: 1,
    defaultFormat: '80',
    layouts: Object.fromEntries(
      Object.keys(contract.formats).map((k) => [
        k,
        {
          fontSize: 12,
          blocks: ['store', 'transaction', 'items', 'totals'].map((type) => ({
            id: type,
            type,
            enabled: true,
          })),
        },
      ])
    ),
  });
  const source = {
    receipt_designs: design,
    branch_name: 'Receipt shop',
    store_email: 'receipt@example.com',
    secret: 'must not leak',
  };
  const a = await receipt.profile(source);
  assert.equal(a.data.branch_name, 'Receipt shop');
  assert.equal(a.data.secret, undefined);
  assert.equal(a.assetsComplete, true);
  const b = await receipt.profile({ ...source, branch_name: 'Changed' });
  assert.notEqual(a.version, b.version);
  const missing = await receipt.profile({ ...source, logo: 'https://untrusted.example/logo.png' });
  assert.equal(missing.assetsComplete, false);
  assert.equal(missing.data.logo, undefined);
  assert.equal(await receipt.profile({ branch_name: 'Legacy' }), null);
  assert.equal(await receipt.profile({ receipt_designs: { broken: true } }), null);
});
