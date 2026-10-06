'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
let db, server, client;
require.cache[require.resolve('../../src/models/base.model')] = { exports: class {
  static license = 'shop-a';
  static async getDb() { return db; }
} };
const budget = require('../../src/services/ai-budget');
const embedding = require('../../src/services/ask-posnic-own-key-embedding.service');
const semantic = require('../../src/services/ask-posnic-own-key-semantic.service');
const context = { licenseId: 'shop-a', branchId: 'outlet-a' };
const preferences = { license: 'shop-a', own_key_semantic: true, own_key_semantic_budget: 1 };
const settingsFor = async () => ({ enabled: true, askPosnicEnabled: true, provider: 'openai', key: 'synthetic-test-key', cap: null });
const vector = (position = 0) => Array.from({ length: 256 }, (_, i) => i === position ? 1 : 0);
const okResponse = (tokens = 20) => ({ ok: true, json: async () => ({ model: embedding.MODEL, usage: { total_tokens: tokens }, data: [{ index: 0, embedding: vector() }] }) });
async function doc(overrides = {}) {
  const row = { _id: new ObjectId(), license: 'shop-a', branch_id: 'outlet-a', title: 'Sale returns', content: 'Returns are available from Sales.', chunks: ['Returns are available from Sales.'], revision: '1', status: 'published', visibility: 'customer', ...overrides };
  row.own_semantic_source_hash = semantic.sourceHash(row);
  await db.collection('ask_posnic_documents').insertOne(row);
  return row;
}
before(async () => { server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri()); db = client.db('own_key_isolated'); });
beforeEach(async () => { await db.dropDatabase(); budget._currencyCache.clear(); await db.collection('ask_posnic_preferences').insertOne({ ...preferences }); });
after(async () => { await client?.close(); await server?.stop(); });

test('turning Ask Posnic off pauses own-key indexing without a paid embedding request', async () => {
  await doc();
  let calls = 0;
  const result = await semantic.indexBatch(db, {
    settingsFor: async () => ({ ...(await settingsFor()), askPosnicEnabled: false }),
    embed: async () => { calls++; return vector(); },
  });
  assert.equal(result.state, 'idle');
  assert.equal(calls, 0);
});

test('provider request is fixed-origin, bounded and uses the configured own key; tiny usage is retained', async () => {
  let request;
  const fetch = async (url, options) => { request = { url, options }; return okResponse(); };
  assert.deepEqual(await embedding.embed(db, 'How do I return a sale?', context, preferences, { settingsFor, fetch }), vector());
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings');
  assert.equal(request.options.headers.Authorization, 'Bearer synthetic-test-key');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), { model: embedding.MODEL, input: 'How do I return a sale?', dimensions: 256, encoding_format: 'float' });
  const ledger = await db.collection(embedding.ledgerCollection).findOne({});
  assert.equal(ledger.held, 0); assert.equal(ledger.count, 0); assert.ok(ledger.spent > 0);
  assert.ok((await budget.spentThisMonth(context)).total > 0);
});

test('concurrent reservations cannot overdraw the independent monthly budget and settle only once', async () => {
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => embedding.reserve(db, context, 1, 25e6, 'INR')));
  const holds = results.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  assert.equal(holds.length, 4);
  await embedding.settle(db, holds[0], 1e6);
  await assert.rejects(embedding.settle(db, holds[0], 1e6));
  const ledger = await db.collection(embedding.ledgerCollection).findOne({});
  assert.equal(ledger.held, 75e6); assert.equal(ledger.spent, 1e6);
});

