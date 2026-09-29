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

test('durable recovery references page after restart and remain isolated by installation, branch and cashier', async () => {
  const flags = ['POSNIC_DESKTOP', 'POSNIC_SYNC_PAIRED', 'POSNIC_BUSINESS_LOCAL_DECISIONS'];
  const previous = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
  try {
    for (const mode of ['cloud', 'community']) {
      process.env.POSNIC_DESKTOP = '1';
      process.env.POSNIC_SYNC_PAIRED = mode === 'cloud' ? '1' : '0';
      process.env.POSNIC_BUSINESS_LOCAL_DECISIONS = mode === 'community' ? '1' : '0';
      const f = await fixture();
      const deviceId = mode === 'cloud' ? f.deviceId : 'community-' + crypto.randomUUID();
      if (mode === 'cloud')
        await f.local.updateOne(
          { _id: 'agent-runtime' },
          {
            $set: { protocolVersion: 1, deviceId, expiresAt: new Date(f.now() + 120000) },
          },
          { upsert: true }
        );
      else await f.local.insertOne({ _id: 'community-installation', deviceId });
      await f.local.deleteOne({ _id: f.command.commandId });
      const expected = new Set();
      for (let i = 0; i < 23; i++) {
        const body = { ...f.body, requestId: String(new ObjectId()) };
        expected.add(body.requestId);
        await f.broker.claim(deviceId, body);
      }
      for (const [otherDevice, patch, applied] of [
        ['other-installation-1234', {}, false],
        [deviceId, { branchId: String(new ObjectId()) }, false],
        [deviceId, { requesterId: String(new ObjectId()) }, false],
        [deviceId, {}, true],
      ]) {
        const claim = await f.broker.claim(otherDevice, {
          ...f.body,
          ...patch,
          requestId: String(new ObjectId()),
        });
        if (applied)
          await f.local.updateOne(
            { _id: claim.commandId },
            { $set: { executionState: 'applied' } }
          );
      }
      const source = { branchId: f.body.branchId, requesterId: f.body.requesterId };
      const transport = () =>
        require('../src/services/business-checkout-transport').createCheckoutTransport(f.db, {
          now: f.now,
        });
      const first = await transport().recoveries(source);
      assert.equal(first.references.length, 20);
      assert.match(first.nextCursor, /^[a-f\d]{64}$/);
      const second = await transport().recoveries(source, first.nextCursor);
      assert.equal(second.references.length, 3);
      assert.equal(second.nextCursor, null);
      assert.deepEqual(
        new Set([...first.references, ...second.references].map((row) => row.requestId)),
        expected
      );
      for (const row of [...first.references, ...second.references]) {
        assert.deepEqual(Object.keys(row).sort(), ['requestId', 'startedAt']);
        assert.equal(row.startedAt, new Date(f.now()).toISOString());
      }
      for (const cursor of ['', 'foreign', { $ne: null }])
        await assert.rejects(transport().recoveries(source, cursor), {
          code: 'invalid_recovery_cursor',
        });
      assert.equal(await f.db.collection('sales').countDocuments({}), 0);
      assert.equal(await f.local.countDocuments({ consumedAt: { $exists: true } }), 0);
    }
  } finally {
    for (const key of flags) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('recovery lookup rechecks cashier access after the read and never returns revoked scope', async () => {
  const f = await fixture();
  const license = new ObjectId(),
    branchId = new ObjectId(),
    userId = new ObjectId();
  const user = {
    _id: userId,
    license,
    activate: true,
    authVersion: 1,
    usertype: 'cashier',
    branch_access: [{ branch_id: branchId }],
    access: { sales: { write: true } },
  };
  await f.db.collection('users').insertOne(user);
  await f.db.collection('branches').insertOne({ _id: branchId, license });
  const context = {
    licenseId: String(license),
    branchId: String(branchId),
    userId: String(userId),
  };
  let calls = 0;
  const checkout = require('../src/services/business-checkout-decisions').createCheckoutDecisions(
    f.db,
    {
      now: f.now,
      transport: {
        recoveries: async (source) => {
          calls++;
          assert.deepEqual(source, { branchId: String(branchId), requesterId: String(userId) });
          await f.db
            .collection('users')
            .updateOne({ _id: userId }, { $set: { branch_access: [] } });
          return {
            references: [
              { requestId: f.body.requestId, startedAt: new Date(f.now()).toISOString() },
            ],
            nextCursor: null,
          };
        },
      },
    }
  );
  await assert.rejects(checkout.recoveries(context, user), { code: 'cashier_access_denied' });
  assert.equal(calls, 1);
  await assert.rejects(checkout.recoveries(context, user), { code: 'cashier_access_denied' });
  assert.equal(calls, 1);
});

test('Cloud request recovery retains unacknowledged operation references and skips already claimed requests', async () => {
  const flags = ['POSNIC_DESKTOP', 'POSNIC_SYNC_PAIRED'];
  const previous = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
  try {
    for (const key of flags) process.env[key] = '1';
    const f = await fixture();
    await f.local.deleteOne({ _id: f.command.commandId });
    await f.local.insertOne({
      _id: 'agent-runtime',
      protocolVersion: 1,
      deviceId: f.deviceId,
      expiresAt: new Date(f.now() + 120000),
    });
    const expected = new Set();
    for (let i = 0; i < 24; i++) {
      const operationId = crypto.randomUUID();
      const commandId = await f.broker.enqueue(f.deviceId, 'create', {
        branchId: f.body.branchId,
        requesterId: f.body.requesterId,
        request: { operationId },
      });
      if (i === 5) {
        const requestId = String(new ObjectId());
        await f.local.updateOne(
          { _id: commandId },
          { $set: { state: 'done', response: { id: requestId } } }
        );
        const claim = await f.broker.claim(f.deviceId, { ...f.body, requestId });
        await f.local.updateOne({ _id: claim.commandId }, { $set: { executionState: 'applied' } });
      } else expected.add(operationId);
    }
    for (const [deviceId, patch] of [
      [f.deviceId, { branchId: String(new ObjectId()) }],
      ['other-device-123456', {}],
      [f.deviceId, { requesterId: String(new ObjectId()) }],
    ])
      await f.broker.enqueue(deviceId, 'create', {
        branchId: f.body.branchId,
        requesterId: f.body.requesterId,
        ...patch,
        request: { operationId: crypto.randomUUID() },
      });
    const source = { branchId: f.body.branchId, requesterId: f.body.requesterId };
    const channel = () =>
      require('../src/services/business-checkout-transport').createCheckoutTransport(f.db, {
        now: f.now,
      });
    assert.deepEqual(await channel().recoveries(source), { references: [], nextCursor: null });
    let cursor;
    const references = [];
    do {
      const page = await channel().recoveries(source, cursor, true);
      assert.ok(page.references.length <= 20);
      references.push(...page.references);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(references.length, 23);
    assert.deepEqual(new Set(references.map((row) => row.operationId)), expected);
    assert.ok(references.every((row) => row.requestId === null));
    await assert.rejects(channel().recoveries(source, 'requests'), {
      code: 'invalid_recovery_cursor',
    });
    await assert.rejects(channel().recoveries(source, 'requests:' + 'a'.repeat(24), true), {
      code: 'invalid_recovery_cursor',
    });
    f.advance(8 * 86400000);
    await f.local.updateOne(
      { _id: 'agent-runtime' },
      { $set: { expiresAt: new Date(f.now() + 120000) } }
    );
    assert.deepEqual(await channel().recoveries(source, undefined, true), {
      references: [],
      nextCursor: null,
    });
    assert.equal(await f.db.collection('sales').countDocuments({}), 0);
  } finally {
    for (const key of flags) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
