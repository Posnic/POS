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
test('device bridge HTTP accepts only an exact, single-use Gateway grant and never a phone credential', async () => {
  const prior = process.env.POSNIC_BUSINESS_DECISIONS;
  process.env.POSNIC_BUSINESS_DECISIONS = '1';
  try {
    const f = await fixture();
    await db
      .collection('users')
      .updateOne({ _id: f.user._id }, { $set: { 'access.sales.write': true } });
    const body = {
      branchId: String(f.branch._id),
      requesterId: String(f.user._id),
      requesterAuthVersion: 1,
      request: {
        operationId: opaque(),
        revisionHash: 'a'.repeat(64),
        summary: {
          currency: 'INR',
          currencyDigits: 2,
          beforeDiscountMinor: 10000,
          discountMinor: 2000,
          payableMinor: 8000,
          roundingMinor: 0,
          itemCount: 2,
          reason: 'Regular customer',
        },
      },
    };
    const call = (token, value = body) =>
      fetch(base + '/api/business/v1/device-decisions/create', {
        method: 'POST',
        headers: {
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
          authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(value),
      });
    assert.equal((await call('pb1_' + opaque())).status, 401);
    const token = 'pbd1_' + opaque();
    await db
      .collection('business_device_grants')
      .insertOne({
        _id: hash(token),
        protocolVersion: 1,
        tenantDb: db.databaseName,
        action: 'create',
        bodyHash: hash(JSON.stringify(body)),
        device: { deviceId: opaque(), branches: [String(f.branch._id)] },
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 5000),
      });
    assert.equal((await call(token, { ...body, requesterAuthVersion: 2 })).status, 401);
    const response = await call(token);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'pending');
    assert.equal((await call(token)).status, 401);
  } finally {
    if (prior === undefined) delete process.env.POSNIC_BUSINESS_DECISIONS;
    else process.env.POSNIC_BUSINESS_DECISIONS = prior;
  }
});
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

test('exchanging and rotating tokens never refreshes the password-verification time', async () => {
  const f = await fixture();
  await approve(f);
  const original = new Date(Date.now() - 120_000);
  await db
    .collection('business_authorizations')
    .updateOne({ _id: hash(f.request) }, { $set: { issuedAt: original } });
  const grant = await f.access.exchange(f.request, f.verifier);
  assert.equal(
    (await f.access.authenticate(grant.token)).session.authenticatedAt.getTime(),
    original.getTime()
  );
  const rotated = await f.access.rotate(grant.token);
  assert.equal(
    (await f.access.authenticate(rotated.token)).session.authenticatedAt.getTime(),
    original.getTime()
  );
  const cloud = await fixture();
  await approve(cloud);
  await db
    .collection('business_authorizations')
    .updateOne({ _id: hash(cloud.request) }, { $set: { authorization: 'cloud-browser' } });
  const cloudGrant = await cloud.access.exchange(cloud.request, cloud.verifier);
  assert.equal((await cloud.access.authenticate(cloudGrant.token)).session.authenticatedAt, null);
});

