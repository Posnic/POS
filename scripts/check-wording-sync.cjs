const path = require('path');
const assert = require('node:assert/strict');
const pos = process.env.WORDING_POS_ROOT || path.resolve(__dirname, '..');
const gateway = process.env.WORDING_GATEWAY_ROOT;
if (!gateway) throw new Error('Set WORDING_GATEWAY_ROOT to the matching Gateway checkout. This check uses disposable MongoDB only.');
const { MongoMemoryServer } = require(path.join(pos, 'api/node_modules/mongodb-memory-server'));
const { MongoClient } = require(path.join(pos, 'api/node_modules/mongodb'));
const { EJSON } = require(path.join(pos, 'api/node_modules/bson'));
const express = require(path.join(gateway, 'apps/sync-gateway/node_modules/express'));
const { createSyncRouter } = require(path.join(gateway, 'apps/sync-gateway/src/routes/sync'));
const { WordingProfiles, createRegistry, resolveBundle } = require(path.join(pos, 'api/src/services/wording-profiles'));
(async () => {
  const memory = await MongoMemoryServer.create();
  const client = await MongoClient.connect(memory.getUri());
  const gatewayClient = await require(path.join(gateway, 'apps/sync-gateway/node_modules/mongodb')).MongoClient.connect(memory.getUri());
  let server;
  try {
    const labels = createRegistry({ lang_takeaway: 'Takeaway' });
    const branch = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const svc = new WordingProfiles(client.db('shop').collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
    let state = await svc.save({ name: 'English shop', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Parcel' }, expectedRevision: 0 }, 'owner');
    state = await svc.publish({ id: state.profiles[0].id, expectedRevision: 1, branches: [branch] }, 'owner', [branch]);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.device = { tenantDb: req.headers['x-test-tenant'] || 'shop', deviceId: req.headers['x-test-device'] || 'till1', branches: [] }; next(); });
    app.use(createSyncRouter(gatewayClient));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const request = async (route, body, headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(EJSON.serialize(body)) });
      assert.equal(response.status, 200); return EJSON.deserialize(await response.json());
    };
    const first = await request('pull', { collection: 'settings' });
    assert.equal(first.docs.length, 1);
    for (const till of ['till1', 'till2']) {
      await client.db(till).collection('settings').replaceOne({ _id: first.docs[0]._id }, first.docs[0], { upsert: true });
      const local = new WordingProfiles(client.db(till).collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
      assert.equal(resolveBundle(await local.read(), branch, 'en', labels).values.lang_takeaway, 'Parcel');
    }
    assert.equal((await request('pull', { collection: 'settings', since: first.checkpoint })).docs.length, 0);
    assert.equal((await request('pull', { collection: 'settings' }, { 'x-test-tenant': 'another_shop' })).docs.length, 0);
    const stale = first.docs[0]; stale.updated_date = new Date(0); stale.revision = 0;
    await request('push', { collection: 'settings', docs: [stale] });
    assert.equal((await svc.read()).revision, 2);
    await request('push', { collection: 'settings', docs: [stale] });
    assert.equal((await svc.read()).revision, 2);
    console.log('PASS: actual gateway pull, two offline till databases, checkpoint resume, tenant isolation, stale retry protection');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await gatewayClient.close(); await client.close(); await memory.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
