'use strict';
// Registry only. Identity and verifiedEmail must come from account middleware.
// A replica set is required: invitation consumption and membership are atomic.
const crypto = require('node:crypto');
const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const deny = () => { throw Object.assign(new Error('extension_invitation_unavailable'), { status: 404 }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) deny();
  return value.toLowerCase();
}
async function initializeInvitations(db) {
  await db.collection('library_invitations').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('library_memberships').createIndex({ organizationId: 1, userId: 1 }, { unique: true });
}
async function owner(db, actor, organizationId, session) {
  if (!valid(actor?.id) || !valid(organizationId)) deny();
  const row = await db.collection('library_memberships').findOne({ organizationId,
    userId: actor.id, status: 'active', role: 'owner' }, { session });
  if (!row) deny();
}
async function issueInvitation(db, actor, organizationId, recipientEmail, { now = new Date() } = {}) {
  await owner(db, actor, organizationId);
  const recipient = email(recipientEmail);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  await db.collection('library_invitations').insertOne({ _id: hash(token), organizationId,
    recipient, invitedBy: actor.id, status: 'pending', createdAt: now, expiresAt });
  // No mail is sent here. Only a trusted delivery layer may disclose this token.
  return { token, invitationId: hash(token), expiresAt };
}
async function revokeInvitation(db, actor, organizationId, invitationId) {
  await owner(db, actor, organizationId);
  if (!/^[a-f0-9]{64}$/.test(invitationId || '')) deny();
  const result = await db.collection('library_invitations').updateOne({ _id: invitationId,
    organizationId, status: 'pending' }, { $set: { status: 'revoked' } });
  if (!result.matchedCount) deny();
}
async function acceptInvitation(db, client, actor, token, { now = new Date() } = {}) {
  if (!valid(actor?.id) || actor.emailVerified !== true || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) deny();
  const recipient = email(actor.verifiedEmail);
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const invites = db.collection('library_invitations');
      const invitation = await invites.findOne({ _id: hash(token), recipient,
        expiresAt: { $gt: now }, status: { $in: ['pending', 'accepted'] } }, { session });
      if (!invitation || (invitation.acceptedBy && invitation.acceptedBy !== actor.id)) deny();
      // An owner who lost authority cannot leave usable invitations behind.
      await owner(db, { id: invitation.invitedBy }, invitation.organizationId, session);
      // Write the authority row so concurrent owner revocation conflicts with
      // this transaction instead of committing against a stale snapshot.
      const authority = await db.collection('library_memberships').updateOne({
        organizationId: invitation.organizationId, userId: invitation.invitedBy,
        status: 'active', role: 'owner',
      }, { $inc: { invitationAcceptanceRevision: 1 } }, { session });
      if (!authority.matchedCount) deny();
      const memberships = db.collection('library_memberships');
      const key = { organizationId: invitation.organizationId, userId: actor.id };
      const existing = await memberships.findOne(key, { session });
      // Never resurrect revoked membership or replace an existing role.
      if (existing && existing.status !== 'active') deny();
      if (invitation.status === 'accepted' && !existing) deny();
      if (!existing) await memberships.insertOne({ ...key, status: 'active', role: 'member',
        invitationId: invitation._id, joinedAt: now }, { session });
      await invites.updateOne({ _id: invitation._id }, { $set: {
        status: 'accepted', acceptedBy: actor.id, acceptedAt: invitation.acceptedAt || now,
      } }, { session });
      return { organizationId: invitation.organizationId, role: existing?.role || 'member' };
    });
  } finally { await session.endSession(); }
}
module.exports = { initializeInvitations, issueInvitation, revokeInvitation, acceptInvitation };
