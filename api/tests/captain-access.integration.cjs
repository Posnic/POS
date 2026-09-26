'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'),
  crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const access = require('../src/services/captain-access');
let mongo, db, manager, staff, branch, req, server, base;
before(async () => {
  const binary = require('node:path').resolve(__dirname, '../../mongodb/bin/mongod.exe');
  mongo = await MongoMemoryServer.create({
    binary: require('node:fs').existsSync(binary) ? { systemBinary: binary } : {},
  });
  process.env.MONGODB_URI = mongo.getUri('captain_test');
  await mongoose.connect(process.env.MONGODB_URI);
  db = mongoose.connection.db;
  const license = new ObjectId();
  branch = { _id: new ObjectId(), license, branch_name: 'Test shop', module_captain_enable: true };
  manager = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'owner',
    branch_id: branch._id,
  };
  staff = {
    _id: new ObjectId(),
    license,
    activate: true,
    username: 'Waiter',
    branch_id: branch._id,
    access: { sales: { write: true } },
    authVersion: 2,
  };
  manager.branch_access = staff.branch_access = [
    { branch_id: branch._id, branch_name: branch.branch_name },
  ];
  await db.collection('users').insertMany([manager, staff]);
  await db.collection('branches').insertOne(branch);
  req = {
    db,
    user: manager,
    tenantContext: { branchId: branch._id, licenseId: license },
    body: { staffId: String(staff._id) },
    ip: '127.0.0.1',
  };
  const express = require('express'),
    app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use(
    require('express-session')({
      secret: crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(require('../src/middleware/csrf').protect);
  app.use((r, _s, next) => {
    r.db = db;
    next();
  });
  app.use('/api/captain/v1', require('../src/routes/captain-access.routes'));
  const { protect, optionalProtect } = require('../src/middleware/auth');
  app.get('/api/users/admin', protect, (r, s) => s.json({ user: r.user._id }));
  app.post('/api/items/accessQr', optionalProtect, (r, s) =>
    s.json({ user: r.user?._id, cookieUser: r.session.userId })
  );
  for (const [url, file] of [
    ['/api/captain-setup', 'captain-setup.html'],
    ['/api/captain-setup.js', 'captain-setup.js'],
    ['/api/captain-setup.css', 'captain-setup.css'],
  ])
    app.get(url, (_r, s) =>
      s.sendFile(require('node:path').resolve(__dirname, '../src/routes', file), {
        dotfiles: 'allow',
      })
    );
  app.use((e, r, s, next) => s.status(e.statusCode || 500).json({ error: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await mongoose.disconnect();
  const Model = require('../src/models/base.model');
  await Model.mongoClient?.close();
  await mongo?.stop();
});
test('real HTTP pairing, branch scoping and revocation; bearer does not mint an unscoped login cookie', async () => {
  const managerToken = require('../src/middleware/auth').signLegacyToken(
    manager,
    req,
    branch._id,
    900
  );
  const made = await fetch(base + '/captain/v1/pair-codes', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + managerToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId: String(staff._id) }),
  });
  assert.equal(made.status, 200, await made.clone().text());
  const code = await made.json();
  assert.ok(code.targets[0].qr.startsWith('data:image/png'));
  const response = await fetch(base + '/captain/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.code, device: { device_id: crypto.randomUUID() } }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const grant = await response.json(),
    headers = { Authorization: 'Bearer ' + grant.token };
  assert.equal((await fetch(base + '/captain/v1/session', { headers })).status, 200);
  const accessQr = await fetch(base + '/items/accessQr', {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'x-branch-id': String(new ObjectId()),
    },
    body: '{}',
  });
  assert.equal(accessQr.status, 200, await accessQr.clone().text());
  assert.equal((await accessQr.json()).cookieUser, undefined);
  const cookie = (accessQr.headers.getSetCookie() || []).map((v) => v.split(';')[0]).join(';');
  assert.equal((await fetch(base + '/users/admin', { headers: { cookie } })).status, 401);
  assert.equal((await fetch(base + '/users/admin', { headers })).status, 403);
  await db
    .collection('handsets')
    .updateOne(
      { device_id: require('jsonwebtoken').decode(grant.token).device_id },
      { $set: { revoked: true } }
    );
  assert.equal((await fetch(base + '/captain/v1/session', { headers })).status, 403);
});
test('expired codes and wrong cloud device proof cannot authorize a phone', async () => {
  const code = await access.createCode(req);
  await db
    .collection('captain_pair_codes')
    .updateOne({ _id: access.hash(code.code) }, { $set: { expires: new Date(0) } });
  await assert.rejects(
    access.pair({ db, body: { code: code.code, device: { device_id: 'test-phone-12345' } } }),
    (e) => e.code === 'PAIR_EXPIRED'
  );
  const cloud = await access.createCode(req);
  await db
    .collection('captain_pair_codes')
    .updateOne(
      { _id: access.hash(cloud.code) },
      { $set: { deviceId: 'another-phone-12345', codeChallenge: 'c'.repeat(43) } }
    );
  await assert.rejects(
    access.pair({
      db,
      body: {
        code: cloud.code,
        device: { device_id: 'test-phone-12345' },
        codeVerifier: 'v'.repeat(43),
      },
    }),
    (e) => e.code === 'INVALID_PAIR'
  );
});
test(
  'manager setup page generates a QR with a real login cookie and CSRF protection',
  { skip: !process.env.CAPTAIN_PLAYWRIGHT_PATH },
  async () => {
    const { chromium } = require(process.env.CAPTAIN_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext();
      context.setDefaultTimeout(10000);
      const token = require('../src/middleware/auth').signLegacyToken(
        manager,
        req,
        branch._id,
        900
      );
      await context.addCookies([
        { name: 'jwt', value: token, url: base + '/', httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.log('Setup page error:', e.message));
      page.on('response', async (r) => {
        if (r.status() >= 400) console.log('Setup response:', r.status(), r.url(), await r.text());
      });
      await page.goto(base + '/captain-setup');
      await page.locator('#staff option').first().waitFor({ state: 'attached' });
      await page.locator('#staff').selectOption(String(staff._id));
      await page.locator('#generate').click();
      await page.locator('#result:not([hidden]) img').first().waitFor();
      assert.match(await page.locator('#code').innerText(), /^[A-F0-9]{12}$/);
      await page.screenshot({
        path: require('node:path').resolve(__dirname, '../../captain-manager-setup.png'),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }
);
async function paired() {
  const code = await access.createCode(req);
  const grant = await access.pair({
    db,
    body: { code: code.code, device: { device_id: crypto.randomUUID() } },
    ip: '127.0.0.1',
  });
  return { code, grant };
}

test('route proof identifies the issuing session without accepting any credential', async () => {
  const { grant } = await paired();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const answer = await fetch(base + '/captain/v1/route-proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: grant.sessionId, nonce }),
  });
  assert.equal(answer.status, 200);
  assert.equal(
    (await answer.json()).proof,
    crypto.createHmac('sha256', grant.routeKey).update(nonce).digest('hex')
  );
  const wrong = await access
    .routeProof({ db, body: { sessionId: String(new ObjectId()), nonce } })
    .catch((e) => e);
  assert.equal(wrong.code, 'UNKNOWN_AUTHORITY');
  assert.equal(grant.idempotentOrders, true);
});

test('internet address is manager-only, validated and included in renewed grants', async () => {
  const managerToken = require('../src/middleware/auth').signLegacyToken(
    manager,
    req,
    branch._id,
    900
  );
  const save = (url) =>
    fetch(base + '/captain/v1/connection-settings', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + managerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fallbackUrl: url }),
    });
  assert.equal((await save('http://untrusted.example')).status, 400);
  assert.equal((await save('https://user:password@shop.example')).status, 400);
  assert.equal((await save('https://shop.example')).status, 200);
  const { grant } = await paired();
  assert.ok(grant.routes.includes('https://shop.example/api'));
  const denied = await fetch(base + '/captain/v1/connection-settings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fallbackUrl: 'https://another.example' }),
  });
  assert.equal(denied.status, 403);
});
test('manager grants a single-use, short-lived, staff-and-branch bound Captain session', async () => {
  const { code, grant } = await paired();
  const token = require('jsonwebtoken').verify(grant.token, process.env.JWT_SECRET);
  assert.equal(grant.user.id, String(staff._id));
  assert.equal(token.branch_id, String(branch._id));
  assert.equal(token.captain_session, grant.sessionId);
  assert.equal(token.exp - token.iat, 900);
  await assert.rejects(
    () =>
      access.pair({ db, body: { code: code.code, device: { device_id: 'other-phone-12345' } } }),
    (e) => e.code === 'PAIR_EXPIRED'
  );
});
test('proof verifies the issuing till without revealing pairing secret', async () => {
  const code = await access.createCode(req),
    nonce = crypto.randomBytes(32).toString('base64url');
  const result = await access.proof({ db, body: { enrolmentId: code.enrolmentId, nonce } });
  assert.equal(
    result.proof,
    crypto.createHmac('sha256', access.hash(code.code)).update(nonce).digest('hex')
  );
});
test('simultaneous claims accept only one device', async () => {
  const code = await access.createCode(req);
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      access.pair({ db, body: { code: code.code, device: { device_id: 'concurrent-phone-' + n } } })
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('refresh rotation survives a lost reply and rejects a different successor', async () => {
  const { grant } = await paired(),
    next = crypto.randomBytes(32).toString('base64url');
  const request = {
    db,
    body: { sessionId: grant.sessionId, refreshToken: grant.refreshToken, nextToken: next },
  };
  const results = await Promise.all([access.refresh(request), access.refresh(request)]);
  assert.ok(results.every((r) => r.refreshToken === next));
  await assert.rejects(
    () =>
      access.refresh({
        db,
        body: { ...request.body, nextToken: crypto.randomBytes(32).toString('base64url') },
      }),
    (e) => e.code === 'INVALID_SESSION'
  );
  const row = await db
    .collection('captain_sessions')
    .findOne({ _id: new ObjectId(grant.sessionId) });
  assert.equal(row.refreshHash, access.hash(next));
  assert.ok(!JSON.stringify(row).includes(next));
});
test('revocation and permission or feature removal prevent renewal', async () => {
  const { grant } = await paired(),
    body = {
      sessionId: grant.sessionId,
      refreshToken: grant.refreshToken,
      nextToken: crypto.randomBytes(32).toString('base64url'),
    };
  await db
    .collection('captain_sessions')
    .updateOne({ _id: new ObjectId(grant.sessionId) }, { $set: { revoked: true } });
  await assert.rejects(
    () => access.refresh({ db, body }),
    (e) => e.code === 'DEVICE_REVOKED'
  );
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { module_captain_enable: false } });
  await assert.rejects(
    () => access.createCode(req),
    (e) => e.code === 'CAPTAIN_DISABLED'
  );
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { module_captain_enable: true } });
});
test('staff cannot approve devices and cross-tenant staff cannot be selected', async () => {
  await assert.rejects(
    () => access.createCode({ ...req, user: staff }),
    (e) => e.code === 'MANAGER_REQUIRED'
  );
  const outsider = { ...staff, _id: new ObjectId(), license: new ObjectId() };
  await db.collection('users').insertOne(outsider);
  await assert.rejects(
    () => access.createCode({ ...req, body: { staffId: String(outsider._id) } }),
    (e) => e.code === 'CAPTAIN_PERMISSION'
  );
});
test('Captain scoped sessions cannot access Mobile POS or administration', async () => {
  const { grant } = await paired();
  const token = require('jsonwebtoken').decode(grant.token);
  const request = {
    db,
    tenantContext: req.tenantContext,
    captainSession: grant.sessionId,
    handsetDevice: token.device_id,
    originalUrl: '/api/sales/getListKot',
  };
  await access.verifySession(request, staff);
  await assert.rejects(
    () => access.verifySession({ ...request, originalUrl: '/api/mobile/v1/sales' }, staff),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await assert.rejects(
    () => access.verifySession({ ...request, originalUrl: '/api/users/delete' }, staff),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await assert.rejects(
    () =>
      access.verifySession(
        { ...request, tenantContext: { ...req.tenantContext, branchId: new ObjectId() } },
        staff
      ),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await db
    .collection('handsets')
    .updateOne({ device_id: token.device_id }, { $set: { revoked: true } });
  await assert.rejects(
    () => access.verifySession(request, staff),
    (e) => e.code === 'DEVICE_REVOKED'
  );
});
