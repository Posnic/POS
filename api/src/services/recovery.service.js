'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const codes = require('../utils/recovery-codes');
const { recordAudit } = require('../utils/audit-trail');
const { passwordMatches } = require('../utils/password-match');

const INVALID = 'The account or recovery code is incorrect, already used, or replaced.';
function failure(message, status = 400) {
  return Object.assign(new Error(message), { statusCode: status });
}
function owner(user) {
  return (
    user && user.usertype === 'super_admin' && user.activate === true && user.isActive !== false
  );
}
function guard() {
  if (!codes.enabled())
    throw failure('Offline recovery is available only for a local Community installation.', 404);
}
function id(value) {
  if (!ObjectId.isValid(value)) throw failure('Please sign in again.', 401);
  return new ObjectId(String(value));
}
async function status(db, userId) {
  guard();
  const user = await db.collection('users').findOne({ _id: id(userId) });
  if (!owner(user)) return { eligible: false };
  return {
    eligible: true,
    remaining: (user.localRecovery?.hashes || []).length,
    createdAt: user.localRecovery?.createdAt || null,
  };
}
async function generate(db, userId, password, audit = {}) {
  guard();
  const users = db.collection('users');
  const user = await users.findOne({ _id: id(userId) });
  if (!owner(user)) throw failure('Only the shop owner can manage recovery codes.', 403);
  if (!(await passwordMatches(password, user.password)))
    throw failure('Your current password is incorrect.', 403);
  const batch = codes.createBatch();
  const result = await users.updateOne(
    {
      _id: user._id,
      password: user.password,
      activate: true,
      isActive: { $ne: false },
      usertype: 'super_admin',
    },
    { $set: { localRecovery: batch.record } }
  );
  if (result.modifiedCount !== 1)
    throw failure('The account changed. Sign in again before creating recovery codes.', 409);
  await recordAudit(db, {
    ...audit,
    event: 'recovery_codes_replaced',
    target: { id: String(user._id), type: 'user', name: user.email },
  });
  return { recoveryCodes: batch.codes, recoveryAccount: user.email || user.username };
}
async function reset(db, input = {}, audit = {}) {
  guard();
  const { account, recoveryCode, newPassword, confirmPassword } = input;
  if (
    typeof account !== 'string' ||
    account.trim().length < 3 ||
    account.length > 250 ||
    !codes.normalize(recoveryCode)
  )
    throw failure(INVALID);
  // Match the existing till password policy and bcrypt(base64(password))
  // consumers. Reject overlong UTF-8 input rather than silently truncating it.
  if (
    typeof newPassword !== 'string' ||
    newPassword.length < 8 ||
    newPassword.length > 20 ||
    newPassword !== newPassword.trim()
  ) {
    throw failure('Use 8-20 characters, without spaces at the beginning or end.');
  }
  if (Buffer.byteLength(Buffer.from(newPassword).toString('base64')) > 72) {
    throw failure('This password is too long when encoded. Use fewer characters.');
  }
  if (newPassword !== confirmPassword) throw failure('The two passwords do not match.');
  const hash = codes.digest(recoveryCode);
  const users = db.collection('users');
  const filter = {
    $or: [{ email: account.trim() }, { username: account.trim() }],
    usertype: 'super_admin',
    activate: true,
    isActive: { $ne: false },
    'localRecovery.hashes': hash,
  };
  const user = await users.findOne(filter);
  if (!user) throw failure(INVALID);
  const password = await bcrypt.hash(Buffer.from(newPassword).toString('base64'), 12);
  const now = new Date();
  // Consume and change the password in ONE document write: two simultaneous
  // submissions of the same code cannot both reset the account.
  const result = await users.updateOne(
    { ...filter, _id: user._id },
    {
      $set: {
        password,
        passwordChangedAt: now,
        updated_date: now,
        userkey: crypto.randomBytes(32).toString('hex'),
      },
      $inc: { authVersion: 1 },
      $pull: { 'localRecovery.hashes': hash },
      $unset: { passwordResetToken: '', passwordResetExpires: '', expire_date: '' },
    }
  );
  if (result.modifiedCount !== 1) throw failure(INVALID);
  await recordAudit(db, {
    ...audit,
    event: 'password_reset',
    target: { id: String(user._id), type: 'user', name: user.email },
    extra: { source: 'offline_recovery_code' },
  });
  return {
    message:
      'Password reset. Sign in with your new password. This recovery code can no longer be used.',
  };
}

module.exports = { status, generate, reset, passwordMatches, INVALID };
