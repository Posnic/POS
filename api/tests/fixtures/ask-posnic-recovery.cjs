'use strict';
// Recovery fixtures exercise enabled shops. Disabling the feature is covered by the feature gate suite.
require.cache[require.resolve('../../src/services/ask-posnic-feature')] = { exports: { enabled: async () => true } };
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
let db, memory, client;
require.cache[require.resolve('../../src/models/base.model')] = { exports: class {
  async getCollection(name) { return db.collection(name); }
  static async getDb() { return db; }
} };
const recovery = require('../../src/services/ask-posnic-recovery.service');
const execution = require('../../src/services/ask-posnic-execution-owner');
const platform = require('../../src/services/ask-posnic-platform.service');
const schedules = require('../../src/services/ask-posnic-schedule.service');
const identity = require('../../src/services/ask-posnic-action-identity');
const license = new ObjectId(), branch = new ObjectId(), user = new ObjectId();
const context = { licenseId: String(license), branchId: String(branch), userId: String(user) };
const request = { tenantContext: context, user: { _id: user, role: 'admin' } };
const wall = { license: String(license), branch_id: String(branch) };
const stopped = { ...execution.current(), host: 'test-host', pid: 54321, instance: 'stopped-instance' };
const options = { apply: true, operator: 'Test maintainer', process: { hostname: 'test-host', running: () => false } };
const evidence = (outcome = 'not_accepted') => ({ outcome, provider_reference: 'synthetic-provider-review-1', verified_at: new Date(Date.now() - 1000).toISOString(), ...(outcome === 'completed' ? { tokens_in: 20, tokens_out: 0 } : {}) });
const holdId = '11111111-1111-4111-8111-111111111111';
async function managedHold() {
  const row = { ...wall, month: '2026-10', used_minor: 1, used_microminor: 50, reserved_minor: 2, holds: { [holdId]: { status: 'uncertain', reserved_minor: 2, model: 'test-model', currency: { rate: 1, code: 'USD' }, unit_price: { in: 0.02, out: 0 }, execution_owner: stopped, operation_id: 'index-operation' } } };
  await db.collection('managed_ai_credits').insertOne(row); return row;
}
async function source() {
  const row = { ...wall, title: 'Source', semantic: { state: 'processing', execution_owner: stopped, operation: 'index-operation', claim: 'index-operation' } };
  row._id = (await db.collection('ask_posnic_documents').insertOne(row)).insertedId; return row;
}
before(async () => { memory = await MongoMemoryServer.create(); client = await MongoClient.connect(memory.getUri()); db = client.db('recovery_isolated'); process.env.ASK_POSNIC_ACTION_SECRET = 'synthetic-recovery-secret'; });
beforeEach(async () => { await db.dropDatabase(); });
after(async () => { await client?.close(); await memory?.stop(); });

test('process evidence rejects live, foreign, legacy and unverifiable identities and accepts an exited local child', async () => {
  assert.throws(() => execution.requireStopped(execution.current()), /still present/);
  assert.throws(() => execution.requireStopped(stopped), /worker host/);
  assert.throws(() => execution.requireStopped({}), /older record/);
  assert.throws(() => execution.requireStopped({ ...execution.current(), process_namespace: 'other-namespace' }), /process namespace/);
  assert.throws(() => execution.requireStopped(stopped, { hostname: 'test-host', running: () => { throw new Error('Unknown process'); } }), /Unknown/);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'exit');
  assert.equal(execution.requireStopped({ ...execution.current(), pid: child.pid, instance: 'exited-test' }), true);
});

