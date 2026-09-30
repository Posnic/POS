'use strict';
const crypto = require('crypto');
const { passwordMatches } = require('../utils/password-match');
const { self } = require('./captain-profile');
const { fail } = require('../utils/branch-access');
const mail = require('../utils/email');
const digest = (id, code) =>
  crypto
    .createHash('sha256')
    .update(id + ':' + code)
    .digest('hex');
const key = (c, user) => String(c.license) + ':' + String(user._id);

async function start(req) {
  const { c, user, filter } = await self(req);
  if (!(await passwordMatches(req.body?.currentPassword, user.password)))
    fail('The current password is incorrect.', 400);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))
    fail('Enter a valid email address.');
  if (await req.db.collection('users').findOne({ email, _id: { $ne: user._id } }))
    fail('This email address is unavailable.', 409);
  const collection = req.db.collection('captain_email_verifications');
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
        email,
        previousEmail: user.email || '',
        credentialHash: digest('credential', user.password),
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
    const marked = await req.db.collection('users').updateOne(
      {
        ...filter,
        email: user.email || { $in: [null, ''] },
        email_verification_id: user.email_verification_id ?? { $exists: false },
        password: user.password,
      },
      { $set: { email_verification_id: challenge } }
    );
    if (!marked.matchedCount) fail('Your account changed. Sign in again.', 409);
    const delivery = mail.resolveShopTransport(c.branch);
    if (delivery.transporter.options?.jsonTransport || require('../config/demo-mode').isDemoMode())
      throw new Error('email_delivery_unavailable');
    await delivery.transporter.sendMail({
      from: delivery.from,
      to: email,
      subject: 'Verify your Posnic email address',
      text: 'Your Posnic verification code is ' + code + '. It expires in 10 minutes.',
    });
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
    fail('Could not send the code. Check email settings or try again later.', 503);
  }
  return { challenge, expiresAt: expiresAt.toISOString(), retryAfter: 60 };
}

async function verify(req) {
  const { c, user, filter } = await self(req);
  const { challenge, code } = req.body || {};
  if (typeof challenge !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code))
    fail('Enter the six-digit verification code.');
  const collection = req.db.collection('captain_email_verifications');
  const selector = { _id: key(c, user), challenge, branchId: c.branchId };
  const current = await collection.findOne(selector);
  if (!current || current.credentialHash !== digest('credential', user.password))
    fail('Request a new verification code.', 409);
  if (
    current.state === 'verified' &&
    user.email === current.email &&
    user.email_verification_id === challenge
  )
    return { saved: true, email: current.email };
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
  if (await req.db.collection('users').findOne({ email: current.email, _id: { $ne: user._id } })) {
    await collection.updateOne(selector, { $set: { state: 'failed' }, $unset: { codeHash: '' } });
    fail('This email address is unavailable.', 409);
  }
  let changed;
  try {
    changed = await req.db.collection('users').updateOne(
      {
        ...filter,
        email_verification_id: challenge,
        password: user.password,
        email: current.previousEmail || { $in: [null, ''] },
      },
      {
        $set: {
          email: current.email,
          email_verified_at: new Date(),
          updated_date: new Date(),
          userkey: crypto.randomBytes(32).toString('hex'),
        },
        $unset: { passwordResetToken: '', passwordResetExpires: '', expire_date: '' },
      }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    await collection.updateOne(selector, { $set: { state: 'failed' }, $unset: { codeHash: '' } });
    fail('This email address is unavailable.', 409);
  }
  if (!changed.matchedCount) {
    const latest = await req.db.collection('users').findOne(filter);
    if (latest?.email !== current.email || latest?.email_verification_id !== challenge) {
      await collection.updateOne(selector, { $set: { state: 'failed' }, $unset: { codeHash: '' } });
      fail('Your account changed. Sign in again.', 409);
    }
  }
  await collection.updateOne(selector, { $set: { state: 'verified' }, $unset: { codeHash: '' } });
  return { saved: true, email: current.email };
}
module.exports = { start, verify };
