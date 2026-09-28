'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const {
  createBusinessAccess,
  opaque,
  proof,
  hash,
  capabilities,
} = require('../src/services/business-access');
let mongo, db, server, base, passwordHash;
const password = 'Business-test-only-passphrase';
before(async () => {
  const binary = process.env.MONGOMS_SYSTEM_BINARY;
  mongo = await MongoMemoryServer.create({ binary: binary ? { systemBinary: binary } : {} });
  process.env.MONGODB_URI = mongo.getUri('business_test');
  await mongoose.connect(process.env.MONGODB_URI);
  db = mongoose.connection.db;
  passwordHash = await bcrypt.hash(password, 4);
  const app = require('express')();
  app.set('trust proxy', 'loopback');
  app.use(require('express').json());
  app.use(
    // lgtm[js/missing-token-validation] Test-only session: csrf.protect below guards ambient login credentials;
    // Business /approve additionally checks its browser-bound nonce and exact Origin, exercised below.
    require('express-session')({
      secret: opaque(),
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true, httpOnly: true, sameSite: 'strict' },
    })
  );
  app.use(require('../src/middleware/csrf').protect);
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use('/api/business/v1', require('../src/routes/business-access.routes'));
  app.get(
    '/pos-only',
    require('express-rate-limit')({ windowMs: 60_000, limit: 50 }),
    require('../src/middleware/auth').protect,
    (_req, res) => res.json({ selling: true })
  );
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: 'unauthorized' })
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  await require('../src/models/base.model').mongoClient?.close();
  if (mongo) await mongo.stop();
});
async function fixture() {
  const license = new ObjectId(),
    branch = {
      _id: new ObjectId(),
      license,
      branch_name: 'Central',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
    };
  const user = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'manager',
    username: opaque(),
    password: passwordHash,
    authVersion: 1,
    branch_access: [{ branch_id: branch._id }],
    access: { dashboard: { read: true, financials: true }, item: { read: true } },
  };
  await db.collection('branches').insertOne(branch);
  await db.collection('users').insertOne(user);
  const access = createBusinessAccess(db),
    verifier = opaque();
  const request = await access.request({
    codeChallenge: proof(verifier),
    deviceName: 'Test phone',
  });
  return { license, branch, user, access, verifier, request: request.request };
}
const is = (code) => (error) => error.code === code;
async function approve(f) {
  return f.access.decide(f.request, 'allow', f.user.username, password);
}
async function grant(f) {
  await approve(f);
  return f.access.exchange(f.request, f.verifier);
}

