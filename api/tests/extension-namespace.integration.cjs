'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  readNamespace,
  executeNamespace,
  recoverNamespace,
  setEnabled,
  readLifecycleAudit,
} = require('../src/services/extension-namespace');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('extension_namespace');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
function fixture() {
  const scope = { license: new ObjectId(), branchId: new ObjectId() };
  const actor = { userId: String(new ObjectId()), permissions: ['read', 'write', 'manage'] };
  const descriptor = {
    id: 'posnic.example',
    version: '1.0.0',
    initialState: { records: [] },
    commands: { add: ['write'], clear: ['manage'] },
    plan: async ({ state, command, operationId }) =>
      command.type === 'clear'
        ? { state: { records: [] }, effects: [], result: { deleted: true } }
        : {
            state: {
              records: [...state.records, { id: operationId, description: command.description }],
            },
            effects: [{ kind: 'stock.debit', reference: operationId }],
            result: { recordId: operationId },
          },
  };
  const input = {
    requestKey: 'request-operation-001',
    expectedRevision: 0,
    command: { type: 'add', description: 'Private unpaid item' },
  };
  return { scope, actor, descriptor, input };
}
const noEffect = { executeEffect: async () => ({ applied: true }) };

test('lifecycle audit survives archive failure and retries without losing or duplicating a transition', async () => {
  const f = fixture();
  const broken = { collection(name) {
    if (name === 'extension_lifecycle_events') return { updateOne: async () => { throw Error('archive unavailable'); } };
    return db.collection(name);
  } };
  await assert.rejects(setEnabled(broken, f.scope, f.descriptor, f.actor, false), /archive unavailable/);
  const row = await db.collection('extension_namespaces').findOne({ license: f.scope.license });
  assert.equal(row.lifecycle.enabled, false);
  assert.equal(row.lifecycleAuditPending.generation, 1);
  await setEnabled(db, f.scope, f.descriptor, f.actor, false);
  await setEnabled(db, f.scope, f.descriptor, f.actor, true);
  const events = await readLifecycleAudit(db, f.scope, f.descriptor, f.actor);
  assert.deepEqual(events.map(e => [e.generation, e.action]), [[2, 'enabled'], [1, 'disabled']]);
  assert.equal(events[0].actorId, f.actor.userId);
  assert.equal(events[0].version, f.descriptor.version);
  assert.equal(events[0].changedAt instanceof Date, true);
  assert.equal((await readLifecycleAudit(db, f.scope, f.descriptor, f.actor, 2)).length, 1);
  assert.deepEqual(await readLifecycleAudit(db, { ...f.scope, branchId: new ObjectId() }, f.descriptor, f.actor), []);
  await assert.rejects(readLifecycleAudit(db, f.scope, f.descriptor, { permissions: ['read'] }), /extension_manage_required/);
  assert.equal((await db.collection('extension_namespaces').findOne({ _id: row._id })).lifecycleAuditPending, undefined);
});

