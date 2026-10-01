'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  readNamespace,
  executeNamespace,
  recoverNamespace,
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
  await assert.rejects(
    executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, {
      executeEffect: async () => ({ rejected: true }),
    }),
    { code: 'extension_effect_rejected' }
  );
  await assert.rejects(executeNamespace(db, f.scope, f.descriptor, f.actor, f.input, noEffect), {
    code: 'extension_effect_rejected',
  });
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).revision, 0);
  assert.equal((await readNamespace(db, f.scope, f.descriptor, f.actor)).busy, false);
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
