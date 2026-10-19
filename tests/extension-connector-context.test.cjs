'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readerAllowed, readContext } = require('../api/src/services/extension-connector-context');
const id = 'a'.repeat(24), branchId = 'b'.repeat(24), license = 'c'.repeat(24);
test('a connector reader is restricted to its explicit installation grant and read endpoint', () => {
  const req = { isApiKey: true, method: 'GET', path: '/connector-context', user: { _id: id, access: { extensions: { read: true } } } };
  assert.equal(readerAllowed(req, { connectorReaderId: id }), true);
  for (const changes of [{ method: 'POST' }, { path: '/commands' }, { path: '/state' }, { isApiKey: false }])
    assert.equal(readerAllowed({ ...req, ...changes }, { connectorReaderId: id }), false);
  assert.equal(readerAllowed(req, {}), false);
  assert.equal(readerAllowed(req, { connectorReaderId: 'd'.repeat(24) }), false);
  assert.equal(readerAllowed({ ...req, user: { ...req.user, access: {} } }, { connectorReaderId: id }), false);
});
test('connector authorization readback enforces staff revocation, permission and branch on every call', async () => {
  let user = { _id: id, activate: true, branch_id: branchId, access: { extensions: { read: true } } };
  const args = { scope: { license, branchId }, descriptor: {}, query: { resource: 'authorization', userId: id, permission: 'read' }, db: { collection: name => {
    assert.equal(name, 'users'); return { findOne: async filter => { assert.equal(String(filter.license), license); assert.equal(String(filter._id), id); return user; } };
  } } };
  assert.deepEqual(await readContext(args), { authorized: true });
  await assert.rejects(readContext({ ...args, query: { ...args.query, permission: 'manage' } }), /revoked/);
  user = { ...user, branch_id: 'd'.repeat(24) };
  await assert.rejects(readContext(args), /revoked/);
  user = { ...user, branch_id: branchId, active: false };
  await assert.rejects(readContext(args), /revoked/);
  user = null;
  await assert.rejects(readContext(args), /revoked/);
});
test('connector resources reject arbitrary collections, oversized selections and caller scope', async () => {
  for (const query of [{ resource: 'users' }, { resource: 'products', ids: 'bad' }, { resource: 'products', ids: Array(201).fill(id).join(',') }, { resource: 'state', license: 'other' }])
    await assert.rejects(readContext({ query }), /Invalid|Unsupported/);
});
test('real router permits only the approved reader context endpoint, including after revocation', async (t) => {
  const { createRequire } = require('node:module');
  const api = createRequire(require('node:path').resolve(__dirname, '../api/package.json'));
  const express = api('express');
  const routes = require('../api/src/routes/extensions.routes');
  let enabled = true;
  const descriptor = { id: 'example.connector', packageDigest: 'f'.repeat(64), commands: {} };
  const db = { collection: name => ({ findOne: async () => {
    if (name === 'branches') return { _id: branchId, license };
    if (name === 'extension_installations') return enabled ? { connectorReaderId: id } : null;
    if (name === 'extension_namespaces') return {};
    if (name === 'users') return { _id: id, activate: true, branch_id: branchId, access: { extensions: { read: true } } };
    throw Error('Unexpected collection');
  } }) };
  const app = express(); app.use(express.json());
  app.use('/extensions/v1', routes.createRouter({ registry: { get: () => descriptor }, authenticate: (req, res, next) => {
    req.db = db; req.isApiKey = true; req.user = { _id: id, access: { extensions: { read: true, write: true, manage: true } } };
    req.tenantContext = { licenseId: license, branchId }; next();
  } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/extensions/v1/example.connector';
  const query = '/connector-context?resource=authorization&userId=' + id + '&permission=read';
  assert.equal((await fetch(base + query)).status, 200);
  for (const route of ['/state', '/view', '/catalogue', '/sales', '/capabilities']) assert.equal((await fetch(base + route)).status, 403);
  assert.equal((await fetch(base + '/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  enabled = false;
  assert.equal((await fetch(base + query)).status, 403);
});
