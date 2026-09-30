'use strict';
jest.mock('../../../src/utils/email', () => ({
  resolveShopTransport: jest.fn(),
  sendMail: jest.fn(),
}));
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-email');
const sender = require('../../../src/utils/email');
let server, db, user, branch, license;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-email'));
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
  await db.collection('users').insertOne({
    _id: user,
    license,
    activate: true,
    email: 'old@example.test',
    password: await require('bcryptjs').hash('staff-password', 4),
  });
  sender.sendMail.mockReset().mockResolvedValue({ messageId: 'test' });
  sender.resolveShopTransport.mockReturnValue({
    from: 'shop@example.test',
    transporter: { sendMail: sender.sendMail },
  });
  await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
});
const req = (body) => ({
  db,
  tenantContext: { branchId: branch, licenseId: license },
  user: { _id: user },
  body: { currentPassword: 'staff-password', ...body },
});
async function begin() {
  const result = await service.start(req({ email: 'NEW@EXAMPLE.TEST' }));
  const code = sender.sendMail.mock.calls[0][0].text.match(/\b\d{6}\b/)[0];
  return { ...result, code };
}
test('email stays unchanged until verification and successful retries are idempotent', async () => {
  const challenge = await begin();
  expect(challenge.challenge).toBeTruthy();
  expect((await db.collection('users').findOne({ _id: user })).email).toBe('old@example.test');
  const stored = await db.collection('captain_email_verifications').findOne({});
  expect(stored.codeHash).not.toBe(challenge.code);
  expect(stored.code).toBeUndefined();
  expect(await service.verify(req(challenge))).toEqual({ saved: true, email: 'new@example.test' });
  expect(await service.verify(req(challenge))).toEqual({ saved: true, email: 'new@example.test' });
  expect((await db.collection('captain_email_verifications').findOne({})).codeHash).toBeUndefined();
});
test('resends are limited and five failed attempts lock verification', async () => {
  const challenge = await begin();
  await expect(service.start(req({ email: 'other@example.test' }))).rejects.toMatchObject({
    status: 429,
  });
  const wrong = challenge.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await expect(service.verify(req({ ...challenge, code: wrong }))).rejects.toMatchObject({
      status: 400,
    });
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
  expect(sender.sendMail).toHaveBeenCalledTimes(1);
});
test('expired codes and another user cannot change contact details', async () => {
  const challenge = await begin();
  const second = new ObjectId();
  await db.collection('users').insertOne({ _id: second, license, activate: true });
  await expect(service.verify({ ...req(challenge), user: { _id: second } })).rejects.toMatchObject({
    status: 409,
  });
  await db
    .collection('captain_email_verifications')
    .updateOne({}, { $set: { expiresAt: new Date(0) } });
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
});
test('failed delivery never leaves a usable code or changes the email', async () => {
  sender.sendMail.mockRejectedValue(new Error('delivery failed'));
  await expect(service.start(req({ email: 'new@example.test' }))).rejects.toMatchObject({
    status: 503,
  });
  const stored = await db.collection('captain_email_verifications').findOne({});
  expect(stored.state).toBe('failed');
  expect(stored.codeHash).toBeUndefined();
  expect((await db.collection('users').findOne({ _id: user })).email).toBe('old@example.test');
});
test('retry recovers a confirmed user update when the verification receipt was interrupted', async () => {
  const challenge = await begin();
  await db.collection('captain_email_verifications').updateOne({}, { $set: { state: 'applying' } });
  await db
    .collection('users')
    .updateOne(
      { _id: user },
      { $set: { email: 'new@example.test', email_verified_at: new Date() } }
    );
  expect(await service.verify(req(challenge))).toEqual({ saved: true, email: 'new@example.test' });
  expect((await db.collection('captain_email_verifications').findOne({})).state).toBe('verified');
});

