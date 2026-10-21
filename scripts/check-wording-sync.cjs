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
  let server, agentClient;
  try {
    const labels = createRegistry({ lang_takeaway: 'Takeaway' });
    const branch = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    await client.db('shop').collection('branches').insertOne({
      _id: new (require(path.join(pos, 'api/node_modules/mongodb')).ObjectId)(branch),
      license: new (require(path.join(pos, 'api/node_modules/mongodb')).ObjectId)('aaaaaaaaaaaaaaaaaaaaaaaa'),
    });
    const svc = new WordingProfiles(client.db('shop').collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
    let state = await svc.save({ name: 'English shop', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Parcel' }, expectedRevision: 0 }, 'owner');
    state = await svc.publish({ id: state.profiles[0].id, expectedRevision: 1, branches: [branch] }, 'owner', [branch]);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.device = { tenantDb: req.headers['x-test-tenant'] || 'shop', deviceId: req.headers['x-test-device'] || (req.headers.authorization ? 'bundled-agent' : 'till1'), branches: [req.headers['x-test-branch'] || branch] }; next(); });
    app.use('/v1/sync', createSyncRouter(gatewayClient));
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
    state = await svc.save({ id: state.profiles[0].id, name: 'Shop wording', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Pickup' }, expectedRevision: 2 }, 'owner');
    state = await svc.publish({ id: state.profiles[0].id, expectedRevision: 3, branches: [branch] }, 'owner', [branch]);
    const offline = new WordingProfiles(client.db('till2').collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
    assert.equal(resolveBundle(await offline.read(), branch, 'en', labels).values.lang_takeaway, 'Parcel');
    const update = await request('pull', { collection: 'settings', since: first.checkpoint });
    assert.equal(update.docs.length, 1);
    for (const till of ['till1', 'till2']) {
      await client.db(till).collection('settings').replaceOne({ _id: update.docs[0]._id }, update.docs[0]);
      const local = new WordingProfiles(client.db(till).collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
      const bundle = resolveBundle(await local.read(), branch, 'en', labels);
      assert.equal(bundle.values.lang_takeaway, 'Pickup');
      assert.equal(bundle.profileName, 'Shop wording');
      assert.equal(bundle.sourceValues.Takeaway, 'Pickup');
    }
    const stale = first.docs[0]; stale.updated_date = new Date(0); stale.revision = 0;
    await request('push', { collection: 'settings', docs: [stale] });
    assert.equal((await svc.read()).revision, 4);
    await request('push', { collection: 'settings', docs: [stale] });
    assert.equal((await svc.read()).revision, 4);
    await svc.publish({ id: state.profiles[0].id, expectedRevision: 4, branches: [] }, 'owner', [branch]);
    const removed = await request('pull', { collection: 'settings', since: update.checkpoint });
    assert.equal(removed.docs.length, 1);
    for (const till of ['till1', 'till2']) {
      await client.db(till).collection('settings').replaceOne({ _id: removed.docs[0]._id }, removed.docs[0]);
      const local = new WordingProfiles(client.db(till).collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
      assert.deepEqual({ ...resolveBundle(await local.read(), branch, 'en', labels).values }, {});
      assert.equal((await local.read()).profiles[0].revisions.length, 3);
    }
    const current = await svc.read();
    const deleted = await svc.remove({id: current.profiles[0].id, expectedRevision: current.revision}, 'owner', [branch]);
    const deletion = await request('pull', {collection:'settings', since:removed.checkpoint});
    assert.equal(deletion.docs.length, 1);
    for (const till of ['till1','till2']) {
      await client.db(till).collection('settings').replaceOne({_id:deletion.docs[0]._id},deletion.docs[0]);
      const local = new WordingProfiles(client.db(till).collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', labels);
      assert.ok((await local.read()).profiles[0].deletedAt);
      assert.deepEqual({...resolveBundle(await local.read(),branch,'en',labels).values},{});
    }
    await request('push', {collection:'settings', docs:[removed.docs[0]]});
    assert.equal((await svc.read()).revision, deleted.revision, 'stale retry cannot resurrect deleted profile');
    const snapshot = await require(path.join(pos, 'api/src/services/document-wording-snapshot')).capture(
      client.db('till1').collection('settings'), 'aaaaaaaaaaaaaaaaaaaaaaaa', branch
    );
    const ObjectId = require(path.join(pos, 'api/node_modules/mongodb')).ObjectId;
    const sale = { _id: new ObjectId(), branch_id: new ObjectId(branch),
      license: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), sales_id: 'WORDING-TEST-1',
      wording_snapshot: snapshot, updated_date: new Date(), total: 10 };
    await request('push', { collection: 'sales', docs: [sale] });
    const delivered = await request('pull', { collection: 'sales' }, { 'x-test-device': 'till2' });
    assert.equal(delivered.docs.length, 1);
    assert.deepEqual(delivered.docs[0].wording_snapshot, snapshot);
    assert.equal((await request('pull', { collection: 'sales' }, { 'x-test-tenant': 'another_shop' })).docs.length, 0);
    assert.equal((await request('pull', { collection: 'sales' }, { 'x-test-branch': 'cccccccccccccccccccccccc' })).docs.length, 0);
    const staleSale = { ...sale, updated_date: new Date(0), wording_snapshot: null };
    await request('push', { collection: 'sales', docs: [staleSale] });
    assert.deepEqual((await client.db('shop').collection('sales').findOne({ _id: sale._id })).wording_snapshot, snapshot);
    const receiving = { ...sale, _id: new ObjectId(), receiving_id: 'WORDING-PURCHASE-1' };
    delete receiving.sales_id;
    await request('push', { collection: 'receivings', docs: [receiving] });
    const purchases = await request('pull', { collection: 'receivings' }, { 'x-test-device': 'till2' });
    assert.equal(purchases.docs.length, 1);
    assert.deepEqual(purchases.docs[0].wording_snapshot, snapshot);
    assert.equal((await request('pull', { collection: 'receivings' }, { 'x-test-tenant': 'another_shop' })).docs.length, 0);
    assert.equal((await request('pull', { collection: 'receivings' }, { 'x-test-branch': 'cccccccccccccccccccccccc' })).docs.length, 0);
    await request('push', { collection: 'receivings', docs: [{ ...receiving, updated_date: new Date(0), wording_snapshot: null }] });
    assert.deepEqual((await client.db('shop').collection('receivings').findOne({ _id: receiving._id })).wording_snapshot, snapshot);
    const agentRoot = process.env.WORDING_AGENT_ROOT;
    if (agentRoot) {
      const agent = require(path.join(agentRoot, 'src/sync'));
      const agentRequire = require('node:module').createRequire(path.join(agentRoot, 'src/sync.js'));
      const agentMongo = agentRequire('mongodb');
      agentClient = await agentMongo.MongoClient.connect(memory.getUri());
      const agentSaleId = new agentMongo.ObjectId(String(sale._id));
      const agentReceivingId = new agentMongo.ObjectId(String(receiving._id));
      const checkpoints = {};
      const agentState = {
        getCheckpoints: async name => checkpoints[name] || {},
        setPullSince: async (name, value) => { (checkpoints[name] ||= {}).pullSince = value; },
        setPushSince: async (name, value) => { (checkpoints[name] ||= {}).pushSince = value; },
      };
      const cfg = { gatewayUrl: `http://127.0.0.1:${server.address().port}`, deviceToken: 'disposable-test-device' };
      const local = agentClient.db('bundled_agent_till');
      for (const name of ['settings', 'sales', 'receivings']) {
        assert.equal(await agent.pullCollection(local, agentState, cfg, name), 1, name);
        assert.equal(await agent.pullCollection(local, agentState, cfg, name), 0);
      }
      assert.deepEqual((await local.collection('sales').findOne({ _id: agentSaleId })).wording_snapshot, snapshot);
      assert.deepEqual((await local.collection('receivings').findOne({ _id: agentReceivingId })).wording_snapshot, snapshot);
      assert.equal(await agent.pushCollection(local, agentState, cfg, 'sales'), 0, 'pulled sales must not echo');
      await local.collection('sales').updateOne({ _id: agentSaleId }, { $set: { updated_date: new Date(Date.now() + 1000), comment: 'later local edit' } });
      assert.equal(await agent.pushCollection(local, agentState, cfg, 'sales'), 1);
      assert.equal(await agent.pushCollection(local, agentState, cfg, 'sales'), 0);
      assert.deepEqual((await client.db('shop').collection('sales').findOne({ _id: sale._id })).wording_snapshot, snapshot);
      console.log('PASS: exact bundled agent pull, checkpoint restart, echo suppression, local-edit push and duplicate retry');
    }
    console.log('PASS: actual gateway profile delivery and immutable sale/purchase wording, offline retention, two-till reconnect, tenant/branch isolation, stale duplicate retry protection');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); if (agentClient) await agentClient.close(); await gatewayClient.close(); await client.close(); await memory.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
