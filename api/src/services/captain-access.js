'use strict';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { allowed, context } = require('../utils/branch-access');
const authVersion = require('../utils/auth-version');
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const opaque = (v) => typeof v === 'string' && /^[\w-]{43}$/.test(v);
const oid = (v) => {
  if (!ObjectId.isValid(String(v))) fail('INVALID_REQUEST', 'Invalid identity.', 400);
  return new ObjectId(String(v));
};
function fail(code, message, status = 403) {
  throw Object.assign(new Error(message), {
    code,
    status,
    statusCode: status,
    isOperational: true,
  });
}
const feature = (b) => ![false, 0, '0', 'false'].includes(b.module_captain_enable);
const canOrder = (u) => allowed(u, 'sales');
const hasBranch = (u, b) =>
  String(u.branch_id) === String(b) ||
  u.branch_access?.some((v) => String(v.branch_id) === String(b));
async function principal(db, row) {
  const user = await db
    .collection('users')
    .findOne({ _id: oid(row.userId), license: oid(row.license), activate: true });
  const branch = await db
    .collection('branches')
    .findOne({ _id: oid(row.branchId), license: oid(row.license) });
  if (!user || !hasBranch(user, row.branchId) || !canOrder(user))
    fail('CAPTAIN_PERMISSION', 'This staff member cannot take orders in this branch.');
  if (!branch || !feature(branch))
    fail('CAPTAIN_DISABLED', 'Ask your manager to enable Captain in Features.');
  if (!authVersion.current(user, row))
    fail(
      'AUTH_CHANGED',
      'Your account changed. Ask your manager to connect this phone again.',
      401
    );
  return { user, branch };
}
async function createCode(req) {
  if (!allowed(req.user, 'settings')) fail('MANAGER_REQUIRED', 'Manager access is required.');
  const c = await context(req),
    userId = oid(req.body.staffId);
  const user = await req.db
    .collection('users')
    .findOne({ _id: userId, license: c.license, activate: true });
  if (!user) fail('CAPTAIN_PERMISSION', 'Choose an active staff member in this shop.');
  const row = {
    userId,
    branchId: c.branchId,
    license: c.license,
    authVersion: authVersion.version(user),
  };
  await principal(req.db, row);
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const enrolmentId = crypto.randomUUID(),
    expires = new Date(Date.now() + 5 * 60000);
  await req.db
    .collection('captain_pair_codes')
    .createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  await req.db
    .collection('captain_pair_codes')
    .insertOne({ _id: hash(code), ...row, enrolmentId, expires });
  return { code, enrolmentId, expires, staffName: user.username, branchName: c.branch.branch_name };
}
async function proof(req) {
  if (!/^[\w-]{36}$/.test(req.body.enrolmentId || '') || !opaque(req.body.nonce))
    fail('INVALID_REQUEST', 'Invalid request.', 400);
  const row = await req.db.collection('captain_pair_codes').findOne({
    enrolmentId: req.body.enrolmentId,
    expires: { $gt: new Date() },
    usedAt: { $exists: false },
  });
  if (!row) fail('PAIR_EXPIRED', 'This pairing request expired or was used.', 401);
  return { proof: crypto.createHmac('sha256', row._id).update(req.body.nonce).digest('hex') };
}
async function grant(req, row, user, branch, refreshToken) {
  req.handsetDevice = row.deviceId;
  req.captainSession = String(row._id);
  const { signLegacyToken } = require('../middleware/auth');
  return {
    token: signLegacyToken(user, req, row.branchId, 900),
    expiresIn: 900,
    refreshToken,
    sessionId: String(row._id),
    routeKey: row.routeKey,
    routes: routeTargets(req, branch),
    idempotentOrders: true,
    offlineUntil: row.offlineUntil,
    shopKey: hash(String(row.license)).slice(0, 16),
    user: { id: String(user._id), name: user.username || user.name || '' },
    branches: [
      {
        branch_id: String(branch._id),
        store_id: String(branch._id),
        branch_name: branch.branch_name,
        user_id: String(user._id),
      },
    ],
  };
}
async function pair(req) {
  const code = String(req.body.code || '')
    .replace(/[ -]/g, '')
    .toUpperCase();
  const device = require('../utils/handsets').deviceIdOf(req.body.device);
  if (!/^[A-F0-9]{12}$/.test(code) || !device)
    fail('INVALID_PAIR', 'Enter the code shown by your manager.', 401);
  const codes = req.db.collection('captain_pair_codes');
  const candidate = await codes.findOne({
    _id: hash(code),
    expires: { $gt: new Date() },
    usedAt: { $exists: false },
  });
  if (!candidate) fail('PAIR_EXPIRED', 'This pairing code expired or was already used.', 401);
  if (
    candidate.deviceId &&
    (candidate.deviceId !== device ||
      !opaque(req.body.codeVerifier) ||
      crypto.createHash('sha256').update(req.body.codeVerifier).digest('base64url') !==
        candidate.codeChallenge)
  )
    fail('INVALID_PAIR', 'This approval belongs to another phone.', 401);
  const { user, branch } = await principal(req.db, candidate);
  const consumed = await codes.findOneAndUpdate(
    { _id: candidate._id, usedAt: { $exists: false }, expires: { $gt: new Date() } },
    { $set: { usedAt: new Date(), claimedDevice: device } },
    { returnDocument: 'after' }
  );
  if (!consumed) fail('PAIR_EXPIRED', 'This pairing code was already used.', 401);
  const deviceId = 'captain-' + hash(device).slice(0, 40);
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const row = {
    _id: new ObjectId(),
    deviceId,
    installation: device,
    userId: user._id,
    branchId: branch._id,
    license: candidate.license,
    authVersion: authVersion.version(user),
    refreshHash: hash(refreshToken),
    expires: new Date(Date.now() + 30 * 86400000),
    offlineUntil: new Date(Date.now() + 24 * 3600000).toISOString(),
    revoked: false,
    routeKey: crypto.randomBytes(32).toString('hex'),
  };
  const sessions = req.db.collection('captain_sessions');
  await sessions.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  // Reapproval cannot revive an older stolen session for this installation.
  await sessions.updateMany({ deviceId }, { $set: { revoked: true } });
  await sessions.insertOne(row);
  const remembered = await require('../utils/handsets').remember(req.db, {
    device: { ...req.body.device, device_id: deviceId, app: 'captain' },
    user,
    branchId: branch._id,
    ip: req.ip,
  });
  if (remembered !== deviceId)
    fail(
      'DEVICE_STORAGE',
      'The till could not save this phone. Ask your manager for a new code.',
      503
    );
  return grant(req, row, user, branch, refreshToken);
}
async function refresh(req) {
  const b = req.body;
  if (!opaque(b.refreshToken) || !opaque(b.nextToken) || b.nextToken === b.refreshToken)
    fail('INVALID_SESSION', 'Connect this phone again.', 401);
  const rows = req.db.collection('captain_sessions'),
    id = oid(b.sessionId);
  const row = await rows.findOne({ _id: id, revoked: false, expires: { $gt: new Date() } });
  if (!row)
    fail(
      'DEVICE_REVOKED',
      'This device authorization ended. Ask your manager to reconnect it.',
      401
    );
  const handset = await req.db.collection('handsets').findOne({ device_id: row.deviceId });
  if (!handset || handset.revoked) fail('DEVICE_REVOKED', 'Your manager turned off this phone.');
  const { user, branch } = await principal(req.db, row);
  const current = hash(b.refreshToken),
    next = hash(b.nextToken);
  const changed = await rows.findOneAndUpdate(
    { _id: id, refreshHash: current, revoked: false },
    {
      $set: {
        refreshHash: next,
        previousHash: current,
        replayUntil: new Date(Date.now() + 60000),
        expires: new Date(Date.now() + 30 * 86400000),
        offlineUntil: new Date(Date.now() + 24 * 3600000).toISOString(),
      },
    },
    { returnDocument: 'after' }
  );
  if (changed) return grant(req, changed, user, branch, b.nextToken);
  // Exact retry only: the phone persists nextToken before the first request.
  const replay = await rows.findOne({
    _id: id,
    revoked: false,
    previousHash: current,
    refreshHash: next,
    replayUntil: { $gt: new Date() },
  });
  if (!replay) fail('INVALID_SESSION', 'The session changed. Connect this phone again.', 401);
  return grant(req, replay, user, branch, b.nextToken);
}

