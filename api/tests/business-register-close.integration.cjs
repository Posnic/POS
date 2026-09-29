'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const BaseModel = require('../src/models/base.model');
const { createBusinessAccess } = require('../src/services/business-access');
const { readRegisterClose } = require('../src/services/business-register-close');
const { prepareDesktopRegisterSummary } = require('../src/services/business-register-summary');
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

test('desktop preparation observes grace, includes older-invoice refunds and rejects ambiguous return sessions', async () => {
  const f = await fixture(),
    priorDesktop = process.env.POSNIC_DESKTOP;
  const branch = { ...f.context.branches[0], license: f.context.businessId };
  try {
    delete process.env.POSNIC_DESKTOP;
    await assert.rejects(prepareDesktopRegisterSummary(db, branch, f.sessionId), {
      code: 'desktop_required',
    });
    process.env.POSNIC_DESKTOP = '1';
    const source = await db.collection('cashregister').findOne({ _id: new ObjectId(f.sessionId) });
    await db.collection('sales').insertOne({
      _id: new ObjectId(),
      license: source.license,
      branch_id: source.branch_id,
      cashregister_id: f.sessionId,
      date: source.register_opendate,
      updated_date: source.register_opendate,
      sale_process: 'Add',
      sales_total: '100.00',
      items_return_total: 0,
      items_return: [],
    });
    const closed = await f.repository.registercloseUpdate({
      cash_register_id: f.sessionId,
      lock_device_id: 'till-a',
    });
    assert.equal(closed.status, true);
    await assert.rejects(prepareDesktopRegisterSummary(db, branch, f.sessionId), {
      code: 'close_grace_pending',
    });
    const now = () => closed.data.register_closedate.getTime() + 11 * 60000;
    const first = await prepareDesktopRegisterSummary(db, branch, f.sessionId, { now });
    assert.equal(first.billedSalesMinor, 10000);
    assert.equal(first.completedSales, 1);
    assert.equal(first.sourceComplete, false);
    const oldId = new ObjectId(),
      oldDate = new Date(source.register_opendate.getTime() - 86400000);
    await db.collection('sales').insertOne({
      _id: oldId,
      license: source.license,
      branch_id: source.branch_id,
      cashregister_id: String(new ObjectId()),
      date: oldDate,
      updated_date: closed.data.register_closedate,
      sale_process: 'PartialReturn',
      sales_total: '50.00',
      items_return_total: '20.00',
      items_return: [
        {
          returnArray: {
            returnObjId: new ObjectId(),
            returnDate: closed.data.register_closedate,
            itemsTotalAmount: '20.00',
          },
        },
      ],
    });
    await assert.rejects(prepareDesktopRegisterSummary(db, branch, f.sessionId, { now }), {
      code: 'return_register_unavailable',
    });
    // Contract fixture only: the current refund writer does not yet provide this field.
    await db
      .collection('sales')
      .updateOne(
        { _id: oldId },
        { $set: { 'items_return.0.returnArray.cashregister_id': f.sessionId } }
      );
    const second = await prepareDesktopRegisterSummary(db, branch, f.sessionId, { now });
    assert.equal(second.billedSalesMinor, 10000);
    assert.equal(second.refundsMinor, 2000);
    assert.equal(second.salesAfterReturnsMinor, 8000);
    assert.equal(second.completedSales, 1);
    assert.equal(second.sourceDocuments, 2);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      prepareDesktopRegisterSummary(db, branch, f.sessionId, { now, signal: cancelled.signal }),
      { code: 'cancelled' }
    );
  } finally {
    if (priorDesktop === undefined) delete process.env.POSNIC_DESKTOP;
    else process.env.POSNIC_DESKTOP = priorDesktop;
  }
});
