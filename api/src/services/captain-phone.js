'use strict';
const crypto = require('crypto');
const { self } = require('./captain-profile');
const { fail } = require('../utils/branch-access');
const messaging = require('./messaging.service');
const digest = (id, code) =>
  crypto
    .createHash('sha256')
    .update(id + ':' + code)
    .digest('hex');
const key = (c, user) => String(c.license) + ':' + String(user._id);

async function start(req) {
  const { c, user, filter } = await self(req);
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/[ ()-]/g, '') : '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail('Enter a phone number with country code.');
  const collection = req.db.collection('captain_phone_verifications');
  const id = key(c, user),
    now = new Date();
  // A unique per-user record makes the resend limit atomic across API processes.
  try {
    await collection.updateOne(
      { _id: id },
      { $setOnInsert: { nextSendAt: new Date(0) } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const challenge = crypto.randomUUID(),
    code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + 10 * 60000);
  const reserved = await collection.updateOne(
    {
      _id: id,
      nextSendAt: { $lte: now },
      $or: [{ state: { $ne: 'applying' } }, { expiresAt: { $lte: now } }],
    },
    {
      $set: {
        challenge,
        phone,
        previousPhone: user.phone || '',
        branchId: c.branchId,
        codeHash: digest(challenge, code),
        expiresAt,
        attempts: 0,
        state: 'sending',
        nextSendAt: new Date(now.getTime() + 60000),
      },
    }
  );
  if (!reserved.matchedCount) fail('Wait before requesting another code.', 429);
  try {
    const marked = await req.db.collection('users').updateOne({
      ...filter,
      phone: user.phone || { $in: [null, ''] },
      phone_verification_id: user.phone_verification_id ?? { $exists: false },
    }, { $set: { phone_verification_id: challenge } });
    if (!marked.matchedCount) fail('Your account changed. Sign in again.', 409);
    const sent = await messaging.sendSms(
      c.branchId,
      phone,
      'Your Posnic verification code is ' + code + '. It expires in 10 minutes.'
    );
    if (!sent?.ok) throw new Error('sms_failed');
    const ready = await collection.updateOne(
      { _id: id, challenge, state: 'sending' },
      { $set: { state: 'ready' } }
    );
    if (!ready.matchedCount) fail('Request a new verification code.', 409);
  } catch {
    await collection.updateOne(
      { _id: id, challenge },
      { $set: { state: 'failed' }, $unset: { codeHash: '' } }
    );
    fail('Could not send the code. Check SMS settings or try again later.', 503);
  }
  return { challenge, expiresAt: expiresAt.toISOString(), retryAfter: 60 };
}

async function verify(req) {
  const { c, user, filter } = await self(req);
  const { challenge, code } = req.body || {};
  if (typeof challenge !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code))
    fail('Enter the six-digit verification code.');
  const collection = req.db.collection('captain_phone_verifications');
  const selector = { _id: key(c, user), challenge, branchId: c.branchId };
  const current = await collection.findOne(selector);
  if (!current) fail('Request a new verification code.', 409);
  if (current.state === 'verified' && user.phone === current.phone && user.phone_verification_id === challenge)
    return { saved: true, phone: current.phone };
  if (current.state !== 'applying') {
    const reserved = await collection.updateOne(
      { ...selector, state: 'ready', expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } }
    );
    if (!reserved.matchedCount) fail('Request a new verification code.', 409);
  } else if (current.expiresAt <= new Date()) fail('Request a new verification code.', 409);
  const expected = Buffer.from(current.codeHash || '', 'hex'),
    actual = Buffer.from(digest(challenge, code), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual))
    fail('The verification code is incorrect.', 400);
  // Claim the challenge before changing the user; only one verifier may apply it.
  if (current.state !== 'applying') {
    const claimed = await collection.updateOne(
      { ...selector, state: 'ready', expiresAt: { $gt: new Date() } },
      { $set: { state: 'applying' } }
    );
    if (!claimed.matchedCount) fail('Request a new verification code.', 409);
  }
  const changed = await req.db
    .collection('users')
    .updateOne(
      { ...filter, phone_verification_id: challenge, phone: current.previousPhone || { $in: [null, ''] } },
      { $set: { phone: current.phone, phone_verified_at: new Date(), updated_date: new Date() } }
    );
  if (!changed.matchedCount) {
    const latest = await req.db.collection('users').findOne(filter);
    if (latest?.phone !== current.phone || latest?.phone_verification_id !== challenge) {
      await collection.updateOne(selector, { $set: { state: 'failed' }, $unset: { codeHash: '' } });
      fail('Your account changed. Sign in again.', 409);
    }
  }
  await collection.updateOne(selector, { $set: { state: 'verified' }, $unset: { codeHash: '' } });
  return { saved: true, phone: current.phone };
}
module.exports = { start, verify };
