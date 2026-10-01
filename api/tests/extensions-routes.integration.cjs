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
  await db.collection('branches').insertOne({ _id: branchId, license });
  await db
    .collection('extension_installations')
    .insertOne({
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