test('PKCE exchange is one-use under concurrency, stores only token hashes, and cannot authorize POS', async () => {
  const f = await fixture();
  await assert.rejects(f.access.exchange(f.request, f.verifier), is('authorization_pending'));
  await approve(f);
  await assert.rejects(f.access.exchange(f.request, opaque()), is('request_expired'));
  const outcomes = await Promise.allSettled([
    f.access.exchange(f.request, f.verifier),
    f.access.exchange(f.request, f.verifier),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  const value = outcomes.find((r) => r.status === 'fulfilled').value;
  assert.match(value.token, /^pb1_[\w-]{43}$/);
  assert.equal(value.context.branches.length, 1);
  assert.ok(!JSON.stringify(value).includes('password'));
  const row = await db.collection('business_sessions').findOne({ tokenHash: hash(value.token) });
  assert.ok(row);
  assert.ok(!JSON.stringify(row).includes(value.token));
  const response = await fetch(base + '/pos-only', {
    headers: { authorization: 'Bearer ' + value.token },
  });
  assert.equal(response.status, 401);
});
test('current branch membership, permission removal, password generation and disabled account are enforced', async () => {
  const f = await fixture(),
    value = await grant(f);
  assert.ok((await f.access.context(value.token)).capabilities.includes('overview.read'));
  await db
    .collection('users')
    .updateOne(
      { _id: f.user._id },
      { $set: { access: { item: { read: true } }, branch_access: [] } }
    );
  const context = await f.access.context(value.token);
  assert.deepEqual(context.branches, []);
  assert.deepEqual(context.capabilities, ['stock.read', 'notifications.self.manage']);
  await db.collection('users').updateOne({ _id: f.user._id }, { $inc: { authVersion: 1 } });
  await assert.rejects(f.access.context(value.token), is('session_revoked'));
  const disabled = await fixture(),
    second = await grant(disabled);
  await db.collection('users').updateOne({ _id: disabled.user._id }, { $set: { activate: false } });
  await assert.rejects(disabled.access.context(second.token), is('session_revoked'));
});
test('branch IDs cannot escape the license and manager role alone grants no financial data', async () => {
  const f = await fixture(),
    foreign = await fixture();
  await db
    .collection('users')
    .updateOne(
      { _id: f.user._id },
      { $set: { branch_access: [{ branch_id: foreign.branch._id }] } }
    );
  await assert.rejects(approve(f), is('access_denied'));
  assert.deepEqual(capabilities({ usertype: 'manager' }), ['notifications.self.manage']);
});
test('denied, expired and permission-revoked consent cannot be exchanged', async () => {
  const f = await fixture();
  await f.access.decide(f.request, 'deny');
  await assert.rejects(f.access.exchange(f.request, f.verifier), is('access_denied'));
  const expired = await fixture();
  await db
    .collection('business_authorizations')
    .updateOne({ _id: hash(expired.request) }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(approve(expired), is('request_expired'));
  const revoked = await fixture();
  await approve(revoked);
  await db.collection('users').updateOne({ _id: revoked.user._id }, { $inc: { authVersion: 1 } });
  await assert.rejects(
    revoked.access.exchange(revoked.request, revoked.verifier),
    is('session_revoked')
  );
});
test('rotation has one winner, revokes old tokens, preserves absolute expiry and scopes device revocation', async () => {
  const f = await fixture(),
    value = await grant(f);
  const rotations = await Promise.allSettled([
    f.access.rotate(value.token),
    f.access.rotate(value.token),
  ]);
  assert.equal(rotations.filter((r) => r.status === 'fulfilled').length, 1);
  const rotated = rotations.find((r) => r.status === 'fulfilled').value;
  assert.equal(rotated.expiresAt, value.expiresAt);
  await assert.rejects(f.access.context(value.token), is('sign_in_required'));
  const other = await fixture(),
    otherGrant = await grant(other);
  const [device] = await other.access.listSessions(otherGrant.token);
  await f.access.revoke(rotated.token, device.id);
  assert.ok(await other.access.context(otherGrant.token));
  await f.access.revoke(rotated.token);
  await assert.rejects(f.access.context(rotated.token), is('sign_in_required'));
});
test('browser approval requires HTTPS, same-origin and browser-bound consent before a password is checked', async () => {
  const f = await fixture();
  const origin = base.replace('http:', 'https:');
  const common = { 'x-forwarded-proto': 'https' };
  assert.equal((await fetch(base + '/api/business/v1/discovery')).status, 426);
  const discovery = await (
    await fetch(base + '/api/business/v1/discovery', { headers: common })
  ).json();
  assert.equal(discovery.audience, 'posnic-business');
  assert.equal(discovery.issuer, origin);
  assert.equal(discovery.reporting, 'unavailable');
  const page = await fetch(base + '/api/business/v1/authorize?request=' + f.request, {
    headers: common,
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(f.request.slice(-6).toUpperCase()));
  const csrf = html.match(/csrf:"([\w-]{43})"/)[1];
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const body = JSON.stringify({
    request: f.request,
    csrf,
    decision: 'allow',
    identifier: f.user.username,
    password,
  });
  const url = base + '/api/business/v1/approve';
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...common, cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(body), csrf: opaque() }),
      })
    ).status,
    403
  );
  for (const headers of [
    { ...common, origin },
    { ...common, cookie, origin: 'https://attacker.test' },
  ]) {
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body,
        })
      ).status,
      403
    );
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...common, cookie, origin, 'content-type': 'application/json' },
    body,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const value = await f.access.exchange(f.request, f.verifier);
  assert.equal(value.context.accountId, String(f.user._id));
});
