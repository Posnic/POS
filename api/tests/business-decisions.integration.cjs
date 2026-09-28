'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  createDecisionLedger,
  revisionHash,
  LIFETIME_MS,
} = require('../src/services/business-decision-ledger');
let mongo, client, db, clock, ledger;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
});
beforeEach(() => {
  db = client.db('decisions_' + new ObjectId());
  clock = Date.parse('2026-09-28T10:00:00Z');
  ledger = createDecisionLedger(db, { now: () => clock });
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
function fixture() {
  const source = {
    businessId: String(new ObjectId()),
    branchId: String(new ObjectId()),
    requesterId: String(new ObjectId()),
    deviceId: 'desktop-00000000001',
  };
  const context = {
    businessId: source.businessId,
    accountId: String(new ObjectId()),
    branches: [{ id: source.branchId }],
    capabilities: ['discounts.approve'],
  };
  const intent = {
    items: [{ id: 'item-one', quantity: 2, price: 5000 }],
    discountMinor: 2000,
    payableMinor: 8000,
  };
  const input = {
    operationId: 'bill-operation-0001',
    revisionHash: revisionHash(intent),
    summary: {
      currency: 'INR',
      currencyDigits: 2,
      beforeDiscountMinor: 10000,
      discountMinor: 2000,
      payableMinor: 8000,
      itemCount: 1,
      reason: 'Regular customer',
    },
  };
  return { source, context, input, intent };
}
const decision = (overrides = {}) => ({
  decisionId: 'decision-0000000001',
  expectedRevision: 0,
  outcome: 'approved',
  reason: '',
  ...overrides,
});
test('bill hash is deterministic and changes for item, quantity, price and payment intent; ambiguous values and credentials are rejected', () => {
  const f = fixture();
  assert.equal(revisionHash({ b: 2, a: 1 }), revisionHash({ a: 1, b: 2 }));
  for (const change of [
    { ...f.intent, payableMinor: 8001 },
    { ...f.intent, items: [{ ...f.intent.items[0], quantity: 3 }] },
    { ...f.intent, customerId: 'another' },
  ])
    assert.notEqual(revisionHash(change), f.input.revisionHash);
  for (const bad of [
    { x: NaN },
    { x: undefined },
    { token: 'secret' },
    { approval_token: 'secret' },
    new Date(),
    { x: 'a'.repeat(8193) },
  ])
    assert.throws(() => revisionHash(bad), { code: 'invalid_bill_intent' });
});
test('duplicate requests and decisions survive lost responses; concurrent approvers cannot overwrite the winner', async () => {
  const f = fixture();
  const copies = await Promise.all([
    ledger.create(f.source, f.input),
    ledger.create(f.source, f.input),
  ]);
  assert.equal(String(copies[0]._id), String(copies[1]._id));
  const requestId = String(copies[0]._id);
  const results = await Promise.allSettled([
    ledger.decide(f.context, requestId, decision()),
    ledger.decide(
      { ...f.context, accountId: String(new ObjectId()) },
      requestId,
      decision({ decisionId: 'decision-0000000002', outcome: 'declined', reason: 'Too large' })
    ),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const row = await db.collection('business_decisions').findOne({ _id: copies[0]._id });
  const replay = await ledger.decide(
    { ...f.context, accountId: row.approverId },
    requestId,
    decision({ decisionId: row.decisionId, outcome: row.outcome, reason: row.decisionReason })
  );
  assert.equal(replay.revision, 1);
  assert.equal(replay.timeline.length, 2);
  await assert.rejects(
    ledger.decide(
      { ...f.context, accountId: row.approverId },
      requestId,
      decision({ decisionId: row.decisionId, outcome: row.outcome, reason: 'changed' })
    ),
    { code: 'decision_conflict' }
  );
});
test('current ACL, branch, tenant, self approval, expiry and edited bills fail closed', async () => {
  const f = fixture();
  const row = await ledger.create(f.source, f.input),
    requestId = String(row._id);
  for (const context of [
    { ...f.context, branches: [] },
    { ...f.context, businessId: String(new ObjectId()) },
    { ...f.context, capabilities: [] },
  ])
    await assert.rejects(ledger.decide(context, requestId, decision()), { code: 'access_denied' });
  await assert.rejects(
    ledger.decide({ ...f.context, accountId: f.source.requesterId }, requestId, decision()),
    { code: 'self_approval_denied' }
  );
  await ledger.decide(f.context, requestId, decision());
  await assert.rejects(
    ledger.claim(
      f.source,
      requestId,
      revisionHash({ changed: true }),
      'execution-00000001',
      f.context
    ),
    { code: 'bill_changed' }
  );
  await assert.rejects(
    ledger.claim(f.source, requestId, f.input.revisionHash, 'execution-00000001', {
      ...f.context,
      capabilities: [],
    }),
    { code: 'access_denied' }
  );
  clock += LIFETIME_MS;
  await assert.rejects(
    ledger.claim(f.source, requestId, f.input.revisionHash, 'execution-00000001', f.context),
    { code: 'request_expired' }
  );
});
test('application has a separate durable claim and receipt; interruption never releases a second execution', async () => {
  const f = fixture();
  const row = await ledger.create(f.source, f.input),
    requestId = String(row._id);
  await ledger.decide(f.context, requestId, decision());
  const claims = await Promise.allSettled([
    ledger.claim(f.source, requestId, f.input.revisionHash, 'execution-00000001', f.context),
    ledger.claim(f.source, requestId, f.input.revisionHash, 'execution-00000002', f.context),
  ]);
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  const stored = await db.collection('business_decisions').findOne({ _id: row._id });
  assert.equal(stored.state, 'applying');
  ledger = createDecisionLedger(db, { now: () => clock });
  clock += LIFETIME_MS * 2;
  const recovery = await ledger.claim(
    f.source,
    requestId,
    f.input.revisionHash,
    stored.executionId,
    f.context
  );
  assert.equal(recovery.record.state, 'applying');
  assert.equal(recovery.executionPermit, 'reconcile');
  await assert.rejects(ledger.cancel(f.source, requestId), { code: 'decision_changed' });
  const saleId = String(new ObjectId());
  const applied = await ledger.acknowledge(f.source, requestId, stored.executionId, saleId);
  assert.equal(applied.state, 'applied');
  assert.deepEqual(
    applied.timeline.map((event) => event.state),
    ['pending', 'approved', 'applying', 'applied']
  );
  assert.equal(
    (await ledger.acknowledge(f.source, requestId, stored.executionId, saleId)).revision,
    applied.revision
  );
  await assert.rejects(
    ledger.acknowledge(f.source, requestId, stored.executionId, String(new ObjectId())),
    { code: 'execution_conflict' }
  );
});
test('cashier cancellation prevents consumption and mismatched request retries cannot alter the preview', async () => {
  const f = fixture();
  const row = await ledger.create(f.source, f.input),
    requestId = String(row._id);
  await assert.rejects(
    ledger.create(f.source, { ...f.input, summary: { ...f.input.summary, reason: 'Changed' } }),
    { code: 'operation_conflict' }
  );
  await assert.rejects(
    ledger.cancel({ ...f.source, deviceId: 'different-desktop-01' }, requestId),
    { code: 'request_not_found' }
  );
  await ledger.decide(f.context, requestId, decision());
  await ledger.cancel(f.source, requestId);
  await assert.rejects(
    ledger.claim(f.source, requestId, f.input.revisionHash, 'execution-00000001', f.context),
    { code: 'decision_changed' }
  );
});
