'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const BaseModel = require('../src/models/base.model');
const { createBusinessAccess } = require('../src/services/business-access');
const { readRegisterClose } = require('../src/services/business-register-close');
let mongo, client, db, RegisterRepository;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  BaseModel.mongoClient = client;
  BaseModel.database = client.db('close_bootstrap');
  RegisterRepository = require('../src/repositories/register.repository');
});
beforeEach(() => {
  db = client.db('register_close_' + new ObjectId());
  BaseModel.database = db;
});
after(async () => {
  await client?.close();
  await mongo?.stop();
  BaseModel.mongoClient = null;
  BaseModel.database = null;
});
async function fixture() {
  const license = new ObjectId(),
    branch = {
      _id: new ObjectId(),
      license,
      branch_name: 'Central',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
    };
  const user = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'cashier',
    branch_access: [{ branch_id: branch._id }],
    access: { dashboard: { read: true, financials: true } },
  };
  await db.collection('branches').insertOne(branch);
  await db.collection('users').insertOne(user);
  const context = await createBusinessAccess(db).contextFor(user),
    branchId = String(branch._id);
  const repository = new RegisterRepository({
    branchId: branch._id,
    licenseId: license,
    user,
    getCollection: async (name) => db.collection(name),
  });
  const opened = await repository.registeraddInsert({
    register_Id: String(new ObjectId()),
    register_name: 'Main till',
    opening_float: '100',
    lock_device_id: 'till-a',
  });
  assert.equal(opened.status, true);
  return { repository, context, branchId, sessionId: opened.data, user };
}
test('the actual close writer creates a stable scoped fact only after authorized close', async () => {
  const f = await fixture();
  assert.equal(await readRegisterClose(db, f.context, f.branchId, f.sessionId), null);
  const refused = await f.repository.registercloseUpdate({
    cash_register_id: f.sessionId,
    lock_device_id: 'wrong-till',
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(await readRegisterClose(db, f.context, f.branchId, f.sessionId), null);
  const closed = await f.repository.registercloseUpdate({
    cash_register_id: f.sessionId,
    lock_device_id: 'till-a',
  });
  assert.equal(closed.status, true);
  const fact = await readRegisterClose(db, f.context, f.branchId, f.sessionId);
  assert.equal(fact.sessionId, f.sessionId);
  assert.equal(fact.registerName, 'Main till');
  assert.equal(fact.closedAt, closed.data.register_closedate.toISOString());
  assert.equal(Date.parse(fact.eligibleAt) - Date.parse(fact.closedAt), 600000);
  assert.equal('closing_expected' in fact, false);
  const duplicate = await f.repository.registercloseUpdate({
    cash_register_id: f.sessionId,
    lock_device_id: 'till-a',
  });
  assert.equal(duplicate.statusCode, 409);
  assert.deepEqual(await readRegisterClose(db, f.context, f.branchId, f.sessionId), fact);
  const source = await db.collection('cashregister').findOne({ _id: new ObjectId(f.sessionId) });
  const next = await f.repository.registeraddInsert({
    register_Id: String(source.register_id),
    register_name: 'Main till',
    opening_float: '100',
    lock_device_id: 'till-a',
  });
  assert.equal(next.status, true);
  assert.notEqual(next.data, f.sessionId);
  assert.equal(await readRegisterClose(db, f.context, f.branchId, next.data), null);
  // Another session may be open in this branch. This fact makes no branch-close claim.
  assert.deepEqual(await readRegisterClose(db, f.context, f.branchId, f.sessionId), fact);
});
test('source rechecks reject lost access and withdraw a reopened or removed close', async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.repository.registercloseUpdate({
        cash_register_id: f.sessionId,
        lock_device_id: 'till-a',
      })
    ).status,
    true
  );
  assert.ok(await readRegisterClose(db, f.context, f.branchId, f.sessionId));
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { access: {} } });
  const current = await createBusinessAccess(db).contextFor(
    await db.collection('users').findOne({ _id: f.user._id })
  );
  await assert.rejects(readRegisterClose(db, current, f.branchId, f.sessionId), {
    code: 'access_denied',
  });
  await assert.rejects(readRegisterClose(db, f.context, String(new ObjectId()), f.sessionId), {
    code: 'access_denied',
  });
  assert.equal(
    await readRegisterClose(
      db,
      { ...f.context, businessId: String(new ObjectId()) },
      f.branchId,
      f.sessionId
    ),
    null
  );
  await db
    .collection('cashregister')
    .updateOne({ _id: new ObjectId(f.sessionId) }, { $set: { register_status: 'Opened' } });
  assert.equal(await readRegisterClose(db, f.context, f.branchId, f.sessionId), null);
  await db.collection('cashregister').deleteOne({ _id: new ObjectId(f.sessionId) });
  assert.equal(await readRegisterClose(db, f.context, f.branchId, f.sessionId), null);
});
