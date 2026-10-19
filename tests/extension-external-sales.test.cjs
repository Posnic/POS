'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const api = createRequire(require('node:path').resolve(__dirname, '../api/package.json'));
const { MongoMemoryServer } = api('mongodb-memory-server');
const { MongoClient, ObjectId } = api('mongodb');
const { writerAllowed, validate, postExternalSale } = require('../api/src/services/extension-external-sales');
const license = new ObjectId('a'.repeat(24)), branchId = new ObjectId('b'.repeat(24)), userId = 'c'.repeat(24), productId = 'd'.repeat(24);
const descriptor = { id: 'example.marketplace', packageDigest: 'f'.repeat(64), requiredCapabilities: ['sales.external-posting.v1'] };
const approval = { license, branch_id: branchId, extensionId: descriptor.id, packageDigest: descriptor.packageDigest,
  connectorReaderId: 'e'.repeat(24), externalSales: { enabled: true, writerId: userId, activatedAt: '2020-01-01T00:00:00Z', currency: 'HKD', provider: 'Example' } };
const event = () => ({ eventId: '1'.repeat(64), sourceReference: 'ORDER-1', provider: 'Example', currency: 'HKD',
  recognizedAt: '2020-01-02T01:00:00.000Z', totalMinor: 1900,
  lines: [{ productId, quantity: 2, unitPriceMinor: 1000, discountMinor: 100, taxMinor: 0, totalMinor: 1900 }] });