test('known rejection releases its hold while timeout and malformed usage retain holds', async () => {
  await assert.rejects(embedding.embed(db, 'query', context, preferences, { settingsFor, fetch: async () => ({ ok: false, status: 401 }) }), (e) => !e.uncertain);
  assert.equal((await db.collection(embedding.ledgerCollection).findOne({})).held, 0);
  await assert.rejects(embedding.embed(db, 'query', context, preferences, { settingsFor, fetch: async () => { throw new Error('timeout'); } }), (e) => e.uncertain);
  await assert.rejects(embedding.embed(db, 'query', context, preferences, { settingsFor, fetch: async () => okResponse(99999) }), (e) => e.uncertain);
  assert.equal((await db.collection(embedding.ledgerCollection).findOne({})).count, 2);
});

test('disabled, unsupported, oversized and exhausted requests never reach the provider', async () => {
  let calls = 0;
  const deps = { settingsFor, fetch: async () => { calls++; return okResponse(); } };
  await assert.rejects(embedding.embed(db, 'query', context, { ...preferences, own_key_semantic: false }, deps));
  await assert.rejects(embedding.embed(db, 'query', context, preferences, { ...deps, settingsFor: async () => ({ enabled: true, provider: 'anthropic', key: 'synthetic' }) }));
  await assert.rejects(embedding.embed(db, 'x'.repeat(8001), context, preferences, deps));
  await embedding.reserve(db, context, 1, 100e6, 'INR');
  await assert.rejects(embedding.embed(db, 'query', context, preferences, deps));
  assert.equal(calls, 0);
});

test('indexing checkpoints eight chunks and immutable revisions reuse all unchanged vectors', async () => {
  let calls = 0;
  const deps = { settingsFor, embed: async () => { calls++; return vector(); } };
  const original = await doc({ chunks: Array.from({ length: 10 }, (_, i) => `Passage ${i}`) });
  assert.equal((await semantic.indexBatch(db, deps)).state, 'pending'); assert.equal(calls, 8);
  assert.equal((await semantic.indexBatch(db, deps)).state, 'ready'); assert.equal(calls, 10);
  await db.collection('ask_posnic_documents').updateOne({ _id: original._id }, { $set: { status: 'retired' } });
  await doc({ revision: '2', chunks: [...original.chunks.slice(0, 9), 'Changed passage'] });
  await semantic.indexBatch(db, deps); await semantic.indexBatch(db, deps);
  assert.equal(calls, 11);
});

test('retrieval rechecks publication, generation and shop scope; private questions cost nothing', async () => {
  let calls = 0;
  const deps = { settingsFor, embed: async () => { calls++; return vector(); } };
  const mapped = require('../../src/services/knowledge-page-map').fromPages([{ num: 2, text: 'Returns are available from Sales.' }], 3);
  const original = await doc({ kind: 'pdf', ...mapped, chunks: [mapped.content] }); await semantic.indexBatch(db, deps);
  const matches = await semantic.retrieve(db, 'shop-a', 'Give the customer their money back', context, deps);
  assert.equal(matches.length, 1); assert.equal(matches[0].text, original.chunks[0]); assert.equal(matches[0].semantic_distance, 0);
  assert.deepEqual(matches[0].pages, [2]);
  await assert.rejects(semantic.retrieve(db, 'shop-b', 'query', context, deps));
  const beforeCalls = calls;
  assert.deepEqual(await semantic.retrieve(db, 'shop-a', 'Show the current password', context, deps), []);
  assert.equal(calls, beforeCalls);
  await db.collection('ask_posnic_documents').updateOne({ _id: original._id }, { $set: { status: 'retired' } });
  assert.deepEqual(await semantic.retrieve(db, 'shop-a', 'query', context, deps), []);
  assert.equal(calls, beforeCalls);
});

test('generation edits during a query never return stale published content', async () => {
  const original = await doc(); await semantic.indexBatch(db, { settingsFor, embed: async () => vector() });
  const matches = await semantic.retrieve(db, 'shop-a', 'query', context, { settingsFor, embed: async () => {
    await db.collection('ask_posnic_documents').updateOne({ _id: original._id }, { $set: { chunks: ['New version'] } }); return vector();
  } });
  assert.deepEqual(matches, []);
});

