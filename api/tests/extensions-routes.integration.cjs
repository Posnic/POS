'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createRouter } = require('../src/routes/extensions.routes');
let mongo, client, db, server, url;
const license = new ObjectId(),
  branchId = new ObjectId(),
  userId = new ObjectId();
const descriptor = {
  id: 'posnic.example',
  version: '1.0.0',
  packageDigest: 'a'.repeat(64),
  displayName: 'Example extension',
  view: { html: '<main>Example</main>', css: '', script: '' },
  initialState: { records: [] },
  commands: { create: ['write'] },
  plan: async ({ actor, operationId }) => ({
    state: { actorId: actor.userId },
    effects: [],
    result: { recordId: operationId },
  }),
};
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('extension_routes');
  await db
    .collection('branches')
    .insertOne({ _id: branchId, license, currency: 'GBP', time_zone: 'Europe/London' });
  await db.collection('extension_installations').insertOne({
    license,
    branch_id: branchId,
    extensionId: descriptor.id,
    packageDigest: descriptor.packageDigest,
    enabled: true,
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/extensions/v1',
    createRouter({
      registry: {
        get: (id) => (id === descriptor.id ? descriptor : null),
        list: () => [descriptor, { ...descriptor, id: 'posnic.disabled' }],
        capabilities: ['namespace.commands.v1'],
      },
      authenticate: (req, res, next) => {
        if (!['Bearer owner', 'Bearer reader', 'Bearer key'].includes(req.get('Authorization')))
          return res.sendStatus(401);
        req.db = db;
        req.tenantContext = { licenseId: license, branchId };
        req.isApiKey = req.get('Authorization') === 'Bearer key';
        req.user = {
          _id: userId,
          usertype: req.get('Authorization') === 'Bearer owner' ? 'owner' : 'cashier',
          access: { extensions: { read: true } },
        };
        next();
      },
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/api/extensions/v1/posnic.example`;
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await client?.close();
  await mongo?.stop();
});
const request = (path, { token = 'owner', body, key = 'request-operation-001' } = {}) =>
  fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
test('registered package, shop enablement and staff session are all required', async () => {
  assert.equal((await request('/capabilities', { token: 'none' })).status, 401);
  assert.equal((await request('/capabilities', { token: 'key' })).status, 403);
  const capabilities = await request('/capabilities');
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await capabilities.json()).capabilities, ['namespace.commands.v1']);
  await db
    .collection('extension_installations')
    .updateOne({ extensionId: descriptor.id }, { $set: { enabled: false } });
  assert.equal((await request('/state')).status, 403);
  await db
    .collection('extension_installations')
    .updateOne({ extensionId: descriptor.id }, { $set: { enabled: true } });
});
test('browser cannot invent write permission, actor, company or branch', async () => {
  const body = {
    expectedRevision: 0,
    command: { type: 'create' },
    actor: { userId: String(new ObjectId()), permissions: ['write', 'manage'] },
    license: String(new ObjectId()),
    branchId: String(new ObjectId()),
  };
  assert.equal((await request('/commands', { token: 'reader', body })).status, 403);
  const response = await request('/commands', { body });
  assert.equal(response.status, 200);
  const state = await (await request('/state')).json();
  assert.equal(state.state.actorId, String(userId));
  assert.equal(state.revision, 1);
  const documents = await db.collection('extension_namespaces').find().toArray();
  assert.equal(documents.length, 1);
  assert.equal(String(documents[0].license), String(license));
  assert.equal(String(documents[0].branch_id), String(branchId));
});

test('signed view and catalogue retain staff, installation and branch boundaries', async () => {
  const list = await fetch(url.replace('/posnic.example', ''), {
    headers: { Authorization: 'Bearer reader' },
  });
  assert.deepEqual((await list.json()).extensions, [
    { id: descriptor.id, displayName: descriptor.displayName, version: descriptor.version },
  ]);
  assert.equal((await request('/view', { token: 'key' })).status, 403);
  const view = await (await request('/view', { token: 'reader' })).json();
  assert.deepEqual(view.view, descriptor.view);
  assert.equal(view.displayName, descriptor.displayName);
  const caps = await (await request('/capabilities', { token: 'reader' })).json();
  assert.deepEqual(caps.actor, { userId: String(userId), permissions: ['read'] });
  const item = {
    license,
    branch_id: branchId,
    name: 'Candle [small]',
    barcode_id: 'SKU-001',
    track_inventory: true,
    item_status: 'regular',
    available_quantity: 3,
    unit: 'each',
    selling_price: 1,
    tax: 0,
  };
  await db
    .collection('items')
    .insertMany([
      { ...item },
      { ...item, branch_id: new ObjectId() },
      { ...item, license: new ObjectId() },
      { ...item, name: 'Candle large' },
      { ...item, selling_price: 0 },
    ]);
  const page = await (await request('/catalogue?q=%5Bsmall%5D')).json();
  assert.equal(page.products.length, 1);
  assert.equal(page.products[0].description, 'Candle [small]');
  assert.equal(page.products[0].stockMilli, 3000);
  assert.equal(page.products[0].priceMinor, 100);
  assert.equal(page.products[0].pricing, undefined);
  assert.equal(page.unavailableCount, 1);
  assert.equal(page.next, null);
  assert.equal((await request('/catalogue?q[$ne]=x')).status, 422);
  assert.equal((await request('/catalogue?after=not-an-id')).status, 422);
  assert.equal((await request('/catalogue', { token: 'key' })).status, 403);
  await db.collection('items').insertMany(
    Array.from({ length: 55 }, (_, index) => ({
      ...item,
      name: 'Page ' + index,
    }))
  );
  const first = await (await request('/catalogue?q=Page')).json();
  const second = await (await request('/catalogue?q=Page&after=' + first.next)).json();
  assert.equal(first.products.length, 50);
  assert.equal(second.products.length, 5);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.products, ...second.products].map((p) => p.id)).size, 55);
});
