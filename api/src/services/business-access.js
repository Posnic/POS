'use strict';

const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { resolveAccess } = require('../utils/access-resolver');
const { version } = require('../utils/auth-version');
const { passwordMatches } = require('../utils/password-match');
const opaque = () => crypto.randomBytes(32).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const proof = (value) => crypto.createHash('sha256').update(value).digest('base64url');
const validOpaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const REQUEST_MS = 10 * 60_000;
const SESSION_MS = 30 * 24 * 60 * 60_000;
const indexes = new WeakMap();
function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}
function active(user, now) {
  return (
    user &&
    user.activate === true &&
    user.isActive !== false &&
    !user.disabled &&
    !(Number(user.lockUntil) > now) &&
    !(
      user.accountLocked &&
      (!user.accountLockedUntil || new Date(user.accountLockedUntil).getTime() > now)
    )
  );
}
function capabilities(user) {
  const access = resolveAccess(user);
  const owner = ['admin', 'super_admin'].includes(user.usertype || user.role);
  const financials =
    owner || (access.dashboard?.read === true && access.dashboard?.financials === true);
  return [
    ...(require('./business-decision-policy').remoteDiscountPolicy(user)
      ? ['approvals.read', 'discounts.approve']
      : []),
    ...(owner ? ['reporting.manage'] : []),
    ...(financials ? ['overview.read', 'tenders.read'] : []),
    ...((owner || access.item?.read === true) && financials ? ['items.read'] : []),
    ...(owner || access.item?.read === true ? ['stock.read'] : []),
    'notifications.self.manage',
  ];
}
function branchInfo(branch) {
  const currency = /^[A-Z]{3}$/.test(branch.currency || '')
    ? branch.currency
    : branch.currency_value?.[0]?.currency_text;
  if (!/^[A-Z]{3}$/.test(currency || '') || !branch.time_zone)
    fail('branch_configuration_required', 409);
  let currencyDigits;
  try {
    currencyDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits;
    new Intl.DateTimeFormat('en', { timeZone: branch.time_zone }).format();
  } catch {
    fail('branch_configuration_required', 409);
  }
  return {
    id: String(branch._id),
    name: branch.branch_name,
    currency,
    currencyDigits,
    timezone: branch.time_zone,
  };
}

