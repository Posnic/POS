'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const s = require('../src/services/extension-registry-sessions');
let mongo, client;
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const db = client.db('sessions_' + crypto.randomBytes(6).toString('hex'));
  await s.initializeSessions(db);
  await db
    .collection('registry_accounts')
    .insertOne({
      _id: 'account',
      status: 'active',
      authVersion: 1,
      email: 'member@example.test',
      emailVerified: true,
    });
  return { db, session: await s.issueSession(db, 'account') };
}
test('hashed sessions expire synchronously and sign-out invalidates them', async () => {
  const f = await fixture();
  const actor = await s.authenticateSession(f.db, f.session.token);
  assert.deepEqual(actor, {
    id: 'account',
    emailVerified: true,
    verifiedEmail: 'member@example.test',
  });
  assert.equal(
    JSON.stringify(await f.db.collection('registry_sessions').findOne()).includes(f.session.token),
    false
  );
  await assert.rejects(
    s.authenticateSession(f.db, f.session.token, { now: f.session.expiresAt }),
    /sign_in_required/
  );
  await s.revokeSession(f.db, f.session.token);
  await assert.rejects(s.authenticateSession(f.db, f.session.token), /sign_in_required/);
});
test('current account state revokes all sessions and removes stale email verification', async () => {
  const f = await fixture();
  await f.db
    .collection('registry_accounts')
    .updateOne({ _id: 'account' }, { $set: { emailVerified: false } });
  assert.deepEqual(await s.authenticateSession(f.db, f.session.token), {
    id: 'account',
    emailVerified: false,
  });
  await f.db
    .collection('registry_accounts')
    .updateOne({ _id: 'account' }, { $inc: { authVersion: 1 } });
  await assert.rejects(s.authenticateSession(f.db, f.session.token), /sign_in_required/);
  const next = await s.issueSession(f.db, 'account');
  await f.db
    .collection('registry_accounts')
    .updateOne({ _id: 'account' }, { $set: { status: 'disabled' } });
  await assert.rejects(s.authenticateSession(f.db, next.token), /sign_in_required/);
  await assert.rejects(s.issueSession(f.db, 'account'), /sign_in_required/);
});
test('HTTP middleware accepts only registry bearer sessions and clears spoofed identity', async () => {
  const f = await fixture(),
    express = require('express'),
    app = express();
  app.use((req, res, next) => {
    req.libraryActor = { id: 'spoof' };
    next();
  });
  app.use(require('express-rate-limit').rateLimit({ windowMs: 60000, limit: 30 }));
  app.use(s.createRegistryAuthentication({ db: f.db }));
  app.get('/', (req, res) => res.json(req.libraryActor));
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const authorization of ['', 'Bearer local.till.jwt', 'Basic ' + f.session.token]) {
      const r = await fetch(url, { headers: { authorization } });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
    }
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + f.session.token } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, 'account');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
