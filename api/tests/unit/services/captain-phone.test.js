'use strict';
jest.mock('../../../src/services/messaging.service', () => ({ sendSms: jest.fn() }));
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-phone');
const sender = require('../../../src/services/messaging.service');
let server, db, user, branch, license;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-phone'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  user = new ObjectId();
  branch = new ObjectId();
  license = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license });
  await db
    .collection('users')
    .insertOne({ _id: user, license, activate: true, phone: '+919000000000' });
  sender.sendSms.mockReset().mockResolvedValue({ ok: true });
});
const req = (body) => ({
  db,
  tenantContext: { branchId: branch, licenseId: license },
  user: { _id: user },
  body,
});
async function begin() {
  const result = await service.start(req({ phone: '+91 90000 00001' }));
  const code = sender.sendSms.mock.calls[0][2].match(/\b\d{6}\b/)[0];
  return { ...result, code };
}
test('phone stays unchanged until verification and successful retries are idempotent', async () => {
  const challenge = await begin();
  expect(challenge.challenge).toBeTruthy();
  expect((await db.collection('users').findOne({ _id: user })).phone).toBe('+919000000000');
  const stored = await db.collection('captain_phone_verifications').findOne({});
  expect(stored.codeHash).not.toBe(challenge.code);
  expect(stored.code).toBeUndefined();
  expect(await service.verify(req(challenge))).toEqual({ saved: true, phone: '+919000000001' });
  expect(await service.verify(req(challenge))).toEqual({ saved: true, phone: '+919000000001' });
  expect((await db.collection('captain_phone_verifications').findOne({})).codeHash).toBeUndefined();
});
test('resends are limited and five failed attempts lock verification', async () => {
  const challenge = await begin();
  await expect(service.start(req({ phone: '+919000000002' }))).rejects.toMatchObject({
    status: 429,
  });
  const wrong = challenge.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await expect(service.verify(req({ ...challenge, code: wrong }))).rejects.toMatchObject({
      status: 400,
    });
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
  expect(sender.sendSms).toHaveBeenCalledTimes(1);
});
test('expired codes and another user cannot change contact details', async () => {
  const challenge = await begin();
  const second = new ObjectId();
  await db.collection('users').insertOne({ _id: second, license, activate: true });
  await expect(service.verify({ ...req(challenge), user: { _id: second } })).rejects.toMatchObject({
    status: 409,
  });
  await db
    .collection('captain_phone_verifications')
    .updateOne({}, { $set: { expiresAt: new Date(0) } });
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
});
test('failed delivery never leaves a usable code or changes the phone', async () => {
  sender.sendSms.mockResolvedValue({ ok: false });
  await expect(service.start(req({ phone: '+919000000001' }))).rejects.toMatchObject({
    status: 503,
  });
  const stored = await db.collection('captain_phone_verifications').findOne({});
  expect(stored.state).toBe('failed');
  expect(stored.codeHash).toBeUndefined();
  expect((await db.collection('users').findOne({ _id: user })).phone).toBe('+919000000000');
});
test('retry recovers a confirmed user update when the verification receipt was interrupted', async () => {
  const challenge = await begin();
  await db.collection('captain_phone_verifications').updateOne({}, { $set: { state: 'applying' } });
  await db
    .collection('users')
    .updateOne({ _id: user }, { $set: { phone: '+919000000001', phone_verified_at: new Date() } });
  expect(await service.verify(req(challenge))).toEqual({ saved: true, phone: '+919000000001' });
  expect((await db.collection('captain_phone_verifications').findOne({})).state).toBe('verified');
});
