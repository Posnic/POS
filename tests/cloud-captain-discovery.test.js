'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { refresh } = require('../src/cloud-captain-discovery');
const address = require('../api/src/utils/captain-cloud-address');
const id = 'a'.repeat(24);
function fixture(identity = { tenantDb: 'shop_one', branchIds: [id], connections: { cloud: 'https://azure.posnic.io/api' } }) {
  const writes = [];
  return { writes, args: {
    config: { gatewayUrl: 'https://gateway.posnic.com', deviceToken: 'test-token' }, savedTenant: 'shop_one',
    db: { collection: () => ({ find: () => ({ toArray: async () => [{ _id: id }] }), updateMany: async (...args) => { writes.push(args); return { matchedCount: 1 }; } }) },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://gateway.posnic.com/v1/device/identity');
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, 'Bearer test-token');
      return { ok: true, json: async () => identity };
    },
  } };
}
test('verified discovery is stored against the local branch without changing the manual setting', async () => {
  const f = fixture(); const result = await refresh(f.args);
  assert.equal(result.cloud, 'https://azure.posnic.io/api');
  assert.deepEqual(f.writes, [[{ _id: { $in: [id] } }, { $set: { captain_cloud_url: result.cloud } }]]);
  assert.equal(address({ captain_cloud_url: result.cloud }), result.cloud);
  assert.equal(address({ captain_cloud_url: result.cloud, captain_fallback_url: 'https://manual.example/api' }), 'https://manual.example/api');
});
test('a different tenant or branch cannot publish a cloud route', async () => {
  for (const identity of [{ tenantDb: 'other', branchIds: [id] }, { tenantDb: 'shop_one', branchIds: ['b'.repeat(24)] }]) {
    const f = fixture(identity); await assert.rejects(refresh(f.args), /never merged/); assert.equal(f.writes.length, 0);
  }
});
test('old gateways and failed requests preserve cached details; explicit null clears only discovery', async () => {
  const old = fixture({ tenantDb: 'shop_one', branchIds: [id] }); await refresh(old.args); assert.equal(old.writes.length, 0);
  const failed = fixture(); failed.args.fetchImpl = async () => ({ ok: false });
  await assert.rejects(refresh(failed.args)); assert.equal(failed.writes.length, 0);
  const cleared = fixture({ tenantDb: 'shop_one', branchIds: [id], connections: { cloud: null } });
  await refresh(cleared.args); assert.deepEqual(cleared.writes[0][1], { $unset: { captain_cloud_url: '' } });
});
test('unsafe cloud addresses never reach the local database', async () => {
  for (const cloud of ['http://azure.posnic.io/api', 'https://user:pass@azure.posnic.io/api', 'https://azure.posnic.io/api?key=x', 'https://localhost/api']) {
    const f = fixture({ tenantDb: 'shop_one', branchIds: [id], connections: { cloud } });
    await assert.rejects(refresh(f.args), /Invalid cloud/); assert.equal(f.writes.length, 0);
  }
});

test('packaged desktop includes discovery refresh at startup and after enrollment', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../src/main.js'), 'utf8');
  assert.ok(require('../package.json').build.files.includes('src/cloud-captain-discovery.js'));
  assert.match(source, /setInterval\(\(\) => refreshCaptainDiscovery\(\)\.catch\(\(\) => \{\}\), 5 \* 60_000\)\.unref\(\)/);
  assert.ok(source.indexOf('refreshCaptainDiscovery().catch') < source.indexOf('async function refreshCaptainDiscovery'));
});
