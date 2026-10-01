'use strict';
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { context, fail } = require('../utils/branch-access');
const { passwordMatches } = require('../utils/password-match');
const { recordAudit } = require('../utils/audit-trail');
async function self(req) {
  if (!req.user?._id) fail('Sign in again.', 401);
  const c = await context(req);
  const filter = { _id: new ObjectId(String(req.user._id)), license: c.license, activate: true };
  const user = await req.db.collection('users').findOne(filter);
  if (!user) fail('Sign in again.', 401);
  return { c, filter, user };
}
const view = (user) => ({
  id: String(user._id),
  name: user.name || user.firstname || user.username || '',
  email: user.email || '',
  phone: user.phone || '',
});
async function get(req) {
  return view((await self(req)).user);
}
async function update(req) {
  const { filter } = await self(req);
  const name = req.body?.name;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 100 ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32)
  )
    fail('Enter your name.');
  await req.db
    .collection('users')
    .updateOne(filter, { $set: { name: name.trim(), updated_date: new Date() } });
  return get(req);
}
async function password(req) {
  const { filter, user, c } = await self(req);
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (
    typeof newPassword !== 'string' ||
    newPassword.length < 10 ||
    Buffer.byteLength(newPassword, 'utf8') > 54 ||
    newPassword !== confirmPassword
  )
    fail('Use at least 10 characters and repeat the new password.');
  if (!(await passwordMatches(currentPassword, user.password)))
    fail('The current password is incorrect.', 400);
  const hash = await bcrypt.hash(Buffer.from(newPassword, 'utf8').toString('base64'), 12);
  const changed = await req.db.collection('users').updateOne(
    { ...filter, password: user.password },
    {
      $set: { password: hash, passwordChangedAt: new Date(), updated_date: new Date() },
      $inc: { authVersion: 1 },
    }
  );
  if (!changed.matchedCount) fail('Your account changed. Sign in again.', 409);
  await req.db
    .collection('captain_sessions')
    .updateMany({ userId: user._id, license: c.license }, { $set: { revoked: true } });
  await recordAudit(req.db, {
    event: 'captain.password.changed',
    actor: { id: user._id, name: user.name },
    target: { id: user._id, type: 'user' },
    license: c.license,
    branchId: c.branchId,
    ip: req.ip,
    userAgent: req.get?.('user-agent'),
  });
  return { saved: true, reauthenticate: true };
}
module.exports = { get, update, password, self };