test('decision routes enforce branch scope, explicit remote permission, limits and verified recent authentication', async () => {
  const prior = process.env.POSNIC_BUSINESS_DECISIONS;
  process.env.POSNIC_BUSINESS_DECISIONS = '1';
  try {
    const f = await fixture(),
      foreign = await fixture();
    await db
      .collection('users')
      .updateMany(
        { _id: { $in: [f.user._id, foreign.user._id] } },
        { $set: { usertype: 'admin' } }
      );
    const session = await grant(f),
      otherSession = await grant(foreign);
    const identity = await f.access.authenticate(session.token);
    const ledger = require('../src/services/business-decision-ledger').createDecisionLedger(db);
    const source = {
      businessId: String(f.license),
      branchId: String(f.branch._id),
      requesterId: String(new ObjectId()),
      deviceId: 'desktop-00000000001',
    };
    const input = {
      operationId: 'operation-' + opaque(),
      revisionHash: 'a'.repeat(64),
      summary: {
        beforeDiscountMinor: 10000,
        discountMinor: 2000,
        payableMinor: 8000,
        roundingMinor: 0,
        currency: 'INR',
        currencyDigits: 2,
        itemCount: 1,
        reason: 'Regular customer',
      },
    };
    const row = await ledger.create(source, input),
      path = '/api/business/v1/decisions/' + row._id;
    const headers = (token) => ({
      'x-forwarded-proto': 'https',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    });
    const read = async (url, token = session.token) =>
      fetch(base + url, { headers: headers(token) });
    const write = async (body, token = session.token) =>
      fetch(base + path, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    const action = {
      decisionId: 'decision-' + opaque(),
      expectedRevision: 0,
      outcome: 'approved',
      reason: '',
    };
    const listed = await (await read('/api/business/v1/decisions')).json();
    assert.equal(listed.entries.length, 1);
    assert.equal(listed.entries[0].canDecide, true);
    assert.equal(listed.entries[0].requiresStepUp, false);
    assert.ok(!JSON.stringify(listed).includes(input.revisionHash));
    assert.ok(!JSON.stringify(listed).includes(source.deviceId));
    assert.equal((await read(path, otherSession.token)).status, 404);
    await db
      .collection('business_sessions')
      .updateOne(
        { _id: identity.session._id },
        { $set: { authenticatedAt: new Date(Date.now() - 600_000) } }
      );
    assert.equal((await write(action)).status, 428);
    const rotated = await f.access.rotate(session.token);
    assert.equal((await write(action, rotated.token)).status, 428);
    assert.equal(
      (await write({ ...action, confirmationToken: otherSession.token }, rotated.token)).status,
      409
    );
    const stepVerifier = opaque();
    const stepRequest = await f.access.request({
      codeChallenge: proof(stepVerifier),
      deviceName: 'Confirm decision',
      stepUp: true,
    });
    await f.access.decide(stepRequest.request, 'allow', f.user.username, password);
    const confirmation = await f.access.exchange(stepRequest.request, stepVerifier);
    assert.ok(Date.parse(confirmation.expiresAt) <= Date.now() + 600_000);
    const decided = await write(
      { ...action, confirmationToken: confirmation.token },
      rotated.token
    );
    assert.equal(decided.status, 200);
    assert.equal((await decided.json()).state, 'approved');
    assert.equal(
      (await f.access.authenticate(rotated.token)).session.authenticatedAt.getTime(),
      (await f.access.authenticate(confirmation.token)).session.authenticatedAt.getTime()
    );
    assert.equal(
      (await db.collection('business_decisions').findOne({ _id: row._id })).approverSessionId,
      identity.session._id
    );
    await f.access.revoke(confirmation.token);
    assert.ok(
      !JSON.stringify(await db.collection('business_decisions').findOne({ _id: row._id })).includes(
        confirmation.token
      )
    );
    await db
      .collection('business_sessions')
      .updateOne({ _id: identity.session._id }, { $set: { authenticatedAt: new Date(0) } });
    assert.equal(
      (await write(action, rotated.token)).status,
      200,
      'accepted retry needs no new decision'
    );
    await db.collection('users').updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
    assert.equal((await read(path, rotated.token)).status, 404);
    const decisionApi = require('../src/services/business-decisions');
    await assert.rejects(
      decisionApi.claimDecision(
        db,
        source,
        String(row._id),
        input.revisionHash,
        'execution-00000001'
      ),
      is('access_denied')
    );
    await db
      .collection('users')
      .updateOne({ _id: f.user._id }, { $set: { branch_access: [{ branch_id: f.branch._id }] } });
    assert.equal(
      (
        await decisionApi.claimDecision(
          db,
          source,
          String(row._id),
          input.revisionHash,
          'execution-00000001'
        )
      ).executionPermit,
      'start',
      'revoking the temporary proof does not revoke the primary session'
    );
    await f.access.revoke(rotated.token);
    assert.equal(
      (
        await decisionApi.claimDecision(
          db,
          source,
          String(row._id),
          input.revisionHash,
          'execution-00000001'
        )
      ).executionPermit,
      'reconcile'
    );
    await assert.rejects(
      decisionApi.claimDecision(
        db,
        source,
        String(row._id),
        input.revisionHash,
        'execution-00000002'
      ),
      is('decision_changed')
    );

    const staff = await fixture();
    await db.collection('users').updateOne(
      { _id: staff.user._id },
      {
        $set: {
          'access.pos': {
            discount_apply: true,
            discount_approve_remote: true,
            discount_max_percent: 10,
          },
        },
      }
    );
    const staffSession = await grant(staff);
    const staffRow = await ledger.create(
      { ...source, businessId: String(staff.license), branchId: String(staff.branch._id) },
      input
    );
    const api = require('../src/services/business-decisions'),
      staffIdentity = await staff.access.authenticate(staffSession.token);
    const limited = await api.readDecision(db, staffIdentity.session._id, String(staffRow._id));
    assert.equal(limited.canDecide, false);
    assert.equal(limited.unavailableReason, 'discount_limit');
    await assert.rejects(
      api.decide(db, staffIdentity.session._id, String(staffRow._id), action),
      is('discount_limit_exceeded')
    );
    await db
      .collection('users')
      .updateOne(
        { _id: staff.user._id },
        { $set: { 'access.pos.discount_approve_remote': false } }
      );
    await assert.rejects(
      api.readDecision(db, staffIdentity.session._id, String(staffRow._id)),
      is('access_denied')
    );
    assert.ok(
      !capabilities({
        usertype: 'manager',
        access: { dashboard: { read: true, financials: true }, pos: { discount_apply: true } },
      }).includes('discounts.approve')
    );
  } finally {
    if (prior === undefined) delete process.env.POSNIC_BUSINESS_DECISIONS;
    else process.env.POSNIC_BUSINESS_DECISIONS = prior;
  }
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
  assert.equal(discovery.reporting, 'bounded-summary-v2');
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

const reportDay = new Date().toISOString().slice(0, 10);
test('only an owner with branch membership can replace a live reporting publisher; concurrent changes have one winner', async () => {
  const f = await fixture(),
    value = await grant(f),
    branchId = String(f.branch._id);
  const { listPublishers, changePublisher } = require('../src/services/business-publishers');
  await assert.rejects(listPublishers(db, value.context, branchId), is('access_denied'));
  const headers = { 'x-forwarded-proto': 'https', authorization: 'Bearer ' + value.token };
  assert.equal(
    (await fetch(base + '/api/business/v1/reporting/publishers/' + branchId, { headers })).status,
    403
  );
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { usertype: 'admin' } });
  const owner = await f.access.contextFor({ ...f.user, usertype: 'admin' });
  assert.ok(owner.capabilities.includes('reporting.manage'));
  for (const deviceId of ['till-a', 'till-b'])
    await db.collection('business_reporting_candidates').insertOne({
      _id: branchId + ':' + deviceId,
      license: f.license,
      branchId,
      deviceId,
      name: deviceId,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    });
  assert.equal((await listPublishers(db, owner, branchId)).candidates.length, 2);
  const results = await Promise.allSettled(
    ['till-a', 'till-b'].map((deviceId) =>
      changePublisher(db, owner, branchId, { deviceId, expectedEpoch: 0 })
    )
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const state = await listPublishers(db, owner, branchId),
    current = state.publisher.deviceId;
  assert.equal(state.publisher.epoch, 1);
  await assert.rejects(
    changePublisher(db, owner, branchId, { deviceId: 'unknown', expectedEpoch: 1 }),
    is('desktop_unavailable')
  );
  await assert.rejects(
    changePublisher(db, owner, String(new ObjectId()), { deviceId: current, expectedEpoch: 1 }),
    is('access_denied')
  );
  const next = current === 'till-a' ? 'till-b' : 'till-a';
  await db
    .collection('business_reporting_publishers')
    .updateOne({ _id: branchId }, { $set: { pending: { sequence: 1 } } });
  await assert.rejects(
    changePublisher(db, owner, branchId, { deviceId: next, expectedEpoch: 1 }),
    is('publisher_changed')
  );
  await db
    .collection('business_reporting_publishers')
    .updateOne({ _id: branchId }, { $unset: { pending: '' } });
  await changePublisher(db, owner, branchId, { deviceId: next, expectedEpoch: 1 });
  assert.equal((await listPublishers(db, owner, branchId)).publisher.epoch, 2);
  const audit = await db
    .collection('business_reporting_audit')
    .find({ branchId })
    .sort({ epoch: 1 })
    .toArray();
  assert.equal(audit.length, 2);
  assert.equal(audit[1].fromDeviceId, current);
  assert.equal(audit[1].toDeviceId, next);
  assert.equal(audit[1].accountId, owner.accountId);
});
test('publisher assignment retains its audit event across a write failure and replays it exactly once', async () => {
  const f = await fixture(),
    branchId = String(f.branch._id);
  const owner = await f.access.contextFor({ ...f.user, usertype: 'admin' });
  const { listPublishers, changePublisher } = require('../src/services/business-publishers');
  await db.collection('business_reporting_candidates').insertOne({
    _id: branchId + ':a',
    license: f.license,
    branchId,
    deviceId: 'a',
    name: 'A',
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  });
  const broken = {
    collection(name) {
      return name === 'business_reporting_audit'
        ? {
            updateOne: async () => {
              throw new Error('write interrupted');
            },
          }
        : db.collection(name);
    },
  };
  await assert.rejects(
    changePublisher(broken, owner, branchId, { deviceId: 'a', expectedEpoch: 0 }),
    /write interrupted/
  );
  assert.ok(
    (await db.collection('business_reporting_publishers').findOne({ _id: branchId }))
      .pendingTransition
  );
  await listPublishers(db, owner, branchId);
  await listPublishers(db, owner, branchId);
  assert.equal(await db.collection('business_reporting_audit').countDocuments({ branchId }), 1);
  assert.equal(
    (await db.collection('business_reporting_publishers').findOne({ _id: branchId }))
      .pendingTransition,
    undefined
  );
});
async function prepared(f) {
  const id = String(f.branch._id),
    assignmentId = opaque(),
    at = new Date().toISOString();
  await db.collection('business_reporting_publishers').insertOne({
    _id: id,
    license: f.license,
    assignmentId,
    deviceId: 'desktop-test',
    epoch: 1,
    lastSequence: 1,
  });
  await db.collection('business_prepared_summaries').insertOne({
    _id: id + ':' + reportDay,
    branch_id: f.branch._id,
    license: f.license,
    publisherAssignmentId: assignmentId,
    publisherDeviceId: 'desktop-test',
    publisherEpoch: 1,
    sequence: 1,
    summary: {
      schemaVersion: 2,
      metricDefinitionVersion: 2,
      branchId: id,
      license: String(f.license),
      businessDate: reportDay,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      currencyDigits: 2,
      billedSalesMinor: 10000,
      refundsMinor: 2500,
      salesAfterReturnsMinor: 7500,
      completedSales: 2,
      preparedAt: at,
      sourceUpdatedAt: at,
      sourceComplete: false,
    },
  });
  return id;
}
test('Business notification routes require their own session and enforce current branch access', async () => {
  const f = await fixture(),
    value = await grant(f),
    branchId = String(f.branch._id);
  const url = base + '/api/business/v1/notifications/preferences/' + branchId;
  assert.equal((await fetch(url, { headers: { 'x-forwarded-proto': 'https' } })).status, 401);
  const headers = {
    'x-forwarded-proto': 'https',
    authorization: 'Bearer ' + value.token,
    'content-type': 'application/json',
  };
  assert.equal((await fetch(url, { headers })).status, 200);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: 0,
      enabled: true,
      time: '23:00',
      locale: 'en',
      quiet: { enabled: false, start: '22:00', end: '07:00' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).channel, 'inApp');
  assert.deepEqual(await (await fetch(base + '/api/business/v1/inbox', { headers })).json(), {
    entries: [],
    next: null,
  });
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
  assert.equal((await fetch(url, { headers })).status, 403);
});
test('push registration is scoped to the authenticated Business session and returns no provider token', async () => {
  const names = [
    'POSNIC_BUSINESS_PUSH_ENABLED',
    'POSNIC_BUSINESS_EXPO_PROJECT_ID',
    'POSNIC_BUSINESS_EXPO_ACCESS_TOKEN',
  ];
  const previous = names.map((name) => process.env[name]);
  const projectId = '11111111-1111-4111-8111-111111111111';
  process.env[names[0]] = '1';
  process.env[names[1]] = projectId;
  process.env[names[2]] = 'fixture-only-no-provider-call';
  try {
    const f = await fixture(),
      value = await grant(f),
      url = base + '/api/business/v1/notifications/device';
    const headers = {
      'x-forwarded-proto': 'https',
      authorization: 'Bearer ' + value.token,
      'content-type': 'application/json',
    };
    assert.equal((await fetch(url, { headers: { 'x-forwarded-proto': 'https' } })).status, 401);
    const input = { token: 'ExpoPushToken[abcdefghijk12345]', platform: 'android', projectId };
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, accountId: String(new ObjectId()) }),
        })
      ).status,
      400
    );
    assert.deepEqual(
      await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).json(),
      { enabled: true }
    );
    assert.deepEqual(await (await fetch(url, { headers })).json(), {
      available: true,
      projectId,
      enabled: true,
    });
    assert.deepEqual(await (await fetch(url, { method: 'DELETE', headers })).json(), {
      enabled: false,
    });
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
test('prepared overview enforces live ACL and branch scope and never substitutes missing summaries with zero', async () => {
  const f = await fixture(),
    value = await grant(f),
    id = String(f.branch._id);
  const read = (branchId) =>
    fetch(base + '/api/business/v1/overview?businessDate=' + reportDay + '&branchId=' + branchId, {
      headers: { 'x-forwarded-proto': 'https', authorization: 'Bearer ' + value.token },
    });
  assert.equal((await read(id)).status, 503);
  await prepared(f);
  const response = await read(id);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.salesAfterReturnsMinor, 7500);
  assert.equal(result.freshness.state, 'partial');
  assert.equal(result.freshness.complete, false);
  assert.equal((await read(String(new ObjectId()))).status, 403);
  await db
    .collection('users')
    .updateOne({ _id: f.user._id }, { $set: { access: { item: { read: true } } } });
  assert.equal((await read(id)).status, 403);
});
test('prepared reads reject an in-progress publisher, wrong generation and false completeness', async () => {
  const { readBusinessOverview } = require('../src/services/business-reports');
  const f = await fixture(),
    value = await grant(f),
    id = await prepared(f),
    query = { businessDate: reportDay, branchId: id };
  await db
    .collection('business_reporting_publishers')
    .updateOne({ _id: id }, { $set: { pending: { sequence: 2 } } });
  await assert.rejects(readBusinessOverview(db, value.context, query), is('summary_unavailable'));
  await db
    .collection('business_reporting_publishers')
    .updateOne({ _id: id }, { $unset: { pending: '' } });
  await db
    .collection('business_prepared_summaries')
    .updateOne({ branch_id: f.branch._id }, { $set: { publisherEpoch: 2 } });
  await assert.rejects(readBusinessOverview(db, value.context, query), is('summary_unavailable'));
  await db
    .collection('business_prepared_summaries')
    .updateOne(
      { branch_id: f.branch._id },
      { $set: { publisherEpoch: 1, 'summary.sourceComplete': true } }
    );
  await assert.rejects(readBusinessOverview(db, value.context, query), is('summary_unavailable'));
  await assert.rejects(
    readBusinessOverview(db, value.context, { ...query, branchId: [id, id] }),
    is('invalid_request')
  );
});
