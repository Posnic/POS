'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
let controller;
const { passwordMatches } = require('../../../src/utils/password-match');
let memory, db;
// Allow real MongoDB I/O and production password hashing on busy CI hosts.
jest.setTimeout(30000);
const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('cloud-password-regression'));
  db = mongoose.connection.db;
  require('../../../src/models/base.model').database = db;
  controller = require('../../../src/controllers/users.controller');
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});
test('web reset advances the incremental user checkpoint, keeps shop data, and spends token once', async () => {
  const checkpoint = new Date(Date.now() - 10000);
  const id = new ObjectId();
  const user = {
    _id: id,
    email: 'reset@example.test',
    password: await bcrypt.hash('Before-123', 4),
    userkey: 'synthetic-test-reset',
    updated_date: checkpoint,
    expire_date: new Date(Date.now() + 60000),
    authVersion: 2,
  };
  await db.collection('users').insertOne(user);
  await db.collection('sales').insertOne({ _id: new ObjectId(), total: 105, marker: 'preserve' });
  const body = {
    forgot_key_value: user.userkey,
    update_new_password: 'After-123',
    retype_new_password: 'After-123',
  };
  const res = response();
  await controller.updateNewPassword({ body }, res);
  expect(res.json.mock.calls[0][0].type).toBe('success');
  // This is the gateway's timestamp predicate, against actual Mongo records.
  const changed = await db
    .collection('users')
    .find({ updated_date: { $gt: checkpoint } })
    .toArray();
  expect(changed).toHaveLength(1);
  expect(await passwordMatches('After-123', changed[0].password)).toBe(true);
  expect(await passwordMatches('Before-123', changed[0].password)).toBe(false);
  expect(changed[0].authVersion).toBe(3);
  expect(changed[0].expire_date).toBeUndefined();
  expect(await db.collection('sales').findOne({ marker: 'preserve' })).toMatchObject({
    total: 105,
  });
  const second = response();
  await controller.updateNewPassword({ body }, second);
  expect(second.json.mock.calls[0][0].type).not.toBe('success');
});

test('bound owner uses central credential and refuses local reset and model writes', async () => {
  const { runWithTenant } = require('../../../src/db/tenant-context');
  const policy = require('../../../src/services/cloud-owner');
  const User = require('../../../src/models/user.model');
  const id = new ObjectId(),
    websiteId = new ObjectId();
  const oldHash = await bcrypt.hash('Old-owner-7', 4);
  const account = {
    _id: websiteId,
    passwordHash: await bcrypt.hash('Website-owner-7', 4),
    authVersion: 15,
  };
  await db.collection('users').insertOne({
    _id: id,
    usertype: 'super_admin',
    email: 'cloud-owner@example.test',
    password: oldHash,
    authVersion: 2,
    userkey: 'owner-reset-fixture',
    expire_date: new Date(Date.now() + 60000),
  });
  const tenant = {
    db,
    connection: mongoose.connection,
    ownerIdentity: { userId: String(id), webUserId: String(websiteId), state: 'ready' },
    readOwnerCredential: async () => account,
  };
  await runWithTenant(tenant, async () => {
    const owner = await User.findById(id).select('+password');
    expect(await policy.verify(owner, 'Old-owner-7')).toBe(false);
    expect(await policy.verify(owner, 'Website-owner-7')).toBe(true);
    expect(owner.authVersion).toBe(15);
    expect(owner.isModified('password')).toBe(false);
    await expect(
      User.updateOne({ _id: id }, { $set: { password: 'forged' } })
    ).rejects.toMatchObject({ code: 'CLOUD_OWNER_BROWSER_REQUIRED' });
    await expect(User.deleteOne({ _id: id })).rejects.toMatchObject({
      code: 'CLOUD_OWNER_BROWSER_REQUIRED',
    });
    const res = response();
    await controller.updateNewPassword(
      {
        body: {
          forgot_key_value: 'owner-reset-fixture',
          update_new_password: 'Replacement-7',
          retype_new_password: 'Replacement-7',
        },
      },
      res
    );
    expect(res.json.mock.calls[0][0].type).not.toBe('success');
  });
  expect((await db.collection('users').findOne({ _id: id })).password).toBe(oldHash);
});

test('real HTTP owner login follows website changes and rejects stale sessions', async () => {
  const express = require('express'),
    session = require('express-session');
  const { runWithTenant } = require('../../../src/db/tenant-context');
  const id = new ObjectId(),
    websiteId = new ObjectId(),
    branchId = new ObjectId(),
    license = new ObjectId();
  const account = {
    _id: websiteId,
    passwordHash: await bcrypt.hash('Website-first-7', 4),
    authVersion: 30,
  };
  await db
    .collection('branches')
    .insertOne({ _id: branchId, license, branch_name: 'Isolated owner shop' });
  await db.collection('users').insertOne({
    _id: id,
    email: 'http-owner@example.test',
    username: 'http-owner@example.test',
    usertype: 'super_admin',
    activate: true,
    isActive: true,
    password: await bcrypt.hash('Stale-shop-7', 4),
    license,
    branch_access: [{ branch_id: branchId }],
    access: {},
  });
  const tenant = {
    db,
    connection: mongoose.connection,
    secrets: { JWT_SECRET: 'isolated-cloud-owner-http-test-secret' },
    ownerIdentity: { userId: String(id), webUserId: String(websiteId), state: 'ready' },
    readOwnerCredential: async () => account,
  };
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'isolated-session-fixture-only', resave: false, saveUninitialized: false })
  );
  app.use((req, res, next) => runWithTenant(tenant, next));
  app.use('/api/users', require('../../../src/routes/users.routes'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/users';
  const login = async (password) => {
    const res = await fetch(base + '/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'http-owner@example.test', password }),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    expect((await login('Stale-shop-7')).status).not.toBe(200);
    const initial = await login('Website-first-7');
    expect(initial.status).toBe(200);
    const token = initial.body.data.jwt_token;
    expect(token).toBeTruthy();
    account.passwordHash = await bcrypt.hash('Website-second-7', 4);
    account.authVersion++;
    expect((await login('Website-first-7')).status).not.toBe(200);
    expect((await login('Website-second-7')).status).toBe(200);
    const stale = await fetch(base + '/password-policy', {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(stale.status).toBe(401);
    const until = Date.now() + 5000;
    while ((await db.collection('staff_activities').countDocuments({ user_id: id })) < 2) {
      if (Date.now() > until) throw new Error('Login audit did not finish');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
