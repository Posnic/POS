'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  createBusinessDeviceDecisions,
  useDeviceGrant,
} = require('../src/services/business-device-decisions');
const { createBusinessAccess, hash, proof, opaque } = require('../src/services/business-access');
const { decide } = require('../src/services/business-decisions');
const bcrypt = require('bcryptjs');
let mongo, client;
const priorFlag = process.env.POSNIC_BUSINESS_DECISIONS;
before(async () => {
  process.env.POSNIC_BUSINESS_DECISIONS = '1';
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  if (priorFlag === undefined) delete process.env.POSNIC_BUSINESS_DECISIONS;
  else process.env.POSNIC_BUSINESS_DECISIONS = priorFlag;
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const db = client.db('device_decisions_' + new ObjectId()),
    license = new ObjectId();
  const branch = {
    _id: new ObjectId(),
    license,
    branch_name: 'Central',
    currency: 'INR',
    time_zone: 'Asia/Kolkata',
  };
  const cashier = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'cashier',
    authVersion: 3,
    branch_access: [{ branch_id: branch._id }],
    access: { sales: { write: true } },
  };
  const owner = {
    ...cashier,
    _id: new ObjectId(),
    usertype: 'admin',
    username: opaque(),
    password: await bcrypt.hash('Fixture-password-only', 4),
  };
  await db.collection('branches').insertOne(branch);
  await db.collection('users').insertMany([cashier, owner]);
  const device = { deviceId: 'till-' + crypto.randomUUID(), branches: [String(branch._id)] },
    bridge = createBusinessDeviceDecisions(db);
  const body = {
    branchId: String(branch._id),
    requesterId: String(cashier._id),
    requesterAuthVersion: 3,
    request: {
      operationId: crypto.randomUUID(),
      revisionHash: 'a'.repeat(64),
      summary: {
        currency: 'INR',
        currencyDigits: 2,
        beforeDiscountMinor: 10000,
        discountMinor: 2000,
        payableMinor: 8000,
        roundingMinor: 0,
        itemCount: 2,
        reason: 'Regular customer',
      },
    },
  };
  async function approval(row) {
    const access = createBusinessAccess(db),
      verifier = opaque();
    const pending = await access.request({
      codeChallenge: proof(verifier),
      deviceName: 'Owner phone',
    });
    await access.decide(pending.request, 'allow', owner.username, 'Fixture-password-only');
    const grant = await access.exchange(pending.request, verifier),
      identity = await access.authenticate(grant.token);
    return decide(db, identity.session._id, row.id, {
      decisionId: crypto.randomUUID(),
      expectedRevision: 0,
      outcome: 'approved',
      reason: '',
    });
  }
  async function grant(action, payload, overrides = {}) {
    const token = 'pbd1_' + opaque();
    await db.collection('business_device_grants').insertOne({
      _id: hash(token),
      protocolVersion: 1,
      tenantDb: db.databaseName,
      action,
      bodyHash: hash(JSON.stringify(payload)),
      device,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 5000),
      ...overrides,
    });
    return token;
  }
  return { db, license, branch, cashier, owner, device, bridge, body, approval, grant };
}
const is = (code) => (error) => error.code === code;
test('verified device creation binds cashier generation, exact amounts and installation scope', async () => {
  const f = await fixture(),
    row = await f.bridge.create(f.device, f.body);
  assert.equal((await f.bridge.create(f.device, f.body)).id, row.id);
  const stored = await f.db.collection('business_decisions').findOne({ _id: new ObjectId(row.id) });
  assert.equal(stored.requesterAuthVersion, 3);
  assert.equal(row.approverSessionId, undefined);
  for (const device of [
    { ...f.device, branches: [] },
    { ...f.device, branches: undefined },
    { ...f.device, branches: ['b'.repeat(24)] },
  ])
    await assert.rejects(f.bridge.create(device, f.body), is('branch_access_denied'));
  await assert.rejects(
    f.bridge.create(f.device, { ...f.body, deviceId: 'forged' }),
    is('invalid_device_request')
  );
  await assert.rejects(
    f.bridge.create(f.device, { ...f.body, requesterAuthVersion: 2 }),
    is('cashier_session_changed')
  );
  await assert.rejects(
    f.bridge.create(f.device, {
      ...f.body,
      request: { ...f.body.request, summary: { ...f.body.request.summary, currency: 'USD' } },
    }),
    is('branch_configuration_changed')
  );
  const ref = { branchId: f.body.branchId, requesterId: f.body.requesterId, requestId: row.id };
  await assert.rejects(
    f.bridge.read({ ...f.device, deviceId: crypto.randomUUID() }, ref),
    is('request_not_found')
  );
  await f.db
    .collection('users')
    .updateOne({ _id: f.cashier._id }, { $set: { 'access.sales.write': false } });
  await assert.rejects(f.bridge.read(f.device, ref), is('cashier_access_denied'));
});
test('a new claim rechecks cashier/approver access and never reissues an execution proof', async () => {
  const f = await fixture(),
    row = await f.bridge.create(f.device, f.body);
  await f.approval(row);
  const input = {
    branchId: f.body.branchId,
    requesterId: f.body.requesterId,
    requestId: row.id,
    revisionHash: row.revisionHash,
    executionId: crypto.randomUUID(),
  };
  await f.db.collection('users').updateOne({ _id: f.cashier._id }, { $inc: { authVersion: 1 } });
  await assert.rejects(f.bridge.claim(f.device, input), is('cashier_session_changed'));
  await f.db.collection('users').updateOne({ _id: f.cashier._id }, { $set: { authVersion: 3 } });
  await f.db.collection('users').updateOne({ _id: f.owner._id }, { $set: { branch_access: [] } });
  await assert.rejects(f.bridge.claim(f.device, input), is('access_denied'));
  await f.db
    .collection('users')
    .updateOne({ _id: f.owner._id }, { $set: { branch_access: [{ branch_id: f.branch._id }] } });
  const races = await Promise.allSettled([
    f.bridge.claim(f.device, input),
    f.bridge.claim(f.device, input),
  ]);
  assert.equal(
    races.filter((r) => r.status === 'fulfilled' && r.value.executionPermit === 'start').length,
    1
  );
  const winner = races.find(
    (r) => r.status === 'fulfilled' && r.value.executionPermit === 'start'
  ).value;
  assert.deepEqual(Object.keys(winner.proof).sort(), [
    'approverId',
    'decisionId',
    'executionId',
    'revisionHash',
  ]);
  assert.equal(winner.record.approverSessionId, undefined);
  await f.db.collection('users').updateMany({}, { $set: { disabled: true } });
  const recovered = await f.bridge.claim(f.device, input);
  assert.equal(recovered.executionPermit, 'reconcile');
  assert.equal(recovered.proof, null);
  const saleId = new ObjectId();
  await assert.rejects(
    f.bridge.acknowledge(f.device, { ...input, revisionHash: undefined, saleId: String(saleId) }),
    is('invalid_device_request')
  );
  const ack = {
    branchId: input.branchId,
    requesterId: input.requesterId,
    requestId: input.requestId,
    executionId: input.executionId,
    saleId: String(saleId),
  };
  await assert.rejects(f.bridge.acknowledge(f.device, ack), is('sale_receipt_unconfirmed'));
  await f.db
    .collection('sales')
    .insertOne({
      _id: saleId,
      license: f.license,
      branch_id: f.branch._id,
      billing_transaction_id: row.operationId,
      business_decision_receipt: {
        version: 1,
        ...winner.proof,
        operationId: row.operationId,
        deviceId: f.device.deviceId,
        requesterId: f.body.requesterId,
        currency: 'INR',
        currencyDigits: 2,
        payableMinor: 8000,
        discountMinor: 2000,
      },
    });
  assert.equal((await f.bridge.acknowledge(f.device, ack)).state, 'applied');
  assert.equal((await f.bridge.claim(f.device, input)).executionPermit, 'complete');
  assert.equal((await f.bridge.claim(f.device, input)).proof, null);
});
test('Gateway grants are exact-operation, short-lived, tenant-bound and atomically single-use', async () => {
  const f = await fixture();
  for (const token of ['pb1_' + opaque(), 'pbd1_' + opaque()])
    await assert.rejects(
      useDeviceGrant(f.db, token, 'create', f.body),
      is('device_grant_required')
    );
  for (const overrides of [
    { tenantDb: 'other_tenant' },
    { expiresAt: new Date(Date.now() - 1) },
    { issuedAt: new Date(Date.now() - 6000) },
    { issuedAt: new Date(Date.now() + 2000) },
  ])
    await assert.rejects(
      useDeviceGrant(f.db, await f.grant('create', f.body, overrides), 'create', f.body),
      is('device_grant_required')
    );
  const token = await f.grant('create', f.body);
  await assert.rejects(useDeviceGrant(f.db, token, 'cancel', f.body), is('device_grant_required'));
  await assert.rejects(
    useDeviceGrant(f.db, token, 'create', { ...f.body, requesterAuthVersion: 7 }),
    is('device_grant_required')
  );
  const results = await Promise.allSettled([
    useDeviceGrant(f.db, token, 'create', f.body),
    useDeviceGrant(f.db, token, 'create', f.body),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await f.db.collection('business_decisions').countDocuments(), 1);
  assert.equal(
    await f.db.collection('business_device_grants').countDocuments({ _id: hash(token) }),
    0
  );
});