test('completed action recovery reads deterministic output identities without creating records', async () => {
  const draft = await platform.createDraft(request, 'stock_count', { items: [] });
  const row = await db.collection('ask_posnic_action_drafts').findOne({ _id: new ObjectId(draft.id) });
  await db.collection('ask_posnic_action_drafts').updateOne({ _id: row._id }, { $set: { status: 'executing', execution_owner: stopped } });
  await db.collection('inventory_counts').insertOne({ _id: identity.records(row)[0].id, license, branch_id: branch, ask_posnic_action_id: draft.id, ask_posnic_step: 0 });
  const preview = await recovery.recoverAction(db, context, draft.id, { ...options, apply: false });
  assert.equal(preview.status, 'completed');
  assert.equal((await db.collection('ask_posnic_action_drafts').findOne({ _id: row._id })).status, 'executing');
  assert.equal((await recovery.recoverAction(db, context, draft.id, options)).status, 'completed');
  assert.equal(await db.collection('inventory_counts').countDocuments(), 1);
  await assert.rejects(recovery.recoverAction(db, context, draft.id, options), /No executing/);
});

test('an interrupted action with no saved output gets a new review but keeps the original record identity', async () => {
  const draft = await platform.createDraft(request, 'stock_count', { items: [{ name: 'Tea' }] });
  await db.collection('ask_posnic_action_drafts').updateOne({ _id: new ObjectId(draft.id) }, { $set: { status: 'executing', execution_owner: stopped } });
  assert.equal((await recovery.recoverAction(db, context, draft.id, options)).remaining, 1);
  let validated = false;
  const review = await platform.resumeDraft(request, draft.id, async (_payload, type) => { assert.equal(type, 'stock_count'); validated = true; });
  assert.equal(validated, true);
  const outcomes = await Promise.allSettled([1, 2].map(() => platform.confirmDraft(request, review.token, async (_type, payload, savedDraft) => {
    const col = db.collection('inventory_counts');
    return identity.insertOnce(col, { license, branch_id: branch, items: payload.items }, { askPosnicAction: { id: String(savedDraft._id), step: 0 } });
  })));
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const saved = await db.collection('inventory_counts').findOne({});
  assert.equal(String(saved._id), String(identity.recordId(draft.id, 0, 'inventory_counts')));
  assert.equal(await db.collection('inventory_counts').countDocuments(), 1);
});

test('action recovery refuses live workers and a different outlet', async () => {
  const draft = await platform.createDraft(request, 'campaign', { name: 'Test', message: 'Test', channel: 'sms' });
  await db.collection('ask_posnic_action_drafts').updateOne({ _id: new ObjectId(draft.id) }, { $set: { status: 'executing', execution_owner: stopped } });
  await assert.rejects(recovery.recoverAction(db, context, draft.id, { ...options, process: { hostname: 'test-host', running: () => true } }), /still present/);
  await assert.rejects(recovery.recoverAction(db, { ...context, branchId: String(new ObjectId()) }, draft.id, options), /No executing/);
});