function createBusinessAccess(db, { now = Date.now } = {}) {
  const requests = db.collection('business_authorizations');
  const sessions = db.collection('business_sessions');
  async function ready() {
    if (!indexes.has(db)) {
      const promise = Promise.all([
        requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        sessions.createIndex({ tokenHash: 1 }, { unique: true }),
        sessions.createIndex({ license: 1, userId: 1 }),
      ]).catch((error) => {
        indexes.delete(db);
        throw error;
      });
      indexes.set(db, promise);
    }
    await indexes.get(db);
  }
  async function userFor(row) {
    const user = await db.collection('users').findOne({ _id: row.userId, license: row.license });
    if (
      !active(user, now()) ||
      version(user) !== row.authVersion ||
      (user.passwordChangedAt &&
        new Date(user.passwordChangedAt).getTime() > row.issuedAt.getTime())
    )
      fail('session_revoked', 401);
    return user;
  }
  async function contextFor(user) {
    if (!active(user, now()) || !ObjectId.isValid(user.license)) fail('access_denied', 403);
    // Explicit branch membership applies even to an owner. No role grants all branches.
    const ids = [...new Set((user.branch_access || []).map((b) => String(b.branch_id)))];
    if (ids.length > 100 || ids.some((id) => !ObjectId.isValid(id)))
      fail('branch_configuration_required', 409);
    const branches = ids.length
      ? await db
          .collection('branches')
          .find(
            {
              _id: { $in: ids.map((id) => new ObjectId(id)) },
              license: user.license,
            },
            { projection: { branch_name: 1, currency: 1, currency_value: 1, time_zone: 1 } }
          )
          .sort({ branch_name: 1, _id: 1 })
          .limit(100)
          .toArray()
      : [];
    return {
      accountId: String(user._id),
      businessId: String(user.license),
      businessName: String(user.business_name || 'Your business'),
      branches: branches.map(branchInfo),
      capabilities: capabilities(user),
    };
  }
  async function pending(request) {
    if (!validOpaque(request)) fail('invalid_request');
    const row = await requests.findOne({
      _id: hash(request),
      status: 'pending',
      expiresAt: { $gt: new Date(now()) },
    });
    if (!row) fail('request_expired', 410);
    return row;
  }
  async function authenticate(token) {
    await ready();
    if (typeof token !== 'string' || !/^pb1_[A-Za-z0-9_-]{43}$/.test(token))
      fail('sign_in_required', 401);
    const session = await sessions.findOne({
      tokenHash: hash(token),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date(now()) },
    });
    if (!session) fail('sign_in_required', 401);
    return { session, user: await userFor(session) };
  }
  return {
    pending,
    contextFor,
    authenticate,
    async sessionIdentity(id) {
      if (!validOpaque(id)) fail('sign_in_required', 401);
      const session = await sessions.findOne({
        _id: id,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date(now()) },
      });
      if (!session) fail('sign_in_required', 401);
      return { session, user: await userFor(session) };
    },
    async request(body) {
      if (body?.stepUp !== undefined && typeof body.stepUp !== 'boolean') fail('invalid_request');
      if (
        !validOpaque(body.codeChallenge) ||
        typeof body.deviceName !== 'string' ||
        !body.deviceName.trim() ||
        body.deviceName.length > 80
      )
        fail('invalid_request');
      await ready();
      const request = opaque();
      await requests.insertOne({
        _id: hash(request),
        codeChallenge: body.codeChallenge,
        deviceName: body.deviceName.trim(),
        stepUp: body.stepUp === true,
        status: 'pending',
        createdAt: new Date(now()),
        expiresAt: new Date(now() + REQUEST_MS),
      });
      return { request, expiresIn: REQUEST_MS / 1000, interval: 5 };
    },
    async decide(request, decision, identifier, password) {
      const row = await pending(request);
      if (!['allow', 'deny'].includes(decision)) fail('invalid_request');
      let user;
      if (decision === 'allow') {
        if (
          typeof identifier !== 'string' ||
          !identifier.trim() ||
          identifier.length > 254 ||
          typeof password !== 'string' ||
          password.length > 256
        )
          fail('invalid_credentials', 401);
        const input = identifier.trim();
        user = await db
          .collection('users')
          .findOne({ $or: [{ email: input.toLowerCase() }, { username: input }] });
        if (!active(user, now()) || !(await passwordMatches(password, user.password)))
          fail('invalid_credentials', 401);
        const context = await contextFor(user);
        if (!context.branches.length || !context.capabilities.some((c) => c.endsWith('.read')))
          fail('access_denied', 403);
      }
      const result = await requests.updateOne(
        { _id: row._id, status: 'pending', expiresAt: { $gt: new Date(now()) } },
        {
          $set: {
            status: decision === 'allow' ? 'approved' : 'denied',
            ...(user
              ? {
                  userId: user._id,
                  license: user.license,
                  authVersion: version(user),
                  issuedAt: new Date(now()),
                }
              : {}),
          },
        }
      );
      if (!result.modifiedCount) fail('request_already_handled', 409);
      return { status: decision === 'allow' ? 'approved' : 'denied' };
    },
    async exchange(request, verifier) {
      await ready();
      if (!validOpaque(request) || !validOpaque(verifier)) fail('invalid_request');
      const filter = {
        _id: hash(request),
        codeChallenge: proof(verifier),
        expiresAt: { $gt: new Date(now()) },
      };
      const row = await requests.findOne(filter);
      if (!row) fail('request_expired', 410);
      if (row.status === 'pending') fail('authorization_pending', 202);
      if (row.status !== 'approved') fail('access_denied', 403);
      const user = await userFor(row);
      const context = await contextFor(user);
      if (!context.branches.length || !context.capabilities.some((c) => c.endsWith('.read')))
        fail('access_denied', 403);
      const claimed = await requests.updateOne(
        { ...filter, status: 'approved' },
        { $set: { status: 'consumed' } }
      );
      if (!claimed.modifiedCount) fail('access_denied', 403);
      const token = 'pb1_' + opaque(),
        expiresAt = new Date(now() + (row.stepUp === true ? 10 * 60_000 : SESSION_MS));
      await sessions.insertOne({
        _id: opaque(),
        tokenHash: hash(token),
        userId: user._id,
        license: user.license,
        authVersion: version(user),
        deviceName: row.deviceName,
        issuedAt: new Date(now()),
        authenticatedAt:
          row.authorization === 'cloud-browser' ? row.authenticatedAt || null : row.issuedAt,
        expiresAt,
      });
      return { token, expiresAt: expiresAt.toISOString(), context };
    },
    async context(token) {
      return contextFor((await authenticate(token)).user);
    },
    async rotate(token) {
      const { session, user } = await authenticate(token);
      const context = await contextFor(user);
      const next = 'pb1_' + opaque();
      // Rotation does not extend the absolute thirty-day browser-consent lifetime.
      const updated = await sessions.updateOne(
        {
          _id: session._id,
          tokenHash: hash(token),
          revokedAt: { $exists: false },
          expiresAt: { $gt: new Date(now()) },
        },
        { $set: { tokenHash: hash(next), rotatedAt: new Date(now()) } }
      );
      if (!updated.modifiedCount) fail('sign_in_required', 401);
      return { token: next, expiresAt: session.expiresAt.toISOString(), context };
    },
    async revoke(token, id) {
      const { session } = await authenticate(token);
      if (id !== undefined && !validOpaque(id)) fail('invalid_request');
      await sessions.updateOne(
        { _id: id || session._id, userId: session.userId, license: session.license },
        { $set: { revokedAt: new Date(now()) } }
      );
      return { revoked: true };
    },
    async listSessions(token) {
      const { session } = await authenticate(token);
      return sessions
        .find(
          {
            userId: session.userId,
            license: session.license,
            revokedAt: { $exists: false },
            expiresAt: { $gt: new Date(now()) },
          },
          { projection: { deviceName: 1, issuedAt: 1, expiresAt: 1 } }
        )
        .sort({ issuedAt: -1 })
        .limit(100)
        .toArray()
        .then((rows) =>
          rows.map((row) => ({
            id: row._id,
            name: row.deviceName,
            issuedAt: row.issuedAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            current: row._id === session._id,
          }))
        );
    },
  };
}
module.exports = {
  createBusinessAccess,
  capabilities,
  branchInfo,
  opaque,
  hash,
  proof,
  validOpaque,
  REQUEST_MS,
  SESSION_MS,
};