test('posting credential requires a dedicated grant, exact endpoint and active sales permission', () => {
  const req = { isApiKey: true, method: 'POST', path: '/external-sales', user: { _id: userId, activate: true,
    apiEndpointScope: { kind: 'extension-sales-writer', extensionId: descriptor.id },
    access: { extensions: { read: true }, sales: { write: true } } } };
  assert.equal(writerAllowed(req, approval), true);
  for (const change of [{ method: 'GET' }, { path: '/commands' }, { isApiKey: false }, { user: { ...req.user, active: false } }])
    assert.equal(writerAllowed({ ...req, ...change }, approval), false);
  assert.equal(writerAllowed(req, { ...approval, connectorReaderId: userId }), false);
  assert.equal(writerAllowed({ ...req, user: { ...req.user, apiEndpointScope: undefined } }, approval), false);
  assert.equal(writerAllowed(req, { ...approval, externalSales: { ...approval.externalSales, enabled: false } }), false);
});
test('external event input rejects arbitrary fields, tax assumptions, invalid totals and dates', () => {
  assert.deepEqual(validate(event()), event());
  for (const data of [{ ...event(), license: 'other' }, { ...event(), totalMinor: 2000 },
    { ...event(), recognizedAt: '2026-02-30T01:00:00.000Z' }, { ...event(), lines: [{ ...event().lines[0], taxMinor: 100 }] },
    { ...event(), lines: [{ ...event().lines[0], quantity: Number.MAX_SAFE_INTEGER }] }])
    assert.throws(() => validate(data), /external_sale/);
});
test('real database posting is atomic and scoped; retries preserve cost and never change stock or till cash', async () => {
  let server, client, http;
  try {
    server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri());
    const db = client.db('external_sales_test');
    await db.collection('branches').insertOne({ _id: branchId, license, currency: 'HKD' });
    await db.collection('items').insertOne({ _id: new ObjectId(productId), license, branch_id: branchId,
      name: 'Test item', unit: 'unit', company_price: 4, available_quantity: 10, item_status: 'active' });
    const args = { db, scope: { license, branchId }, descriptor, actor: { userId }, approval, input: event(), now: new Date('2026-10-20T02:00:00Z') };
    const results = await Promise.all(Array.from({ length: 12 }, () => postExternalSale(args)));
    assert.equal(new Set(results.map(r => r.saleId)).size, 1);
    assert.equal(await db.collection('sales').countDocuments(), 1);
    const sale = await db.collection('sales').findOne({});
    const Sale = require('../api/src/models/sale.model');
    const hydrated = Sale.hydrate(sale);
    assert.equal(hydrated.external_sale.eventId, event().eventId);
    await assert.rejects(require('../api/src/services/captain-payment-guard').mutable(db, hydrated), /marketplace/i);
    hydrated.total = 1;
    await assert.rejects(hydrated.save({ validateBeforeSave: false }), /marketplace/i);
    assert.equal(sale.items_total, 19); assert.equal(sale.total_companyprice, 8);
    assert.equal(sale.channel, 'marketplace'); assert.equal(sale.payment_mode, 'Marketplace');
    assert.equal(sale.cashregister_id, ''); assert.equal(sale.external_sale.settlementStatus, 'unreconciled');
    const BaseModel = require('../api/src/models/base.model');
    BaseModel.database = db; BaseModel.mongoClient = client; BaseModel.license = license; BaseModel.currentTimeZone = 'Asia/Hong_Kong';
    const commission = await require('../api/src/repositories/sale.repository').commissionReport({
      starting_date: '2020-01-02', ending_date: '2020-01-02', branchid: [String(branchId)] });
    assert.equal(commission.status, true);
    assert.equal(commission.data.rows.length, 1);
    assert.equal(commission.data.rows[0].sales, 19);
    assert.equal(commission.data.rows[0].feesPending, 1);
    assert.equal(commission.data.totals.net, null);
    assert.equal((await db.collection('items').findOne({})).available_quantity, 10);
    await db.collection('items').updateOne({}, { $set: { company_price: 8 } });
    assert.deepEqual(await postExternalSale(args), results[0]);
    assert.equal((await db.collection('sales').findOne({})).total_companyprice, 8);
    await db.collection('extension_installations').insertOne({ ...approval, enabled: true });
    const express = api('express');
    const routes = require('../api/src/routes/extensions.routes');
    const app = express(); app.use(express.json());
    app.use('/extensions/v1', routes.createRouter({ registry: { get: () => descriptor }, authenticate: (req, res, next) => {
      req.db = db; req.isApiKey = true;
      req.user = { _id: userId, activate: true, apiEndpointScope: {kind:'extension-sales-writer',extensionId:descriptor.id}, access: { extensions: { read: true, write: true }, sales: { write: true } } };
      req.tenantContext = { licenseId: String(license), branchId: String(branchId) };
      require('../api/src/middleware/api-key').enforceApiKeyAcl(req,res,next);
    } }));
    http = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${http.address().port}/extensions/v1/${descriptor.id}`;
    const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event()) };
    let response = await fetch(base + '/external-sales', request);
    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.equal((await fetch(base + '/commands', request)).status, 403);
    assert.equal((await fetch(base + '/connector-context?resource=state')).status, 403);
    await db.collection('extension_installations').updateOne({}, { $set: { 'externalSales.enabled': false } });
    assert.equal((await fetch(base + '/external-sales', request)).status, 403);
    await assert.rejects(postExternalSale({ ...args, input: { ...event(), sourceReference: 'changed' } }), /conflict/);
    await assert.rejects(postExternalSale({ ...args, scope: { license, branchId: new ObjectId() } }), /not_approved/);
    await assert.rejects(postExternalSale({ ...args, input: { ...event(), recognizedAt: '2019-12-31T00:00:00.000Z' } }), /outside_grant/);
    await assert.rejects(postExternalSale({ ...args, input: { ...event(), provider: 'Other' } }), /outside_grant/);
    await db.collection('items').updateOne({}, { $unset: { company_price: '' } });
    await assert.rejects(postExternalSale({ ...args, input: { ...event(), eventId: '2'.repeat(64) } }), /cost_required/);
    assert.equal(await db.collection('sales').countDocuments(), 1);
  } finally { await new Promise(resolve => http?.listening ? http.close(resolve) : resolve()); await client?.close(); await server?.stop(); }
});

