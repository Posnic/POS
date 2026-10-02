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
