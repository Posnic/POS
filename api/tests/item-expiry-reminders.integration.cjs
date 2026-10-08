'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const service = require('../src/services/item-expiry-reminders');
let server, client, db;
before(async () => { server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri()); db = client.db('expiry_reminders'); });
after(async () => { await client?.close(); await server?.stop(); });
async function fixture() {
  const branchId = new ObjectId(), license = new ObjectId();
  await db.collection('branches').insertOne({ _id: branchId, license, time_zone: 'Europe/London' });
  return { db, user: { usertype: 'admin' }, tenantContext: { branchId, licenseId: license }, body: {}, query: {} };
}
test('off by default, explicit opt-in survives subsequent reads', async () => {
  const req = await fixture();
  assert.deepEqual(await service.read(req), { enabled: false, days: 7 });
  assert.equal((await service.list(req)).total, 0);
  req.body = { enabled: true, days: 14 }; await service.save(req);
  assert.deepEqual(await service.read(req), req.body);
});
test('permissions, branch access and invalid settings fail closed', async () => {
  const req = await fixture(); req.user = { usertype: 'staff', access: { item: { read: true } } };
  await assert.rejects(service.save(req), { status: 403 });
  req.user = { usertype: 'staff' }; await assert.rejects(service.list(req), { status: 403 });
  req.user = { usertype: 'admin' };
  for (const days of [-1, 366, 0.5, '7', null]) { req.body = { enabled: true, days }; await assert.rejects(service.save(req), { status: 422 }); }
  req.tenantContext.licenseId = new ObjectId(); await assert.rejects(service.read(req), { status: 403 });
});
test('shop date and DST use calendar days', () => {
  assert.deepEqual(service.windowFor({ time_zone: 'Europe/London' }, 7, new Date('2026-10-24T23:30:00Z')), { today: '2026-10-25', through: '2026-11-01', timezone: 'Europe/London' });
  assert.equal(service.windowFor({ time_zone: 'bad' }, 0, new Date('2026-10-08T23:30:00Z')).today, '2026-10-08');
});
test('only current shop stocked products in date window; invalid dates ignored; pagination stable', async () => {
  const req = await fixture(); req.body = { enabled: true, days: 7 }; await service.save(req);
  const base = { license: req.tenantContext.licenseId, branch_id: req.tenantContext.branchId, available_quantity: 2, items_expiry_date: '2026-10-10' };
  await db.collection('items').insertMany([
    ...Array.from({ length: 27 }, (_, i) => ({ ...base, name: 'Soon ' + i })),
    { ...base, name: 'Expired', items_expiry_date: '2026-10-07' },
    { ...base, name: 'Today', items_expiry_date: '2026-10-08' },
    { ...base, name: 'Boundary', items_expiry_date: '2026-10-15' },
    { ...base, name: 'Future', items_expiry_date: '2026-10-16' },
    { ...base, name: 'No date', items_expiry_date: '' },
    { ...base, name: 'Invalid', items_expiry_date: 'bad' },
    { ...base, name: 'Invalid calendar date', items_expiry_date: '2026-02-30' },
    { ...base, name: 'Unicode date', items_expiry_date: '\u65e5\u65e5\u65e5\u65e5' },
    { ...base, name: 'Sold out', available_quantity: 0 },
    { ...base, name: 'Other branch', branch_id: new ObjectId() },
    { ...base, name: 'Other tenant', license: new ObjectId() }
  ]);
  const now = new Date('2026-10-08T12:00:00Z'), first = await service.list(req, now);
  assert.equal(first.total, 30); assert.equal(first.rows.length, 25);
  assert.equal(first.rows[0].daysRemaining, -1); assert.equal(first.rows[1].daysRemaining, 0);
  req.query.page = 2; const next = await service.list(req, now);
  assert.equal(next.rows.length, 5); assert.equal(next.rows[4].daysRemaining, 7);
  assert.equal(new Set([...first.rows, ...next.rows].map(row => row.id)).size, 30);
  req.body.enabled = false; await service.save(req); assert.equal((await service.list(req, now)).total, 0);
});