test('simultaneous resend requests send only one code', async () => {
  const results = await Promise.allSettled([
    service.start(req({ email: 'new@example.test' })),
    service.start(req({ email: 'other@example.test' })),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(sender.sendMail).toHaveBeenCalledTimes(1);
});

test('a delayed verification cannot overwrite a superseding email challenge', async () => {
  const original = await begin();
  let release, arrived;
  const waiting = new Promise((resolve) => {
    arrived = resolve;
  });
  const users = db.collection('users');
  const delayed = req(original);
  delayed.db = {
    collection(name) {
      if (name !== 'users') return db.collection(name);
      return {
        findOne: (...args) => users.findOne(...args),
        updateOne: async (...args) => {
          arrived();
          await new Promise((resolve) => {
            release = resolve;
          });
          return users.updateOne(...args);
        },
      };
    },
  };
  const outcome = service.verify(delayed).catch((error) => error);
  await waiting;
  await db
    .collection('captain_email_verifications')
    .updateOne({}, { $set: { expiresAt: new Date(0), nextSendAt: new Date(0) } });
  const replacement = await service.start(req({ email: 'other@example.test' }));
  release();
  expect(await outcome).toMatchObject({ status: 409 });
  expect((await users.findOne({ _id: user })).email).toBe('old@example.test');
  const code = sender.sendMail.mock.calls[1][0].text.match(/\b\d{6}\b/)[0];
  expect(await service.verify(req({ ...replacement, code }))).toEqual({
    saved: true,
    email: 'other@example.test',
  });
});

test('missing or incorrect password cannot send a code or reserve a challenge', async () => {
  for (const currentPassword of [undefined, 'wrong']) {
    await expect(
      service.start(req({ email: 'new@example.test', currentPassword }))
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(sender.sendMail).not.toHaveBeenCalled();
  expect(await db.collection('captain_email_verifications').countDocuments()).toBe(0);
});

test('email claimed after a code was sent cannot replace another account address', async () => {
  const challenge = await begin();
  await db.collection('users').insertOne({ _id: new ObjectId(), email: 'new@example.test' });
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('users').findOne({ _id: user })).email).toBe('old@example.test');
});

test('console transport cannot pretend a verification email was delivered', async () => {
  sender.resolveShopTransport.mockReturnValue({
    from: 'shop@example.test',
    transporter: { options: { jsonTransport: true }, sendMail: sender.sendMail },
  });
  await expect(service.start(req({ email: 'new@example.test' }))).rejects.toMatchObject({
    status: 503,
  });
  expect(sender.sendMail).not.toHaveBeenCalled();
});

test('verified email invalidates both reset-link formats atomically and retry does not rotate again', async () => {
  await db
    .collection('users')
    .updateOne(
      { _id: user },
      {
        $set: {
          userkey: 'old-reset-link',
          expire_date: new Date(Date.now() + 60000),
          passwordResetToken: 'old-token',
          passwordResetExpires: new Date(Date.now() + 60000),
        },
      }
    );
  const challenge = await begin();
  await service.verify(req(challenge));
  const changed = await db.collection('users').findOne({ _id: user });
  expect(changed.userkey).not.toBe('old-reset-link');
  expect(changed.userkey).toMatch(/^[a-f0-9]{64}$/);
  expect(changed.expire_date).toBeUndefined();
  expect(changed.passwordResetToken).toBeUndefined();
  expect(changed.passwordResetExpires).toBeUndefined();
  await service.verify(req(challenge));
  expect((await db.collection('users').findOne({ _id: user })).userkey).toBe(changed.userkey);
});

test('password change invalidates an outstanding email verification', async () => {
  const challenge = await begin();
  await db
    .collection('users')
    .updateOne(
      { _id: user },
      { $set: { password: await require('bcryptjs').hash('replacement-password', 4) } }
    );
  await expect(service.verify(req(challenge))).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('users').findOne({ _id: user })).email).toBe('old@example.test');
});

test('password change racing the final email write prevents that write', async () => {
  const challenge = await begin();
  const users = db.collection('users');
  let reached, release;
  const ready = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const request = req(challenge);
  request.db = {
    collection(name) {
      if (name !== 'users') return db.collection(name);
      return {
        findOne: (...args) => users.findOne(...args),
        updateOne: async (filter, update) => {
          if (update.$set?.email) {
            reached();
            await gate;
          }
          return users.updateOne(filter, update);
        },
      };
    },
  };
  const result = service.verify(request).catch((error) => error);
  await ready;
  await users.updateOne(
    { _id: user },
    { $set: { password: await require('bcryptjs').hash('replacement-password', 4) } }
  );
  release();
  expect(await result).toMatchObject({ status: 409 });
  expect((await users.findOne({ _id: user })).email).toBe('old@example.test');
});