function routeTargets(req, branch) {
  const { pairingTargets, localAddresses } = require('../utils/pairing');
  const targets = pairingTargets(
    { host: req.headers?.host, port: req.socket?.localPort || process.env.PORT || 5555 },
    localAddresses()
  ).targets.map((t) => t.url);
  if (branch.captain_fallback_url) targets.push(branch.captain_fallback_url);
  return [...new Set(targets)].slice(0, 8);
}

// No bearer or renewal token is sent to an unverified address. The proof key
// is restricted to proving the issuing database and cannot authorize orders.
async function routeProof(req) {
  if (!opaque(req.body.nonce)) fail('INVALID_REQUEST', 'Invalid challenge.', 400);
  const row = await req.db.collection('captain_sessions').findOne({ _id: oid(req.body.sessionId) });
  if (!row?.routeKey)
    fail('UNKNOWN_AUTHORITY', 'This address cannot deliver orders for this session.', 404);
  return { proof: crypto.createHmac('sha256', row.routeKey).update(req.body.nonce).digest('hex') };
}
async function verifySession(req, user) {
  const row = await req.db.collection('captain_sessions').findOne({
    _id: oid(req.captainSession),
    userId: oid(user._id || user.id),
    deviceId: req.handsetDevice,
    revoked: false,
    expires: { $gt: new Date() },
  });
  if (!row) fail('DEVICE_REVOKED', 'This Captain session has been revoked.');
  const handset = await req.db.collection('handsets').findOne({ device_id: row.deviceId });
  if (!handset || handset.revoked) fail('DEVICE_REVOKED', 'Your manager turned off this phone.');
  if (
    String(req.tenantContext?.branchId) !== String(row.branchId) ||
    String(req.tenantContext?.licenseId) !== String(row.license)
  )
    fail('CAPTAIN_SCOPE', 'This phone is authorized for a different branch.');
  await principal(req.db, row);
  const path = (req.originalUrl || req.path)
    .split('?')[0]
    .replace(/^\/api/, '')
    .replace(/\/$/, '');
  if (
    !/^\/(captain\/v1\/(session|logout)|items\/(accessQr|aiAvailability|soldOut|instanceItemInsert)|sales\/(qrOrder|myDay|requestBillPrint|getTablesWithActiveOrders|getOrderHistory|updateOrder|getFrequentItems|pendingOnlineOrders|getListKot|[a-fA-F0-9]{24}\/(approval|print)|waiterCalls\/[^/]+\/seen|transcribe|voiceIntent))$/.test(
      path
    )
  )
    fail('CAPTAIN_SCOPE', 'This device is authorized for Captain only.');
}
module.exports = {
  createCode,
  proof,
  pair,
  routeProof,
  refresh,
  verifySession,
  principal,
  fail,
  hash,
  canOrder,
};
