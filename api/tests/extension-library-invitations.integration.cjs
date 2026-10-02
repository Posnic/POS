'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const crypto = require('node:crypto');
const service = require('../src/services/extension-library-invitations');
let mongo, client;
before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client?.close(); await mongo?.stop(); });
async function fixture() {
  const db = client.db('invite_' + crypto.randomBytes(6).toString('hex'));
  await service.initializeInvitations(db);
  const owner = { id: 'owner' }, actor = { id: 'recipient', emailVerified: true, verifiedEmail: 'staff@example.test' };
  await db.collection('library_memberships').insertOne({ organizationId: 'org', userId: owner.id, status: 'active', role: 'owner' });
  const invite = await service.issueInvitation(db, owner, 'org', 'Staff@example.test');
  return { db, owner, actor, invite };
}
test('invitation is bound to verified account email and grants membership, not entitlements', async () => {
  const f = await fixture();
  await assert.rejects(service.acceptInvitation(f.db, client, { ...f.actor, emailVerified: false }, f.invite.token), /unavailable/);
  await assert.rejects(service.acceptInvitation(f.db, client, { ...f.actor, verifiedEmail: 'other@example.test' }, f.invite.token), /unavailable/);
  assert.deepEqual(await service.acceptInvitation(f.db, client, f.actor, f.invite.token), { organizationId: 'org', role: 'member' });
  const stored = await f.db.collection('library_invitations').findOne();
  assert.equal(JSON.stringify(stored).includes(f.invite.token), false);
  assert.equal(await f.db.collection('library_entitlements').countDocuments(), 0);
  await assert.rejects(service.acceptInvitation(f.db, client, { ...f.actor, id: 'different-account' }, f.invite.token), /unavailable/);
});
test('concurrent acceptance converges and retries cannot restore revoked membership', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => service.acceptInvitation(f.db, client, f.actor, f.invite.token)));
  assert.equal(results.length, 8);
  assert.equal(await f.db.collection('library_memberships').countDocuments({ userId: f.actor.id }), 1);
  await f.db.collection('library_memberships').updateOne({ userId: f.actor.id }, { $set: { status: 'revoked' } });
  await assert.rejects(service.acceptInvitation(f.db, client, f.actor, f.invite.token), /unavailable/);
});
test('expired, revoked and owner-revoked invitations do not grant access', async () => {
  const f = await fixture();
  await assert.rejects(service.acceptInvitation(f.db, client, f.actor, f.invite.token, { now: f.invite.expiresAt }), /unavailable/);
  await assert.rejects(service.revokeInvitation(f.db, f.owner, 'other-org', f.invite.invitationId), /unavailable/);
  await service.revokeInvitation(f.db, f.owner, 'org', f.invite.invitationId);
  await assert.rejects(service.acceptInvitation(f.db, client, f.actor, f.invite.token), /unavailable/);
  const another = await service.issueInvitation(f.db, f.owner, 'org', f.actor.verifiedEmail);
  await f.db.collection('library_memberships').updateOne({ userId: f.owner.id }, { $set: { status: 'revoked' } });
  await assert.rejects(service.acceptInvitation(f.db, client, f.actor, another.token), /unavailable/);
  assert.equal(await f.db.collection('library_memberships').countDocuments({ userId: f.actor.id }), 0);
});
test('ordinary members cannot invite or escalate existing roles', async () => {
  const f = await fixture();
  await assert.rejects(service.issueInvitation(f.db, f.actor, 'org', 'anyone@example.test'), /unavailable/);
  await f.db.collection('library_memberships').insertOne({ organizationId: 'org', userId: f.actor.id, role: 'owner', status: 'active' });
  assert.equal((await service.acceptInvitation(f.db, client, f.actor, f.invite.token)).role, 'owner');
});

test('HTTP invitations use authenticated identity, bounded bodies and no-store responses', async () => {
  const f = await fixture();
  const express = require('express');
  const { createInvitationRouter } = require('../src/routes/extension-library-invitations.routes');
  assert.throws(() => createInvitationRouter({ db: f.db, client }), /dependencies_required/);
  const app = express();
  // Synthetic account middleware, not a production authentication implementation.
  app.use(createInvitationRouter({ db: f.db, client, authenticate(req, res, next) {
    if (req.headers.authorization === 'Bearer owner') req.libraryActor = f.owner;
    else if (req.headers.authorization === 'Bearer recipient') req.libraryActor = f.actor;
    else return res.status(401).json({ error: 'Sign in required.' });
    next();
  } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (route, actor, body) => fetch(url + route, { method: 'POST',
    headers: { Authorization: 'Bearer ' + actor, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let r = await request('/organizations/org/invitations', 'recipient', { email: 'x@example.test', libraryActor: f.owner });
    assert.equal(r.status, 404);
    r = await request('/organizations/org/invitations', 'owner', { email: f.actor.verifiedEmail });
    assert.equal(r.status, 201); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const issued = await r.json();
    r = await request('/invitations/accept', 'missing', { token: issued.token, libraryActor: f.actor });
    assert.equal(r.status, 401);
    r = await request('/invitations/accept', 'owner', { token: issued.token, emailVerified: true, verifiedEmail: f.actor.verifiedEmail });
    assert.equal(r.status, 404);
    r = await request('/invitations/accept', 'recipient', { token: issued.token, organizationId: 'other', role: 'owner' });
    assert.deepEqual(await r.json(), { organizationId: 'org', role: 'member' });
    r = await request('/organizations/org/invitations/' + f.invite.invitationId + '/revoke', 'owner', {});
    assert.equal(r.status, 204);
    r = await request('/invitations/accept', 'recipient', { token: f.invite.token });
    assert.equal(r.status, 404);
    r = await request('/invitations/accept', 'recipient', { token: 'x'.repeat(9000) });
    assert.equal(r.status, 413); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await r.json(), { error: 'Invalid invitation request.' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
