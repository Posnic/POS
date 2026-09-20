'use strict';

// A real local database and the real HTTP/auth middleware: recovering must
// revoke sessions as well as JWTs, and concurrent use must spend a code once.
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const User = require('../../../src/models/user.model');
const codes = require('../../../src/utils/recovery-codes');
const service = require('../../../src/services/recovery.service');
const auth = require('../../../src/middleware/auth');
const { enableMultiTenant } = require('../../../src/db/tenant-context');
const { protect: csrfProtect } = require('../../../src/middleware/csrf');
const router = require('../../../src/routes/recovery.routes');
const { redact } = require('../../../src/utils/redact');

let mem, server, db, owner, batch;
const oldPassword = 'Owner-before-26';
const newPassword = 'Owner-after-26';
const envKeys = [
  'POSNIC_DESKTOP',
  'POSNIC_CLOUD',
  'POSNIC_KEY',
  'POSNIC_SYNC_PAIRED',
  'DEMO_MODE',
  'JWT_SECRET',
];
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
const input = (overrides = {}) => ({
  account: owner.email,
  recoveryCode: batch.codes[0],
  newPassword,
  confirmPassword: newPassword,
  ...overrides,
});
async function ask(path, { body, token, cookie, csrf } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-XSRF-TOKEN': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    body: await res.json(),
    headers: res.headers,
    cookie: res.headers.get('set-cookie')?.split(';')[0],
  };
}
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('offline-recovery-test'));
  db = mongoose.connection.db;
  BaseModel.database = db;
  const app = express();
  app.use(
    express.json(),
    cookieParser(),
    session({
      secret: 'synthetic-test-only-session-secret',
      resave: false,
      saveUninitialized: false,
    }),
    csrfProtect
  );
  app.use('/recovery', router);
  app.get('/heartbeat', auth.auth, (_req, res) => res.json({ ok: true }));
  app.get('/optional', auth.optionalProtect, (req, res) =>
    res.json({ authenticated: Boolean(req.user) })
  );
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ message: error.message })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
}, 60000);
beforeEach(async () => {
  envKeys.forEach((key) => delete process.env[key]);
  process.env.POSNIC_DESKTOP = '1';
  process.env.JWT_SECRET = 'synthetic-test-only-jwt-secret';
  enableMultiTenant(false);
  for (const name of ['users', 'rate_limits', 'audit_log', 'products'])
    await db.collection(name).deleteMany({});
  batch = codes.createBatch();
  owner = {
    _id: new ObjectId(),
    email: 'owner@example.test',
    username: 'owner',
    usertype: 'super_admin',
    activate: true,
    isActive: true,
    password: await bcrypt.hash(oldPassword, 4),
    localRecovery: batch.record,
    access: { products: { read: true } },
    userkey: 'old-email-reset-token',
  };
  await db.collection('users').insertOne(owner);
  await db.collection('products').insertOne({ name: 'حليب', quantity: 12 });
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  BaseModel.database = null;
  await mongoose.disconnect();
  if (mem) await mem.stop();
  enableMultiTenant(false);
  envKeys.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

test('128-bit codes are normalized, hashed, redacted, and hidden from normal user reads', async () => {
  expect(new Set(batch.codes).size).toBe(8);
  expect(batch.codes.every((code) => /^([A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code))).toBe(true);
  expect(codes.digest(batch.codes[0].toLowerCase().replaceAll('-', ' '))).toBe(
    batch.record.hashes[0]
  );
  expect(codes.normalize({ $ne: '' })).toBeNull();
  const raw = await db.collection('users').findOne({ _id: owner._id });
  expect(JSON.stringify(raw)).not.toContain(batch.codes[0]);
  expect((await User.findById(owner._id).lean()).localRecovery).toBeUndefined();
  expect(
    JSON.stringify(
      redact({
        recoveryCode: batch.codes[0],
        data: { recoveryCodes: batch.codes, localRecovery: batch.record },
      })
    )
  ).not.toContain(batch.record.hashes[0]);
});

test('reset works without email, consumes only its code, preserves shop data and records an audit', async () => {
  const result = await ask('/recovery/reset', { body: input() });
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const user = await db.collection('users').findOne({ _id: owner._id });
  expect(await bcrypt.compare(Buffer.from(newPassword).toString('base64'), user.password)).toBe(
    true
  );
  expect(await service.passwordMatches(oldPassword, user.password)).toBe(false);
  expect(await (await User.findById(owner._id)).correctPassword(newPassword, user.password)).toBe(
    true
  );
  expect(user.localRecovery.hashes).toEqual(batch.record.hashes.slice(1));
  expect(user.authVersion).toBe(1);
  expect(user.userkey).not.toBe(owner.userkey);
  expect(user.access).toEqual(owner.access);
  expect(await db.collection('products').findOne({ name: 'حليب' })).toMatchObject({ quantity: 12 });
  const audit = await db.collection('audit_log').findOne({ event: 'password_reset' });
  expect(audit).toMatchObject({
    target_user_id: String(owner._id),
    source: 'offline_recovery_code',
  });
  expect(JSON.stringify(audit)).not.toContain(batch.codes[0]);
  expect(JSON.stringify(audit)).not.toContain(newPassword);
  expect((await ask('/recovery/reset', { body: input() })).status).toBe(400);
});

test('pasting multiple codes refuses without spending any; one complete code still works', async () => {
  for (const recoveryCode of [
    batch.codes.slice(0, 2).join(' '),
    batch.codes.join('\n'),
    `POSNIC - OFFLINE RECOVERY CODES\nAccount: ${owner.email}\n\n${batch.codes.join('\n')}`,
  ]) {
    const result = await ask('/recovery/reset', { body: input({ recoveryCode }) });
    expect(result.status).toBe(400);
    const unchanged = await db.collection('users').findOne({ _id: owner._id });
    expect(unchanged.password).toBe(owner.password);
    expect(unchanged.localRecovery.hashes).toEqual(batch.record.hashes);
  }
  expect((await ask('/recovery/reset', { body: input() })).status).toBe(200);
  expect((await db.collection('users').findOne({ _id: owner._id })).localRecovery.hashes).toHaveLength(7);
});

test('two simultaneous attempts with one code cannot both reset the password', async () => {
  const results = await Promise.allSettled([
    service.reset(db, input()),
    service.reset(
      db,
      input({ newPassword: 'Different-new-26', confirmPassword: 'Different-new-26' })
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await db.collection('users').findOne({ _id: owner._id })).authVersion).toBe(1);
});

test('wrong, unknown, used and mismatched-account codes all refuse without changing credentials', async () => {
  for (const body of [
    input({ account: 'unknown@example.test' }),
    input({ recoveryCode: codes.createBatch().codes[0] }),
    input({ account: { $ne: '' } }),
    input({ recoveryCode: { $ne: '' } }),
  ]) {
    const result = await ask('/recovery/reset', { body });
    expect(result.status).toBe(400);
    expect(result.body.message).toBe(service.INVALID);
  }
  expect((await db.collection('users').findOne({ _id: owner._id })).password).toBe(owner.password);
});

test('invalid new passwords do not spend a code; Arabic passwords retain their characters', async () => {
  for (const value of ['short', ' leading-space', 'a'.repeat(21), '界'.repeat(20)]) {
    expect(
      (
        await ask('/recovery/reset', {
          body: input({ newPassword: value, confirmPassword: value }),
        })
      ).status
    ).toBe(400);
  }
  expect(
    (await ask('/recovery/reset', { body: input({ confirmPassword: 'does-not-match' }) })).status
  ).toBe(400);
  const password = 'كلمةمرورقوية12';
  expect(
    (
      await ask('/recovery/reset', {
        body: input({ newPassword: password, confirmPassword: password }),
      })
    ).status
  ).toBe(200);
  expect(
    await service.passwordMatches(
      password,
      (await db.collection('users').findOne({ _id: owner._id })).password
    )
  ).toBe(true);
});

test('previous sessions and JWTs are revoked, including a token from the same second', async () => {
  const oldToken = auth.signToken(String(owner._id));
  const sessionStart = await ask('/recovery/codes', { token: oldToken });
  expect(sessionStart.status).toBe(200);
  expect(sessionStart.cookie).toContain('connect.sid=');
  expect((await ask('/recovery/codes', { cookie: sessionStart.cookie })).status).toBe(200);
  await service.reset(db, input());
  // Timestamp equality deliberately exercises the gap in timestamp-only revocation.
  const jwt = require('jsonwebtoken');
  const sameSecondToken = jwt.sign(
    { id: String(owner._id), iat: Math.floor(Date.now() / 1000) },
    process.env.JWT_SECRET
  );
  expect((await ask('/recovery/codes', { cookie: sessionStart.cookie })).status).toBe(401);
  expect((await ask('/recovery/codes', { token: oldToken })).status).toBe(401);
  expect((await ask('/recovery/codes', { token: sameSecondToken })).status).toBe(401);
  expect((await ask('/heartbeat', { token: sameSecondToken })).status).toBe(401);
  expect((await ask('/optional', { cookie: sessionStart.cookie })).body.authenticated).toBe(false);
  const recovered = await User.findById(owner._id);
  const newToken = auth.signLegacyToken(recovered, { headers: {}, session: {} });
  const signedIn = await ask('/recovery/codes', { token: newToken });
  expect(signedIn.status).toBe(200);
  expect((await ask('/recovery/codes', { cookie: signedIn.cookie })).status).toBe(200);
  expect((await ask('/heartbeat', { token: newToken })).status).toBe(200);
});

test('only an authenticated owner with the current password can replace codes', async () => {
  expect((await ask('/recovery/codes', { body: { currentPassword: oldPassword } })).status).toBe(
    401
  );
  const token = auth.signToken(String(owner._id));
  expect((await ask('/recovery/codes', { body: { currentPassword: 'wrong' }, token })).status).toBe(
    403
  );
  const result = await ask('/recovery/codes', { body: { currentPassword: oldPassword }, token });
  expect(result.status).toBe(200);
  expect(result.body.data.recoveryCodes).toHaveLength(8);
  expect((await ask('/recovery/reset', { body: input() })).status).toBe(400);
  const state = await ask('/recovery/codes', { token });
  expect(state.body.data).toMatchObject({ eligible: true, remaining: 8 });
  expect(state.body.data.recoveryCodes).toBeUndefined();
  expect(state.body.data.hashes).toBeUndefined();
});

test('staff, inactive owners, Cloud and paired installations cannot reset through this route', async () => {
  const token = auth.signToken(String(owner._id));
  for (const patch of [
    { usertype: 'cashier' },
    { usertype: 'super_admin', activate: false },
    { activate: true, isActive: false },
  ]) {
    await db.collection('users').updateOne({ _id: owner._id }, { $set: patch });
    expect((await ask('/recovery/reset', { body: input() })).status).toBe(400);
    await expect(service.generate(db, owner._id, oldPassword)).rejects.toMatchObject({
      statusCode: 403,
    });
  }
  await db
    .collection('users')
    .updateOne(
      { _id: owner._id },
      { $set: { usertype: 'cashier', activate: true, isActive: true } }
    );
  expect((await ask('/recovery/codes', { token })).body.data).toEqual({ eligible: false });
  for (const mode of ['cloud', 'paired', 'multitenant']) {
    delete process.env.POSNIC_DESKTOP;
    process.env.POSNIC_CLOUD = mode === 'cloud' ? '1' : '0';
    process.env.POSNIC_SYNC_PAIRED = mode === 'paired' ? '1' : '0';
    enableMultiTenant(mode === 'multitenant');
    expect((await ask('/recovery/options')).body.data.offline).toBe(false);
    expect((await ask('/recovery/reset', { body: input() })).status).toBe(404);
  }
});

test('cookie-backed code replacement requires CSRF proof', async () => {
  const signedIn = await ask('/recovery/codes', { token: auth.signToken(String(owner._id)) });
  const options = await ask('/recovery/options', { cookie: signedIn.cookie });
  expect(
    (
      await ask('/recovery/codes', {
        cookie: signedIn.cookie,
        body: { currentPassword: oldPassword },
      })
    ).status
  ).toBe(403);
  expect(
    (
      await ask('/recovery/codes', {
        cookie: signedIn.cookie,
        csrf: options.headers.get('x-csrf-token'),
        body: { currentPassword: oldPassword },
      })
    ).status
  ).toBe(200);
});

test('failed recovery guesses are limited without changing the account', async () => {
  for (let i = 0; i < 10; i++)
    expect((await ask('/recovery/reset', { body: input({ recoveryCode: 'bad' }) })).status).toBe(
      400
    );
  expect((await ask('/recovery/reset', { body: input() })).status).toBe(429);
  expect((await db.collection('users').findOne({ _id: owner._id })).password).toBe(owner.password);
});
