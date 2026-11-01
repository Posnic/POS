const test = typeof global.test === 'function' ? global.test : require('node:test');
const assert = require('node:assert/strict');
const origin = require('../src/utils/item-creation-origin');
const { sanitizeItemData } = require('../src/helpers/items.helper');

test('concurrent imports keep separate request identity and authenticated actors', async () => {
  const run = name => new Promise(resolve => origin.middleware({ originalUrl: '/api/items/itemsImport?secret=hidden', get: () => 'Mozilla/5.0 Electron/43.0' }, {}, async () => {
    await new Promise(r => setImmediate(r));
    const a = origin.record('item_import', { userId: name, userName: name, branchId: name });
    await new Promise(r => setImmediate(r));
    const b = origin.record('item_import', { userId: name, userName: name, branchId: name });
    assert.equal(a.request_id, b.request_id);
    assert.equal(a.actor_name, name);
    assert.equal(a.client, 'desktop');
    assert.equal(a.endpoint, '/api/items/itemsImport');
    resolve(a);
  }));
  const [a,b] = await Promise.all([run('one'), run('two')]);
  assert.notEqual(a.request_id, b.request_id);
  assert.notEqual(a.branch_id, b.branch_id);
});

test('authentication populated after middleware is authoritative; body cannot spoof creator', () => {
  const req = { body: { creation_origin: { actor_name: 'forged' } }, get: () => 'Mozilla/5.0' };
  origin.middleware(req, {}, () => {
    req.user = { _id: 'real-id', email: 'real-account' };
    req.isApiKey = true;
    const value = origin.record('add_item', { userName: 'forged' });
    assert.equal(value.actor_name, 'real-account');
    assert.equal(value.authentication, 'api_key');
    assert.equal(value.client, 'browser');
    assert.equal(sanitizeItemData(req.body).creation_origin, undefined);
    req.isApiKey = false; req.isScopedApiToken = true;
    assert.equal(origin.record('add_item').authentication, 'integration_token');
  });
});

test('internal batches preserve server batch id; old provenance is not invented', () => {
  const at = new Date('2026-10-28T00:00:00Z');
  const value = origin.record('item_import', { creationBatchId: 'batch', userName: 'worker' }, at);
  assert.equal(value.request_id, 'batch');
  assert.equal(value.recorded_at, at);
  assert.equal(value.client, 'unknown');
  assert.equal(value.authentication, 'internal');
});

test('verified webhook context survives async work without leaking to later writes', async () => {
  await origin.withSource('webhook', async () => {
    await new Promise(r => setImmediate(r));
    assert.equal(origin.record('add_item').source, 'webhook');
  });
  assert.equal(origin.record('add_item').source, 'internal');
  assert.throws(() => origin.withSource('arbitrary-client-string', () => {}));
});
