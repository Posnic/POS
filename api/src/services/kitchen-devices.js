'use strict';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const version = require('../utils/auth-version');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const lifetime = 90 * 86400000;
async function manager(req) {
  if (!req.user || !allowed(req.user, 'settings')) fail('Manager access is required.', 403);
  return context(req);
}
async function create(req) {
  const c = await manager(req);
  const name = String(req.body.name || '')
    .trim()
    .slice(0, 60);
  if (!name) fail('Enter a name for this kitchen screen.', 400);
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const expires = new Date(Date.now() + 300000);
  const collection = req.db.collection('kitchen_device_codes');
  await collection.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  await collection.insertOne({
    _id: hash(code),
    name,
    branchId: c.branchId,
    license: c.license,
    manager: new ObjectId(String(req.user._id || req.user.id)),
    authVersion: version.version(req.user),
    expires,
  });
  return { code, expires, branch: c.branch.branch_name };
}
async function pair(req) {
  const code = String(req.body.code || '')
    .replace(/[ -]/g, '')
    .toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(code)) fail('Enter the pairing code from your manager.', 400);
  const codes = req.db.collection('kitchen_device_codes');
  const row = await codes.findOne({
    _id: hash(code),
    expires: { $gt: new Date() },
    used: { $ne: true },
  });
  if (!row) fail('Pairing code expired or already used.', 401);
  await principal(req.db, row);
  const result = await codes.updateOne(
    { _id: row._id, used: { $ne: true } },
    { $set: { used: true } }
  );
  if (!result.modifiedCount) fail('Pairing code was already used.', 409);
  const token = crypto.randomBytes(32).toString('base64url');
  await req.db.collection('kitchen_devices').insertOne({
    _id: hash(token),
    name: row.name,
    branchId: row.branchId,
    license: row.license,
    manager: row.manager,
    authVersion: row.authVersion,
    created: new Date(),
    expires: new Date(Date.now() + lifetime),
    revoked: false,
  });
  return { token, name: row.name };
}
async function principal(db, row) {
  const user = await db
    .collection('users')
    .findOne({ _id: row.manager, license: row.license, activate: true });
  if (!user || !allowed(user, 'settings') || !version.current(user, row))
    fail('Kitchen access ended. Ask your manager to pair this screen again.', 401);
  if (
    String(user.branch_id) !== String(row.branchId) &&
    !user.branch_access?.some((b) => String(b.branch_id) === String(row.branchId))
  )
    fail('The authorizing manager no longer has access to this branch.', 401);
  const branch = await db
    .collection('branches')
    .findOne({ _id: row.branchId, license: row.license });
  if (!branch) fail('Branch access ended.', 401);
}
async function authenticate(req) {
  const token = req.headers['x-kitchen-device'];
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) fail('Invalid kitchen device.', 401);
  const devices = req.db.collection('kitchen_devices');
  const row = await devices.findOne({
    _id: hash(token),
    revoked: false,
    expires: { $gt: new Date() },
  });
  if (!row) fail('Kitchen device disconnected. Ask your manager to pair it again.', 401);
  await principal(req.db, row);
  // Only the kitchen router accepts this header. It is not a POS login or a Captain credential.
  req.user = { _id: 'kitchen-' + row._id, name: row.name, access: { sales: { write: true } } };
  req.tenantContext = { branchId: row.branchId, licenseId: row.license };
  req.kitchenDevice = true;
  // Renew active devices without saving on every five-second read. Revocation is checked every time.
  if (row.expires.getTime() < Date.now() + lifetime - 86400000)
    await devices.updateOne(
      { _id: row._id, revoked: false },
      { $set: { expires: new Date(Date.now() + lifetime) } }
    );
}
async function list(req) {
  const c = await manager(req);
  const rows = await req.db
    .collection('kitchen_devices')
    .find(
      { branchId: c.branchId, license: c.license, revoked: false },
      { projection: { name: 1, created: 1, expires: 1 } }
    )
    .toArray();
  return {
    devices: rows.map((row) => ({
      id: row._id,
      name: row.name,
      created: row.created,
      expires: row.expires,
    })),
  };
}
async function revoke(req) {
  const c = await manager(req);
  if (!/^[a-f0-9]{64}$/.test(req.body.id || '')) fail('Invalid device.', 400);
  await req.db
    .collection('kitchen_devices')
    .updateOne(
      { _id: req.body.id, branchId: c.branchId, license: c.license },
      { $set: { revoked: true } }
    );
  return { revoked: true };
}
module.exports = { create, pair, authenticate, list, revoke };
