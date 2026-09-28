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

test('mutation envelopes survive retry, reads are fresh, and receipt retry retains exact identity', async () => {
  const f = await fixture();
  const body = {
    branchId: f.body.branchId,
    requesterId: f.body.requesterId,
    requestId: f.body.requestId,
  };
  const first = await f.broker.enqueue(f.deviceId, 'cancel', body);
  assert.equal(await f.broker.enqueue(f.deviceId, 'cancel', body), first);
  assert.notEqual(
    await f.broker.enqueue(f.deviceId, 'read', body),
    await f.broker.enqueue(f.deviceId, 'read', body)
  );
  assert.equal(await f.broker.result(first, f.deviceId), null);
  await assert.rejects(f.broker.result(first, crypto.randomUUID()), {
    code: 'decision_command_missing',
  });
  const receipt = { ...body, executionId: f.command.executionId, saleId: String(new ObjectId()) };
  const ack = await f.broker.enqueue(f.deviceId, 'acknowledge', receipt);
  await f.local.updateOne(
    { _id: ack },
    {
      $set: {
        state: 'failed',
        error: { code: 'device_revoked', status: 403 },
        nextAttemptAt: new Date(f.now() + 1000),
      },
    }
  );
  await assert.rejects(f.broker.result(ack, f.deviceId), { code: 'device_revoked' });
  f.advance(1000);
  assert.equal(await f.broker.enqueue(f.deviceId, 'acknowledge', receipt), ack);
  assert.equal(await f.broker.result(ack, f.deviceId), null);
  assert.deepEqual((await f.local.findOne({ _id: ack })).body, receipt);
});

test('receipt recovery is bounded, fair, and never reclaims a missing sale', async () => {
  const flags = ['POSNIC_DESKTOP', 'POSNIC_SYNC_PAIRED'];
  const prior = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
  try {
    for (const key of flags) process.env[key] = '1';
    const f = await fixture();
    await f.local.deleteMany({});
    const commands = [];
    for (let n = 0; n < 7; n++) {
      const body = { ...f.body, requestId: String(new ObjectId()) };
      const command = await f.broker.claim(f.deviceId, body);
      commands.push({ body, command });
      await f.local.updateOne(
        { _id: command.commandId },
        {
          $set: {
            state: 'done',
            consumedAt: new Date(f.now()),
            response: { record: { state: 'applying' } },
          },
        }
      );
    }
    const { createDecisionRecovery } = require('../src/services/business-decision-recovery');
    let called = 0;
    const worker = createDecisionRecovery(f.db, {
      now: f.now,
      transport: {
        recover: async () => {
          called++;
        },
      },
    });
    await Promise.all([worker.tick(), worker.tick()]);
    assert.equal(await f.local.countDocuments({ recoveryStatus: 'receipt_not_found' }), 4);
    assert.equal(called, 0);
    await worker.tick();
    assert.equal(await f.local.countDocuments({ recoveryStatus: 'receipt_not_found' }), 7);
    const { body, command } = commands[0],
      saleId = new ObjectId();
    await f.db.collection('sales').insertOne({
      _id: saleId,
      branch_id: new ObjectId(body.branchId),
      business_decision_receipt: {
        version: 1,
        decisionId: body.requestId,
        executionId: command.executionId,
        revisionHash: body.revisionHash,
        requesterId: body.requesterId,
        deviceId: f.deviceId,
      },
    });
    f.advance(30000);
    const restarted = createDecisionRecovery(f.db, {
      now: f.now,
      transport: {
        recover: async (sent) => {
          called++;
          assert.equal(sent.saleId, String(saleId));
          return { state: 'applied', id: body.requestId, saleId: String(saleId) };
        },
      },
    });
    await restarted.tick();
    await restarted.tick();
    assert.equal(called, 1);
    assert.equal((await f.local.findOne({ _id: command.commandId })).executionState, 'applied');
  } finally {
    for (const key of flags) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
