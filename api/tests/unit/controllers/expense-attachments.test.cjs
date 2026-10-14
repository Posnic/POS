'use strict';
require.cache[require.resolve('../../../src/services/base.service')] = { exports: {} };
const { test, before, after, beforeEach } = require('node:test');
const { expect } = require('expect');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { handler, MAX_FILE } = require('../../../src/controllers/expense-attachments.controller');

let server, client, db, app, entry, httpServer, origin;
function request() {
  const methods = {};
  for (const method of ['get', 'post', 'delete']) methods[method] = (path) => {
    const headers = {}; let body;
    const pending = {
      set(key, value) { headers[key] = value; return pending; },
      attach(field, bytes, name) {
        body = new FormData(); body.append(field, new Blob([bytes]), name); return pending;
      },
      then(resolve, reject) {
        return fetch(origin + path, { method: method.toUpperCase(), headers, body }).then(async response => ({
          status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers),
        })).then(resolve, reject);
      },
    };
    return pending;
  };
  return methods;
}
const license = new ObjectId(), branch = new ObjectId();
const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
const pdf = Buffer.from('%PDF-1.4\nExample receipt\n%%EOF');
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri()); db = client.db('expense_attachment_test');
  app = express();
  app.use((req, res, next) => {
    req.db = db;
    req.user = { _id: 'reviewer', usertype: req.headers['x-no-access'] ? 'staff' : 'admin', access: { expense: { read: false, write: false } } };
    req.tenantContext = { licenseId: license, branchId: req.headers['x-other-branch'] ? new ObjectId() : branch };
    next();
  });
  app.get('/:id/attachments', handler('list'));
  app.get('/:id/attachments/:attId', handler('read'));
  app.post('/:id/attachments', handler('add'));
  app.delete('/:id/attachments/:attId', handler('remove'));
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  await new Promise(resolve => { httpServer = app.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + httpServer.address().port;
});
beforeEach(async () => {
  await db.collection('expenses').deleteMany({});
  entry = { _id: new ObjectId(), license, branch_id: branch, amount: 150, type: 'debit', description: 'Travel', updated_date: new Date(0) };
  await db.collection('expenses').insertOne(entry);
});
after(async () => { if (httpServer) await new Promise(resolve => httpServer.close(resolve)); await client?.close(); await server?.stop(); });
const url = () => '/' + entry._id + '/attachments';
const attach = (buffer = png, name = 'receipt.png') => request(app).post(url()).attach('file', buffer, name);

test('legacy entry has no attachments; image and PDF persist, list hides bytes, read returns exact bytes', async () => {
  expect((await request(app).get(url())).body.data).toEqual([]);
  const uploaded = await attach(); expect(uploaded.status).toBe(200);
  expect(uploaded.body.data.type).toBe('image/png');
  expect(uploaded.body.data.content).toBeUndefined();
  expect((await attach(pdf, 'bill.pdf')).status).toBe(200);
  const list = (await request(app).get(url())).body.data;
  expect(list).toHaveLength(2); expect(list[0].content).toBeUndefined();
  const read = await request(app).get(url() + '/' + list[0].id);
  expect(Buffer.from(read.body.data.content, 'base64')).toEqual(png);
  expect(read.headers['cache-control']).toBe('no-store');
  const stored = await db.collection('expenses').findOne({ _id: entry._id });
  expect(stored.updated_date.getTime()).toBeGreaterThan(0);
  expect(stored.amount).toBe(150);
});
test('same-file concurrent retries create exactly one attachment', async () => {
  const results = await Promise.all([attach(), attach()]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect((await request(app).get(url())).body.data).toHaveLength(1);
});
test('rejects executable content disguised as PNG and files over the limit', async () => {
  expect((await attach(Buffer.from('<html>unsafe</html>'), 'fake.png')).status).toBe(400);
  expect((await attach(Buffer.alloc(MAX_FILE + 1), 'large.pdf')).status).toBe(400);
  expect((await request(app).get(url())).body.data).toEqual([]);
});
test('permission and branch checks happen before writing/reading/removing files', async () => {
  const saved = (await attach()).body.data;
  for (const suffix of ['', '/' + saved.id]) {
    expect((await request(app).get(url() + suffix).set('x-other-branch', 'yes')).status).toBe(404);
    expect((await request(app).get(url() + suffix).set('x-no-access', 'yes')).status).toBe(403);
  }
  expect((await request(app).post(url()).set('x-other-branch', 'yes').attach('file', png, 'x.png')).status).toBe(404);
  expect((await request(app).delete(url() + '/' + saved.id).set('x-no-access', 'yes')).status).toBe(403);
  expect((await request(app).get(url())).body.data).toHaveLength(1);
});
test('removal is retry safe and removes access to content', async () => {
  const saved = (await attach()).body.data;
  expect((await request(app).delete(url() + '/' + saved.id)).status).toBe(200);
  expect((await request(app).delete(url() + '/' + saved.id)).status).toBe(200);
  expect((await request(app).get(url() + '/' + saved.id)).status).toBe(404);
});
test('enforces five-file limit atomically and rejects a sixth', async () => {
  for (let i = 0; i < 5; i++) expect((await attach(Buffer.concat([png, Buffer.from(String(i))]))).status).toBe(200);
  expect((await attach(pdf, 'extra.pdf')).status).toBe(409);
});
test('enforces total byte limit in the database, not just the client', async () => {
  await db.collection('expenses').updateOne({ _id: entry._id }, { $set: { supporting_documents: [{ id: 'old', size: 10 * 1024 * 1024 - 1 }] } });
  expect((await attach()).status).toBe(409);
});
test('deleted entries cannot receive or expose documents', async () => {
  await db.collection('expenses').updateOne({ _id: entry._id }, { $set: { is_deleted: true } });
  expect((await attach()).status).toBe(404);
  expect((await request(app).get(url())).status).toBe(404);
});
