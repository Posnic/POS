'use strict';
// Internal account-service API. Never expose issueSession to a body-supplied
// user ID. A verified account login must resolve the registry account first.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const deny = () => { throw Object.assign(new Error('registry_sign_in_required'), { status: 401 }); };
async function initializeSessions(db) {
  await db.collection('registry_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
async function issueSession(db, verifiedAccountId, { now = new Date() } = {}) {
  if (typeof verifiedAccountId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(verifiedAccountId)) deny();
  const account = await db.collection('registry_accounts').findOne({ _id: verifiedAccountId, status: 'active' });
  if (!account || !Number.isSafeInteger(account.authVersion) || account.authVersion < 0) deny();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  await db.collection('registry_sessions').insertOne({ _id: hash(token), accountId: account._id,
    authVersion: account.authVersion, createdAt: now, expiresAt });
  return { token, expiresAt };
}
async function authenticateSession(db, token, { now = new Date() } = {}) {
  if (!validToken(token)) deny();
  const session = await db.collection('registry_sessions').findOne({ _id: hash(token), expiresAt: { $gt: now } });
  if (!session) deny();
  const account = await db.collection('registry_accounts').findOne({ _id: session.accountId,
    status: 'active', authVersion: session.authVersion });
  if (!account) deny();
  // Read verified email from current account state, never cached token claims.
  return { id: account._id, emailVerified: account.emailVerified === true,
    ...(account.emailVerified === true && typeof account.email === 'string' ? { verifiedEmail: account.email } : {}) };
}
async function revokeSession(db, token) {
  if (!validToken(token)) return;
  await db.collection('registry_sessions').deleteOne({ _id: hash(token) });
}
function createRegistryAuthentication({ db, clock = () => new Date() } = {}) {
  if (!db) throw new Error('registry_database_required');
  return async function registryAuthentication(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    // Clear preexisting identity; only this verified session can supply it.
    delete req.libraryActor;
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    try {
      if (!match) deny();
      req.libraryActor = await authenticateSession(db, match[1], { now: clock() });
      next();
    } catch (error) {
      res.status(error.status === 401 ? 401 : 503).json({ error: 'Registry sign-in is required or unavailable.' });
    }
  };
}
module.exports = { initializeSessions, issueSession, authenticateSession, revokeSession, createRegistryAuthentication };