test('managed recovery retains fractional cost and atomically records evidence exactly once', async () => {
  await managedHold();
  const preview = await recovery.resolveHold(db, context, holdId, evidence('completed'), { ...options, engine: 'managed', apply: false });
  assert.equal(preview.actual_microminor, 40);
  const results = await Promise.allSettled([1, 2, 3].map(() => recovery.resolveHold(db, context, holdId, evidence('completed'), { ...options, engine: 'managed' })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const account = await db.collection('managed_ai_credits').findOne({});
  assert.equal(account.used_microminor, 90); assert.equal(account.used_minor, 1); assert.equal(account.reserved_minor, 0);
  assert.equal(account.holds[holdId].recovery.operator, 'Test maintainer');
  assert.equal(account.holds[holdId].recovery.evidence_hash.length, 64);
  await recovery.projectUsage(db, context, holdId, { ...options, engine: 'managed' });
  await recovery.projectUsage(db, context, holdId, { ...options, engine: 'managed' });
  assert.equal(await db.collection('ai_usage').countDocuments(), 1);
  assert.equal((await db.collection('ai_usage').findOne({})).cost_microminor_adjustment, 40);
});

test('release requires positive operator evidence and cannot silently treat unknown calls as free', async () => {
  await managedHold();
  await assert.rejects(recovery.resolveHold(db, context, holdId, { outcome: 'unknown' }, { ...options, engine: 'managed' }), /verified provider/);
  await assert.rejects(recovery.resolveHold(db, context, holdId, { ...evidence('completed'), tokens_in: 0 }, { ...options, engine: 'managed' }), /nonzero/);
  await assert.rejects(recovery.resolveHold(db, context, holdId, evidence(), { ...options, operator: '', engine: 'managed' }), /human operator/);
  await recovery.resolveHold(db, context, holdId, evidence(), { ...options, engine: 'managed' });
  const account = await db.collection('managed_ai_credits').findOne({});
  assert.equal(account.holds[holdId].status, 'released'); assert.equal(account.used_microminor, 50);
});

test('own-key recovery uses historical prices and keeps a receipt after releasing the embedded hold', async () => {
  await db.collection('ask_posnic_embedding_budget').insertOne({ ...wall, held: 1000, spent: 5, count: 1, holds: { [holdId]: { amount: 1000, model: 'text-embedding-3-small', exchange_rate: 1, unit_price: { in: 0.02, out: 0 }, execution_owner: stopped } } });
  await assert.rejects(recovery.resolveHold(db, context, holdId, { ...evidence('completed'), tokens_in: 9000 }, { ...options, engine: 'own_key' }), /Invalid embedding/);
  await recovery.resolveHold(db, context, holdId, evidence('completed'), { ...options, engine: 'own_key' });
  const account = await db.collection('ask_posnic_embedding_budget').findOne({});
  assert.equal(account.spent, 45); assert.equal(account.held, 0); assert.equal(account.count, 0);
  assert.equal(account.holds[holdId], undefined); assert.equal(account.recoveries[holdId].actual_microminor, 40);
});

test('index restart is blocked by unresolved costs and requires explicit consent for missing embeddings', async () => {
  const doc = await source(); await managedHold();
  await assert.rejects(recovery.recoverIndex(db, context, String(doc._id), { ...options, engine: 'managed' }), /Resolve/);
  await recovery.resolveHold(db, context, holdId, evidence(), { ...options, engine: 'managed' });
  await assert.rejects(recovery.recoverIndex(db, context, String(doc._id), { ...options, engine: 'managed' }), /new charges/);
  await recovery.recoverIndex(db, context, String(doc._id), { ...options, engine: 'managed', rebuildMissing: true });
  const saved = await db.collection('ask_posnic_documents').findOne({ _id: doc._id });
  assert.equal(saved.semantic.state, 'pending'); assert.equal(saved.semantic.claim, undefined);
});

test('index recovery never reclaims a cache entry owned by a live or foreign worker', async () => {
  const row = { ...wall, own_semantic: { state: 'needs_review', execution_owner: stopped, operation: 'index-operation' } };
  row._id = (await db.collection('ask_posnic_documents').insertOne(row)).insertedId;
  await db.collection('ask_posnic_local_vectors').insertOne({ _id: 'cache', license: wall.license, operation_id: 'index-operation', state: 'processing', execution_owner: { ...stopped, host: 'other-host' } });
  await assert.rejects(recovery.recoverIndex(db, context, String(row._id), { ...options, engine: 'own_key', rebuildMissing: true }), /worker host/);
  assert.equal((await db.collection('ask_posnic_local_vectors').findOne({})).state, 'processing');
});

test('an expired report build cannot send after another sweep pauses it', async () => {
  const row = await schedules.save(context, { report: 'sales', frequency: 'daily', destination: 'nobody@example.invalid' });
  await db.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  let resume, started;
  const built = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const run = schedules.runDue(context, () => new Promise((resolve) => { resume = resolve; started(); }), async () => { calls++; });
  await built;
  await schedules.runDue(context, async () => 'other', async () => { calls++; }, new Date(Date.now() + 16 * 60000));
  const paused = await db.collection(schedules.COLLECTION).findOne({ _id: row._id });
  assert.equal(paused.enabled, false); assert.ok(paused.running_at);
  await assert.rejects(schedules.save(context, { ...row, id: String(row._id), enabled: true }), /operator review/);
  assert.equal(await schedules.remove(context, String(row._id)), false);
  resume('report'); await run;
  assert.equal(calls, 0);
});

test('an old delivery completion cannot overwrite a newer claim', async () => {
  const row = await schedules.save(context, { report: 'sales', frequency: 'daily', destination: 'nobody@example.invalid' });
  await db.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  await schedules.runDue(context, async () => 'report', async () => {
    await db.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { running_claim: 'replacement', last_status: 'replacement-state' } });
  });
  assert.equal((await db.collection(schedules.COLLECTION).findOne({ _id: row._id })).last_status, 'replacement-state');
});