test('unknown embedding outcomes pause indexing; processing claims are never reclaimed by age', async () => {
  let calls = 0; await doc();
  const deps = { settingsFor, embed: async () => { calls++; throw Object.assign(new Error('timeout'), { uncertain: true }); } };
  assert.equal((await semantic.indexBatch(db, deps)).state, 'needs_review');
  assert.equal((await semantic.indexBatch(db, deps)).state, 'idle'); assert.equal(calls, 1);
  await db.collection('ask_posnic_documents').deleteMany({});
  await doc({ title: 'Different source', own_semantic: { state: 'processing', started_at: new Date(0) } });
  assert.equal((await semantic.indexBatch(db, deps)).state, 'idle'); assert.equal(calls, 1);
});

test('a shared in-flight passage never causes a duplicate paid call', async () => {
  let calls = 0; const original = await doc();
  await db.collection(semantic.vectorCollection).insertOne({ _id: semantic.chunkKey(original.license, original.title, original.chunks[0]), license: original.license, state: 'processing', updated_at: new Date(0) });
  const deps = { settingsFor, embed: async () => { calls++; return vector(); } };
  assert.equal((await semantic.indexBatch(db, deps)).state, 'pending'); assert.equal(calls, 0);
});

test('over-capacity installations fall back without paying for a query', async () => {
  let calls = 0; await doc({ chunks: Array.from({ length: 5001 }, () => 'text') });
  const deps = { settingsFor, embed: async () => { calls++; return vector(); } };
  assert.equal((await semantic.indexBatch(db, deps)).state, 'pending');
  assert.deepEqual(await semantic.retrieve(db, 'shop-a', 'query', context, deps), []); assert.equal(calls, 0);
});

test('usage fractions accumulate alongside legacy rounded rows', async () => {
  await db.collection(budget.COLLECTION).insertOne({ license: 'shop-a', branch_id: 'outlet-a', month: budget.monthKey(), feature: 'ask_posnic_own_key_embedding', cost_minor: 2 });
  for (let i = 0; i < 20; i++) await budget.record({ feature: 'ask_posnic_own_key_embedding', model: embedding.MODEL, tokensIn: 20, tokensOut: 0 }, context);
  const total = (await budget.spentThisMonth(context)).total;
  assert.ok(total > 2); assert.ok(total < 3);
  assert.equal((await budget.withinCap(context, 0.02)).ok, false);
});

test('cosine comparison is normalized and opposite passages are excluded', () => {
  assert.equal(semantic.distance(vector(), vector().map((x) => x * 10)), 0);
  assert.equal(semantic.distance(vector(), vector(1)), 1);
  assert.equal(semantic.distance(vector(), vector().map((x) => -x)), 2);
});

test('a different shop cannot reuse or query another shop vector cache', async () => {
  let calls = 0;
  const deps = { settingsFor, embed: async () => { calls++; return vector(); } };
  await doc(); await semantic.indexBatch(db, deps);
  await db.collection('ask_posnic_preferences').insertOne({ ...preferences, license: 'shop-b' });
  await doc({ license: 'shop-b' }); await semantic.indexBatch(db, deps);
  assert.equal(calls, 2);
  const matches = await semantic.retrieve(db, 'shop-b', 'query', { licenseId: 'shop-b', branchId: 'outlet-a' }, deps);
  assert.equal(matches.length, 1);
  assert.equal((await db.collection('ask_posnic_documents').findOne({ _id: new ObjectId(matches[0].document_id) })).license, 'shop-b');
});

test('revocation during embedding prevents publication and removes passages from retrieval', async () => {
  const original = await doc();
  const result = await semantic.indexBatch(db, { settingsFor, embed: async () => {
    await db.collection('ask_posnic_documents').updateOne({ _id: original._id }, { $set: { visibility: 'internal' } }); return vector();
  } });
  assert.equal(result.state, 'pending');
  let calls = 0;
  assert.deepEqual(await semantic.retrieve(db, 'shop-a', 'query', context, { settingsFor, embed: async () => { calls++; return vector(); } }), []);
  assert.equal(calls, 0);
});

