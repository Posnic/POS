'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createDecisionOutbox } = require('../src/services/business-decision-outbox');
let mongo, client;
const prior = process.env.POSNIC_BUSINESS_DECISIONS;
before(async () => {
  process.env.POSNIC_BUSINESS_DECISIONS = '1';
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
  if (prior === undefined) delete process.env.POSNIC_BUSINESS_DECISIONS;
  else process.env.POSNIC_BUSINESS_DECISIONS = prior;
});
async function fixture() {
  const db = client.db('outbox_' + new ObjectId()),
    local = db.collection('business_decision_local');
  let time = Date.now();
  const now = () => time,
    broker = createDecisionOutbox(db, { now });
  const deviceId = crypto.randomUUID();
  const body = {
    branchId: String(new ObjectId()),
    requesterId: String(new ObjectId()),
    requestId: String(new ObjectId()),
    revisionHash: 'a'.repeat(64),
  };
  const command = await broker.claim(deviceId, body);
  const expected = { ...body, executionId: command.executionId, operationId: crypto.randomUUID() };
  const proof = {
    decisionId: body.requestId,
    revisionHash: body.revisionHash,
    executionId: command.executionId,
    approverId: String(new ObjectId()),
  };
  const response = {
    executionPermit: 'start',
    proof,
    record: {
      id: body.requestId,
      branchId: body.branchId,
      requesterId: body.requesterId,
      revisionHash: body.revisionHash,
      operationId: expected.operationId,
      state: 'applying',
      executionStartedAt: new Date(time).toISOString(),
    },
  };
  const ready = () =>
    local.updateOne(
      { _id: command.commandId },
      { $set: { state: 'done', response, startExpiresAt: new Date(time + 3000) } }
    );
  return {
    db,
    local,
    broker,
    deviceId,
    body,
    command,
    expected,
    proof,
    response,
    ready,
    now,
    advance: (ms) => {
      time += ms;
    },
  };
}
test('one immutable execution across concurrent requests, restarts, and changed intent', async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 15 }, () => createDecisionOutbox(f.db).claim(f.deviceId, f.body))
  );
  assert.ok(
    results.every(
      (row) => row.executionId === f.command.executionId && row.commandId === f.command.commandId
    )
  );
  assert.equal(await f.local.countDocuments({ kind: 'command' }), 1);
  await assert.rejects(f.broker.claim(f.deviceId, { ...f.body, revisionHash: 'b'.repeat(64) }), {
    code: 'decision_execution_conflict',
  });
});
test('only one concurrent writer gets proof; a restarted process cannot reacquire it', async () => {
  const f = await fixture();
  await f.ready();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => f.broker.consume(f.command.commandId, f.deviceId, f.expected))
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(results.find((result) => result.status === 'fulfilled').value, f.proof);
  const saved = await f.local.findOne({ _id: f.command.commandId });
  assert.ok(saved.consumedAt instanceof Date);
  assert.equal(saved.executionState, 'committing');
  await assert.rejects(
    createDecisionOutbox(f.db, { now: f.now }).consume(f.command.commandId, f.deviceId, f.expected),
    { code: 'decision_reconciliation_required' }
  );
});
test('stale permits, wrong source, changed operation and altered envelopes never authorize a writer', async () => {
  const f = await fixture();
  await f.ready();
  for (const change of [
    { operationId: crypto.randomUUID() },
    { requesterId: String(new ObjectId()) },
    { revisionHash: 'b'.repeat(64) },
  ]) {
    await assert.rejects(
      f.broker.consume(f.command.commandId, f.deviceId, { ...f.expected, ...change }),
      { code: 'decision_reconciliation_required' }
    );
  }
  await assert.rejects(f.broker.consume(f.command.commandId, crypto.randomUUID(), f.expected), {
    code: 'decision_reconciliation_required',
  });
  f.advance(3000);
  await assert.rejects(f.broker.consume(f.command.commandId, f.deviceId, f.expected), {
    code: 'decision_reconciliation_required',
  });
  assert.equal((await f.local.findOne({ _id: f.command.commandId })).consumedAt, undefined);
  const altered = await fixture();
  await altered.ready();
  await altered.local.updateOne(
    { _id: altered.command.commandId },
    { $set: { bodyHash: '0'.repeat(64) } }
  );
  await assert.rejects(
    altered.broker.consume(altered.command.commandId, altered.deviceId, altered.expected),
    { code: 'decision_reconciliation_required' }
  );
});
test('desktop advertises readiness but requires a live agent installation identity', async () => {
  const f = await fixture();
  await assert.rejects(f.broker.advertise(), { code: 'decision_agent_unavailable' });
  assert.ok(await f.local.findOne({ _id: 'desktop-runtime' }));
  await f.local.insertOne({
    _id: 'agent-runtime',
    protocolVersion: 1,
    deviceId: f.deviceId,
    expiresAt: new Date(f.now() + 1000),
  });
  assert.equal(await f.broker.advertise(), f.deviceId);
  f.advance(1000);
  await assert.rejects(f.broker.advertise(), { code: 'decision_agent_unavailable' });
});
