// Run against a disposable MongoDB only; never a shop database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ctrl = require('../../src/controllers/variants.controller');
const Variant = require('../../src/models/variant.model');
const Activity = require('../../src/models/activity-log.model');
const license = new mongoose.Types.ObjectId();
const branch = new mongoose.Types.ObjectId();
const user = new mongoose.Types.ObjectId();
let mongo;
function req(extra = {}) {
  return {
    body: {},
    params: {},
    query: {},
    tenantContext: { licenseId: license, branchId: branch, branchName: 'Test shop' },
    user: { _id: user, license, branch_id: branch },
    ...extra,
  };
}
async function call(method, extra) {
  const res = {
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  await ctrl[method](req(extra), res);
  return res;
}
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'variant_regression' });
  await mongoose.connection.db.collection('branches').insertOne({ _id: branch, license });
});
after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test('create, list, open, edit and duplicate check agree on a variant', async () => {
  const created = await call('create', {
    body: { name: 'Size', product_type: ['Small', 'Large'] },
  });
  assert.equal(created.code, 201);
  const id = created.body.data;
  const list = await call('getAll');
  assert.ok(list.body.data.list.some((v) => v._id === id));
  const opened = await call('getOne', { params: { id } });
  assert.equal(opened.code, 200, JSON.stringify(opened.body));
  assert.equal((await call('getVariantDetails', { query: { id } })).code, 200);
  const saved = await Variant.findById(id).lean();
  assert.equal(String(saved.license), String(license));
  assert.equal(
    (await call('create', { body: { name: 'Size', product_type: ['Medium'] } })).code,
    406
  );
  assert.equal(
    (await call('update', { params: { id }, body: { name: 'Size', product_type: ['Medium'] } }))
      .code,
    200
  );
  assert.equal((await call('getOne', { params: { id } })).body.data.fields[0].name, 'Medium');
});
test('old unlicensed variants recover only through their verified owning branch', async () => {
  const old = await Variant.create({
    name: 'Legacy',
    branch_id: branch,
    fields: [{ name: 'Red' }],
    updated_date: new Date(0),
  });
  const beforeDate = new Date('2020-01-01');
  await Variant.updateOne({ _id: old._id }, { $set: { updated_date: beforeDate } });
  const result = await call('getOne', { params: { id: String(old._id) } });
  assert.equal(result.code, 200);
  const repaired = await Variant.findById(old._id).lean();
  assert.equal(String(repaired.license), String(license));
  assert.ok(repaired.updated_date > beforeDate);
  await call('getOne', { params: { id: String(old._id) } });
  assert.equal(
    (await Variant.findById(old._id).lean()).updated_date.getTime(),
    repaired.updated_date.getTime()
  );
});
test('foreign licences, foreign branches and unverified branches cannot be claimed', async () => {
  for (const data of [
    { branch_id: branch, license: new mongoose.Types.ObjectId() },
    { branch_id: new mongoose.Types.ObjectId() },
  ]) {
    const v = await Variant.create({ name: 'Foreign', fields: [{ name: 'X' }], ...data });
    assert.equal((await call('getOne', { params: { id: String(v._id) } })).code, 404);
    const saved = await Variant.findById(v._id).lean();
    assert.equal(String(saved.license), String(data.license));
  }
  const unverified = new mongoose.Types.ObjectId();
  const v = await Variant.create({
    name: 'Unverified',
    branch_id: unverified,
    fields: [{ name: 'X' }],
  });
  const result = await call('getOne', {
    params: { id: String(v._id) },
    tenantContext: { licenseId: license, branchId: unverified },
  });
  assert.equal(result.code, 404);
});
test('create and bulk delete produce valid audit records', async () => {
  const result = await call('create', { body: { name: 'Audit', product_type: ['Yes'] } });
  const id = result.body.data;
  assert.ok(await Activity.findOne({ entityId: id, action: 'create' }).lean());
  assert.equal((await call('legacyDelete', { body: { data: [id] } })).code, 200);
  assert.ok(
    await Activity.findOne({ action: 'delete', 'details.description': '1 variants deleted' }).lean()
  );
});

test('client-supplied ownership cannot override authenticated creation scope', async () => {
  const foreign = new mongoose.Types.ObjectId();
  const result = await call('create', {
    body: {
      name: 'Scoped',
      product_type: ['X'],
      license: String(foreign),
      branch_id: String(foreign),
    },
  });
  assert.equal(result.code, 201);
  const saved = await Variant.findById(result.body.data).lean();
  assert.equal(String(saved.license), String(license));
  assert.equal(String(saved.branch_id), String(branch));
  const audit = await Activity.findOne({ entityId: result.body.data, action: 'create' }).lean();
  assert.equal(String(audit.license), String(license));
  assert.equal(String(audit.branch), String(branch));
});