test('lifecycle audit resumes after archive succeeds but outbox cleanup fails', async () => {
  const f = fixture();
  const broken = { collection(name) {
    const collection = db.collection(name);
    return new Proxy(collection, { get(target, property) {
      if (name === 'extension_namespaces' && property === 'updateOne') return async (filter, update, options) => {
        if (update.$unset?.lifecycleAuditPending !== undefined) throw Error('cleanup interrupted');
        return target.updateOne(filter, update, options);
      };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  await assert.rejects(setEnabled(broken, f.scope, f.descriptor, f.actor, false), /cleanup interrupted/);
  await setEnabled(db, f.scope, f.descriptor, f.actor, true);
  assert.equal((await readLifecycleAudit(db, f.scope, f.descriptor, f.actor)).length, 2);
});

test('concurrent lifecycle requests cannot overwrite an unarchived event', async () => {
  const f = fixture();
  await Promise.allSettled(Array.from({ length: 12 }, () =>
    setEnabled(db, f.scope, f.descriptor, f.actor, false)));
  await setEnabled(db, f.scope, f.descriptor, f.actor, false);
  await Promise.allSettled(Array.from({ length: 12 }, () =>
    setEnabled(db, f.scope, f.descriptor, f.actor, true)));
  await setEnabled(db, f.scope, f.descriptor, f.actor, true);
  assert.deepEqual((await readLifecycleAudit(db, f.scope, f.descriptor, f.actor))
    .map(event => [event.generation, event.action]), [[2, 'enabled'], [1, 'disabled']]);
});

test('disable retains state, fences stale planners and allows repeated reinstall-style enable cycles', async () => {
  const f = fixture();
  let unblock, planning;
  const ready = new Promise(resolve => { planning = resolve; });
  const originalPlan = f.descriptor.plan;
  f.descriptor.plan = async input => {
    planning();
    await new Promise(resolve => { unblock = resolve; });
    return originalPlan(input);
  };
  let effects = 0;
  const pending = executeNamespace(db, f.scope, f.descriptor, f.actor, f.input,
    { executeEffect: async () => { effects++; return { applied: true }; } });
  await ready;
  await setEnabled(db, f.scope, f.descriptor, f.actor, false);
  await setEnabled(db, f.scope, f.descriptor, f.actor, true);
  unblock();
  await assert.rejects(pending, /extension_operation_in_progress/);
  assert.equal(effects, 0);
  f.descriptor.plan = originalPlan;
  await executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect);
  const before = await readNamespace(db, f.scope, f.descriptor, f.actor);
  for (let cycle = 0; cycle < 5; cycle++) {
    await setEnabled(db, f.scope, f.descriptor, f.actor, false);
    await assert.rejects(executeNamespace(db, f.scope, f.descriptor, f.actor,
      { ...f.input, requestKey: `other-operation-${cycle}`, expectedRevision: 1 }, noEffect), /extension_disabled/);
    await setEnabled(db, f.scope, f.descriptor, f.actor, true);
    assert.deepEqual(await readNamespace(db, f.scope, f.descriptor, f.actor), before);
  }
  await assert.rejects(setEnabled(db, f.scope, f.descriptor, { ...f.actor, permissions: ['read'] }, false), /extension_manage_required/);
});

test('an accepted unresolved effect blocks disabling and another shop remains unaffected', async () => {
  const f = fixture();
  await assert.rejects(executeNamespace(db, f.scope, f.descriptor, f.actor, f.input,
    { executeEffect: async () => { throw Error('connection lost'); } }), /connection lost/);
  await assert.rejects(setEnabled(db, f.scope, f.descriptor, f.actor, false), /extension_operation_in_progress/);
  const other = { ...f.scope, branchId: new ObjectId() };
  await setEnabled(db, other, f.descriptor, f.actor, false);
  await recoverNamespace(db, f.scope, f.descriptor, f.actor, noEffect);
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).revision, 1);
  assert.equal((await readNamespace(db, other, f.descriptor, f.actor)).revision, 0);
});
test('receipt committed before unlock survives connection loss and retry releases the lane', async () => {
  const f = fixture();
  const faultyDb = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'extension_namespaces' && property === 'updateOne')
            return async (filter, update, options) => {
              if (update.$unset?.pending !== undefined)
                throw new Error('lost connection before unlock');
              return target.updateOne(filter, update, options);
            };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await assert.rejects(
    executeNamespace(faultyDb, f.scope, f.descriptor, f.actor, f.input, noEffect),
    /before unlock/
  );
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).busy, true);
  const result = await recoverNamespace(db, f.scope, f.descriptor, f.actor, noEffect);
  assert.equal(result.revision, 1);
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).busy, false);
});
test('interruption resumes persisted plan and blocks unrelated commands until recovery', async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(
    executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, {
      executeEffect: async () => {
        calls++;
        throw new Error('connection lost');
      },
    }),
    /connection lost/
  );
  const pending = await readNamespace(db, f.scope, f.descriptor, f.actor);
  assert.equal(pending.busy, true);
  assert.equal(pending.revision, 0);
  assert.deepEqual(pending.state.records, []);
  await assert.rejects(
    executeNamespace(
      db,
      f.scope,
      f.descriptor,
      f.actor,
      { ...f.input, requestKey: 'request-operation-002' },
      noEffect
    ),
    { code: 'extension_operation_in_progress' }
  );
  const recovered = await recoverNamespace(db, f.scope, f.descriptor, f.actor, noEffect);
  assert.equal(recovered.revision, 1);
  assert.equal(calls, 1);
  const result = await executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, {
    executeEffect: async () => {
      throw new Error('must not execute twice');
    },
  });
  assert.deepEqual(result, recovered);
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).state.records.length, 1);
});
test('deletion clears payload, retries return only references and never revive deleted state', async () => {
  const f = fixture();
  const saved = await executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect);
  await executeNamespace(
    db,
    f.scope,
    f.descriptor,
    f.actor,
    { requestKey: 'request-operation-clear', expectedRevision: 1, command: { type: 'clear' } },
    noEffect
  );
  assert.deepEqual(
    await executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect),
    saved
  );
  const current = await readNamespace(db, f.scope, f.descriptor, f.actor);
  assert.deepEqual(current.state.records, []);
  assert.equal(current.revision, 2);
  assert.ok(
    !JSON.stringify(await db.collection('extension_command_receipts').find().toArray()).includes(
      'Private unpaid item'
    )
  );
});
test('compensated refusal releases the lane without committing planned state', async () => {
  const f = fixture();
  const sequences = [];
  await assert.rejects(
    executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, {
      executeEffect: async (context) => {
        sequences.push(context.sequence);
        return { rejected: true };
      },
    }),
    { code: 'extension_effect_rejected' }
  );
  await assert.rejects(executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect), {
    code: 'extension_effect_rejected',
  });
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).revision, 0);
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).busy, false);
  await executeNamespace(
    db,
    f.scope,
    f.descriptor,
    f.actor,
    { ...f.input, requestKey: 'request-after-refusal-002' },
    {
      executeEffect: async (context) => {
        sequences.push(context.sequence);
        return { applied: true };
      },
    }
  );
  assert.deepEqual(sequences, [1, 2]);
});
test('permission, changed payload, stale revision and tenant isolation are enforced', async () => {
  const f = fixture();
  await assert.rejects(
    executeNamespace(
      db,
      f.scope,
      f.descriptor,
      { ...f.actor, permissions: ['read'] },
      f.input,
      noEffect
    ),
    { code: 'extension_command_forbidden' }
  );
  await executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect);
  await assert.rejects(
    executeNamespace(
      db,
      f.scope,
      f.descriptor,
      f.actor,
      { ...f.input, command: { type: 'add', description: 'Changed' } },
      noEffect
    ),
    { code: 'extension_request_conflict' }
  );
  await assert.rejects(
    executeNamespace(
      db,
      f.scope,
      f.descriptor,
      f.actor,
      { ...f.input, requestKey: 'request-operation-002' },
      noEffect
    ),
    { code: 'extension_revision_conflict' }
  );
  const other = await readNamespace(
    db,
    { ...f.scope, license: new ObjectId() },
    f.descriptor,
    f.actor
  );
  assert.deepEqual(other.state.records, []);
});

test('recovery retains the original trusted effect permissions rather than caller claims', async () => {
  for (const manage of [false, true]) {
    const f = fixture();
    f.actor.permissions = ['read', 'write', ...(manage ? ['manage'] : [])];
    f.input.command.permissions = ['manage'];
    await assert.rejects(
      executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, {
        executeEffect: async (context) => {
          assert.equal(context.permissions.includes('manage'), manage);
          throw new Error('interrupted effect');
        },
      }),
      /interrupted effect/
    );
    await recoverNamespace(
      db,
      f.scope,
      f.descriptor,
      { userId: String(new ObjectId()), permissions: ['read', 'write', 'manage'] },
      {
        executeEffect: async (context) => {
          assert.equal(context.actorId, f.actor.userId);
          assert.equal(context.permissions.includes('manage'), manage);
          return { applied: true };
        },
      }
    );
    assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).busy, false);
  }
});