test('schedule recovery keeps delivery paused and advances past the interrupted slot', async () => {
  const row = await schedules.save(context, { report: 'sales', frequency: 'daily', destination: 'nobody@example.invalid' });
  await db.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { enabled: false, last_status: 'needs_review', running_at: new Date(0), running_claim: 'old', execution_owner: stopped } });
  const result = await recovery.recoverSchedule(db, context, String(row._id), evidence(), options);
  assert.equal(result.enabled, false); assert.ok(result.next_run_at > new Date());
  const reviewed = await db.collection(schedules.COLLECTION).findOne({ _id: row._id });
  assert.equal(reviewed.running_at, undefined); assert.equal(reviewed.last_status, 'reviewed');
  const resumed = await schedules.save(context, { ...reviewed, id: String(row._id), enabled: true });
  assert.equal(resumed.enabled, true);
});

test('an ambiguous delivery cannot be erased or have its destination changed before review', async () => {
  const row = await schedules.save(context, { report: 'sales', frequency: 'daily', destination: 'nobody@example.invalid' });
  await db.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { enabled: false, last_status: 'needs_review' } });
  assert.equal(await schedules.remove(context, String(row._id)), false);
  await assert.rejects(schedules.save(context, { ...row, id: String(row._id), enabled: false, destination: 'different@example.invalid' }), /operator review/);
  await recovery.recoverSchedule(db, context, String(row._id), evidence(), options);
  assert.equal(await schedules.remove(context, String(row._id)), true);
});

test('inspection and CLI output omit source text, prompts, destinations and action payloads', async () => {
  const doc = await source();
  await db.collection('ask_posnic_documents').updateOne({ _id: doc._id }, { $set: { content: 'PRIVATE-MARKER', chunks: ['PRIVATE-MARKER'] } });
  const rows = await recovery.inspect(db, context);
  assert.equal(rows.documents.length, 1); assert.ok(!JSON.stringify(rows).includes('PRIVATE-MARKER'));
  const output = execFileSync(process.execPath, ['scripts/recover-ask-posnic.js', 'inspect', '--database', db.databaseName, '--license', context.licenseId, '--branch', context.branchId], { env: { ...process.env, MONGODB_URI: memory.getUri() }, encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(output).documents.length, 1); assert.ok(!output.includes('PRIVATE-MARKER'));
});

test('the operator CLI applies recovery only after proving the actual local child has exited', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, stdio: 'ignore' }); await once(child, 'exit');
  const draft = await platform.createDraft(request, 'campaign', { name: 'Synthetic', message: 'Synthetic', channel: 'sms' });
  await db.collection('ask_posnic_action_drafts').updateOne({ _id: new ObjectId(draft.id) }, { $set: { status: 'executing', execution_owner: { ...execution.current(), pid: child.pid, instance: 'real-exited-child' } } });
  const args = ['scripts/recover-ask-posnic.js', 'action', '--database', db.databaseName, '--license', context.licenseId, '--branch', context.branchId, '--id', draft.id, '--operator', 'Test maintainer'];
  const env = { ...process.env, MONGODB_URI: memory.getUri() };
  const preview = JSON.parse(execFileSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true }));
  assert.equal(preview.applied, false);
  assert.equal((await db.collection('ask_posnic_action_drafts').findOne({ _id: new ObjectId(draft.id) })).status, 'executing');
  assert.equal(JSON.parse(execFileSync(process.execPath, [...args, '--apply'], { env, encoding: 'utf8', windowsHide: true })).status, 'needs_review');
  assert.equal(await db.collection('campaigns').countDocuments(), 0);
});
