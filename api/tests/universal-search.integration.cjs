'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('search respects the selected shop, branch, feature and staff permissions', async (t) => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  t.after(async () => {
    await client.close();
    await mongo.stop();
  });
  const BaseModel = require('../src/models/base.model');
  const tenant = require('../src/db/tenant-context');
  const { createRouter } = require('../src/routes/search.routes');
  const migrate = require('../src/db/migrations/universal-search');
  const shop = client.db('first');
  const other = client.db('second');
  BaseModel.database = shop;
  const branchId = new ObjectId(),
    licenseId = new ObjectId(),
    staff = new ObjectId();
  const base = { branch_id: branchId, license: licenseId };
  for (const db of [shop, other]) {
    await db
      .collection('branches')
      .insertOne({ _id: branchId, license: licenseId, country: 'India', invoices_enable: false });
    await db.collection('customers').insertMany([
      { ...base, name: db.databaseName + ' Customer', phone: '(98765) 00142' },
      { ...base, name: 'Elsewhere', branch_id: new ObjectId(), phone: '9876500142' },
      { ...base, name: 'Deleted', is_deleted: true, phone: '9876500142' },
    ]);
    await db.collection('sales').insertOne({ ...base, sales_id: 'S-0042' });
    await db.collection('invoices').insertOne({ ...base, invoice_id: 'S-0042' });
    await migrate(db);
    await migrate(db);
  }
  const app = express();
  app.use(express.json());
  app.use(
    '/search',
    createRouter((req, res, next) => {
      req.db = req.get('shop') === 'second' ? other : shop;
      req.user = {
        _id: staff,
        access: { customer: { read: true }, sales: { read: req.get('sales') === 'yes' } },
      };
      req.tenantContext = { branchId, licenseId, validated: true };
      tenant.runWithTenant({ db: req.db }, next);
    }),
  );
  const runtime = require('../src/services/extension-runtime');
  const { contribution } = require('../src/services/extension-search');
  const id = 'posnic.service',
    digest = 'a'.repeat(64);
  runtime.registerVerified(
    {
      id,
      plan: () => {},
      view: {},
      permissionModule: 'customer',
      initialState: { tickets: [{ ref: 'SR-12', summary: 'Repair ticket' }] },
      search: contribution([
        { target: 'ticket', label: 'Ticket', records: 'tickets', id: 'ref', title: 'summary' },
      ]),
    },
    digest,
  );
  t.after(() => runtime.clear());
  await shop
    .collection('extension_installations')
    .insertOne({ ...base, extensionId: id, packageDigest: digest, enabled: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function call(path, method, body, headers = {}) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/search' + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }
  assert.equal(
    (await call('', 'POST', { q: 'SR-12', group: 'Extensions' })).results[0].hash,
    'extensions/posnic.service/find/ticket/SR-12',
  );
  await shop
    .collection('extension_namespaces')
    .insertOne({ ...base, extensionId: id, lifecycle: { enabled: false } });
  assert.equal((await call('', 'POST', { q: 'SR-12', group: 'Extensions' })).results.length, 0);
  for (const name of ['first', 'second']) {
    const data = await call('', 'POST', { q: '+91 98765 00142' }, { shop: name });
    assert.equal(data.partial, false);
    assert.deepEqual(
      data.results.map((r) => r.name),
      [name + ' Customer · •••• 0142'],
    );
  }
  await shop
    .collection('customers')
    .insertMany(Array.from({ length: 9 }, (_, i) => ({ ...base, name: 'Other ' + i, phone: '9990001111' })));
  assert.match(
    (await call('', 'POST', { q: 'Customer', group: 'Customers' })).results[0].name,
    /^first Customer/,
  );
  const first = await call('', 'POST', { q: '9990001111' });
  const next = await call('', 'POST', { q: '9990001111', page: first.more[0] });
  assert.equal(new Set([...first.results, ...next.results].map((r) => r.hash)).size, 9);
  assert.equal((await call('', 'POST', { q: 'S-0042' })).results.length, 0);
  const result = await call('', 'POST', { q: 's-0042' }, { sales: 'yes' });
  assert.deepEqual(
    result.results.map((r) => r.kind),
    ['sales'],
  );
  assert.equal(
    (await call('/resolve', 'POST', { ref: result.results[0].hash }, { sales: 'yes' })).hash,
    result.results[0].hash,
  );
  const event = { hash: result.results[0].hash, eventId: '00000000-0000-4000-8000-000000000042' };
  await Promise.all([
    call('/history', 'POST', event, { sales: 'yes' }),
    call('/history', 'POST', event, { sales: 'yes' }),
  ]);
  assert.equal((await call('/history', 'GET', undefined, { sales: 'yes' })).events.length, 1);
  assert.equal((await call('/history', 'GET', undefined, { sales: 'yes' })).records.length, 1);
  assert.equal((await call('/history', 'GET')).events.length, 0);
  await call('/history', 'DELETE');
  await call('/history', 'POST', event, { sales: 'yes' });
  assert.equal((await call('/history', 'GET', undefined, { sales: 'yes' })).events.length, 0);
});
