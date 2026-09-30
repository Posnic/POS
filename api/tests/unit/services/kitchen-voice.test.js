'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const voice = require('../../../src/services/kitchen-voice');
let memory, db, license, branch, saleId, user;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await memory?.stop();
});
beforeEach(async () => {
  for (const name of ['branches', 'sales', 'kitchen_voice_messages'])
    await db.collection(name).deleteMany({});
  license = new ObjectId();
  branch = new ObjectId();
  saleId = new ObjectId();
  user = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license });
  await db.collection('sales').insertOne({
    _id: saleId,
    license,
    branch_id: branch,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
});
const request = () => ({
  db,
  user: { _id: user, role: 'manager' },
  tenantContext: { licenseId: String(license), branchId: String(branch) },
  body: { id: randomUUID(), saleId: String(saleId), data: 'data:audio/webm;base64,YXVkaW8=' },
});
const read = (req) =>
  voice.read({ ...req, params: { saleId: req.body.saleId, voiceId: req.body.id } });
test('only queued recordings appear; a retry keeps one immutable order attachment', async () => {
  const req = request(),
    attachment = await voice.prepare(req);
  await expect(read(req)).rejects.toMatchObject({ status: 404 });
  expect((await voice.prepare(req)).queued).toBe(false);
  await voice.markQueued(attachment);
  expect((await voice.prepare(req)).queued).toBe(true);
  expect(await db.collection('kitchen_voice_messages').countDocuments()).toBe(1);
  expect(await read(req)).toEqual({ data: req.body.data });
  const tickets = [{ saleId: String(saleId) }];
  await voice.listForTickets(req, { license, branchId: branch }, tickets);
  expect(tickets[0].voiceNotes).toHaveLength(1);
  expect(tickets[0].voiceNotes[0].data).toBeUndefined();
  await expect(
    voice.prepare({ ...req, body: { ...req.body, data: 'data:audio/webm;base64,Yg==' } })
  ).rejects.toMatchObject({ status: 409 });
  const indexes = await db.collection('kitchen_voice_messages').indexes();
  expect(indexes.some((i) => i.expireAfterSeconds === 0)).toBe(true);
});
test('another tenant, branch or user cannot attach or read a recording outside their order scope', async () => {
  const req = request();
  await voice.markQueued(await voice.prepare(req));
  const foreign = new ObjectId();
  await db.collection('branches').insertOne({ _id: foreign, license });
  const wrongBranch = {
    ...req,
    tenantContext: { ...req.tenantContext, branchId: String(foreign) },
  };
  await expect(read(wrongBranch)).rejects.toMatchObject({ status: 404 });
  await expect(voice.prepare(wrongBranch)).rejects.toMatchObject({ status: 404 });
  await expect(
    voice.prepare({ ...req, user: { _id: new ObjectId(), role: 'manager' } })
  ).rejects.toMatchObject({ status: 409 });
  await expect(read({ ...req, user: { _id: user, role: 'cashier' } })).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    read({ ...req, tenantContext: { ...req.tenantContext, licenseId: String(new ObjectId()) } })
  ).rejects.toMatchObject({ status: 403 });
});
test('expired recordings and closed orders cannot replay; invalid audio never persists', async () => {
  const req = request();
  await voice.markQueued(await voice.prepare(req));
  await db
    .collection('kitchen_voice_messages')
    .updateOne({ _id: req.body.id }, { $set: { expiresAt: new Date(0) } });
  await expect(read(req)).rejects.toMatchObject({ status: 404 });
  await expect(
    voice.prepare({ ...request(), body: { ...request().body, data: 'data:text/html;base64,YQ==' } })
  ).rejects.toMatchObject({ status: 400 });
  await db.collection('sales').updateOne({ _id: saleId }, { $set: { kitchen_closed: true } });
  await expect(voice.prepare(request())).rejects.toMatchObject({ status: 404 });
  expect(await voice.prepare({ ...request(), body: { data: 'general' } })).toBeNull();
});
test('concurrent identical uploads reserve one recording', async () => {
  const req = request();
  const results = await Promise.all([voice.prepare(req), voice.prepare(req), voice.prepare(req)]);
  expect(results.map((r) => r.id)).toEqual([req.body.id, req.body.id, req.body.id]);
  expect(await db.collection('kitchen_voice_messages').countDocuments()).toBe(1);
});

test('an invalid talk session cannot consume order recording storage', async () => {
  await expect(
    voice.prepare(request(), async () => {
      throw Error('Session expired');
    })
  ).rejects.toThrow('Session expired');
  expect(await db.collection('kitchen_voice_messages').countDocuments()).toBe(0);
});