test('owner usage includes pending reservations without exposing claim IDs', async () => {
  const hold = await embedding.reserve(db, context, 1, 25e6, 'INR');
  const status = await embedding.status(context, 1);
  assert.equal(status.remaining_minor, 75); assert.equal(status.pending_calls, 1);
  assert.ok(!JSON.stringify(status).includes(hold.claim));
  assert.equal((await embedding.status({ ...context, branchId: 'other' }, 1)).pending_calls, 0);
});

test('background metering uses its explicit shop and currency cache does not cross licenses', async () => {
  await db.collection('branches').insertOne({ _id: 'outlet-a', currency: 'USD' });
  assert.equal((await budget.currencyOf(context)).code, 'USD');
  await db.collection('branches').updateOne({ _id: 'outlet-a' }, { $set: { currency: 'INR' } });
  const other = { ...context, licenseId: 'shop-b' };
  assert.equal((await budget.currencyOf(other)).code, 'INR');
  await budget.record({ feature: 'ask_posnic_own_key_embedding', model: embedding.MODEL, tokensIn: 20, tokensOut: 0 }, other);
  assert.equal((await db.collection(budget.COLLECTION).findOne({})).license, 'shop-b');
  assert.equal((await budget.spentThisMonth(context)).total, 0);
});

test('cache cleanup removes only unreferenced completed vectors and rotates retained entries', async () => {
  const source = await doc();
  await semantic.indexBatch(db, { settingsFor, embed: async () => vector() });
  const key = semantic.chunkKey(source.license, source.title, source.chunks[0]);
  await db.collection(semantic.vectorCollection).updateOne({ _id: key }, { $set: { updated_at: new Date(0) } });
  await db.collection(semantic.vectorCollection).insertMany([
    { _id: 'unreferenced', license: 'shop-a', state: 'ready', vector: vector(), updated_at: new Date(0) },
    { _id: 'uncertain', license: 'shop-a', state: 'needs_review', updated_at: new Date(0) },
    { _id: 'processing', license: 'shop-a', state: 'processing', updated_at: new Date(0) },
  ]);
  assert.equal((await semantic.indexBatch(undefined, { settingsFor })).state, 'idle');
  assert.equal(await db.collection(semantic.vectorCollection).findOne({ _id: 'unreferenced' }), null);
  assert.equal(await db.collection(semantic.vectorCollection).countDocuments(), 3);
  assert.ok((await db.collection(semantic.vectorCollection).findOne({ _id: key })).updated_at > new Date(0));
});

test('5000 stored passages scan with bounded batches and return only ten nearest matches', async (t) => {
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const source = await doc({ title: `Source ${i}`, chunks: Array.from({ length: 100 }, (_, j) => `Published passage ${i}:${j}`) });
    const keys = source.chunks.map((text) => semantic.chunkKey(source.license, source.title, text));
    await db.collection('ask_posnic_documents').updateOne({ _id: source._id }, { $set: { own_semantic: { state: 'ready', generation: semantic.sourceHash(source), keys } } });
    rows.push(...keys.map((key) => ({ _id: key, license: 'shop-a', state: 'ready', vector: vector(i % 2) })));
  }
  await db.collection(semantic.vectorCollection).insertMany(rows);
  const start = performance.now();
  const result = await semantic.retrieve(db, 'shop-a', 'query', context, { settingsFor, embed: async () => vector() });
  const elapsed = performance.now() - start;
  assert.equal(result.length, 10); assert.ok(result.every((row) => row.semantic_distance === 0));
  assert.ok(elapsed < 10000, `Local scan exceeded ten seconds: ${elapsed}`);
  t.diagnostic(`5000 passages: ${Math.round(elapsed)} ms on this test machine`);
});
