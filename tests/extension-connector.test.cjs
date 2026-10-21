'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { connectorOperations, requestConnector, MAX_RESPONSE } = require('../api/src/services/extension-connector');
const scope = { license: '1'.repeat(24), branchId: '2'.repeat(24) };
const descriptor = { id: 'example.delivery', packageDigest: 'a'.repeat(64), connectorOperations: connectorOperations({ 'orders.list': ['read'], 'orders.save': ['write'] }) };
const actor = { userId: '3'.repeat(24), permissions: ['read'] };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'connector-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32), secretFile = path.join(root, 'secret');
  await fs.writeFile(secretFile, secret);
  const grant = { enabled: true, extensionId: descriptor.id, packageDigest: descriptor.packageDigest, ...scope, endpoint: 'http://127.0.0.1:45678/v1/requests', secretFile };
  let calls = 0;
  const args = { descriptor, actor, scope, input: { operation: 'orders.list', payload: { search: 'tea' } }, load: async () => [grant], fetcher: async (url, options) => {
    calls++;
    assert.equal(url, grant.endpoint);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-posnic-signature'], crypto.createHmac('sha256', secret).update(options.body).digest('hex'));
    const body = JSON.parse(options.body);
    assert.deepEqual(body.scope, scope);
    assert.deepEqual(body.actor, actor);
    assert.equal(body.extensionId, descriptor.id);
    assert.equal(body.packageDigest, descriptor.packageDigest);
    assert.equal(Object.hasOwn(body, 'db'), false);
    return Response.json({ requestId: body.requestId, result: { orders: [] } });
  } };
  return { args, grant, calls: () => calls };
}

test('signed operation permissions reject malformed declarations', () => {
  for (const value of [null, [], {}, { a: ['read'] }, { 'orders.list': [] }, { 'orders.list': ['root'] }])
    assert.throws(() => connectorOperations(value), /contract_invalid/);
  assert.deepEqual([...connectorOperations({ 'orders.save': ['write'] })['orders.save']], ['read', 'write']);
});

test('connector receives only signed scope and a bounded operation, without host credentials', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await requestConnector(f.args), { orders: [] });
  assert.equal(f.calls(), 1);
});

test('unknown operations and insufficient staff permissions make no connector call', async (t) => {
  const f = await fixture(t);
  for (const input of [{ operation: 'orders.save' }, { operation: 'constructor' }, { operation: 'orders.list', url: 'http://evil.test' }])
    await assert.rejects(requestConnector({ ...f.args, input }), /forbidden|permission_denied/);
  assert.equal(f.calls(), 0);
});

test('tenant, branch, package changes and disabled or duplicate grants fail closed', async (t) => {
  const f = await fixture(t);
  for (const change of [{ license: '4'.repeat(24) }, { branchId: '4'.repeat(24) }, { packageDigest: 'b'.repeat(64) }, { extensionId: 'other.extension' }, { enabled: false }])
    await assert.rejects(requestConnector({ ...f.args, load: async () => [{ ...f.grant, ...change }] }), /not_provisioned/);
  await assert.rejects(requestConnector({ ...f.args, load: async () => [f.grant, f.grant] }), /not_provisioned/);
  assert.equal(f.calls(), 0);
});

test('transport cannot reach arbitrary hosts, redirects, credentials or paths', async (t) => {
  const f = await fixture(t);
  for (const endpoint of ['https://example.test/v1/requests', 'http://127.0.0.1:80/admin', 'http://user:pass@127.0.0.1:80/v1/requests', 'http://127.0.0.1:80/v1/requests?url=x', 'file:///etc/passwd'])
    await assert.rejects(requestConnector({ ...f.args, load: async () => [{ ...f.grant, endpoint }] }), /configuration_invalid/);
  assert.equal(f.calls(), 0);
});

test('oversized, mismatched and failed responses never reach the UI; failures are not retried', async (t) => {
  const f = await fixture(t);
  for (const fetcher of [
    async () => new Response('x', { status: 503 }),
    async () => Response.json({ requestId: 'wrong', result: {} }),
    async () => new Response('x'.repeat(MAX_RESPONSE + 1), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(requestConnector({ ...f.args, fetcher }), /connector_/);
  let calls = 0;
  await assert.rejects(requestConnector({ ...f.args, fetcher: async () => { calls++; throw Error('secret transport detail'); } }), /extension_connector_unavailable/);
  assert.equal(calls, 1);
});
