"use strict";
const { ObjectId } = require('mongodb');
const runtime = require('./books-receipt-runtime');
const equal = require('node:util').isDeepStrictEqual;
function fail(code, status = 403) { throw Object.assign(new Error('Books receipt access is unavailable for this session.'), { code, status }); }
function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}
function identity(value) {
  return value instanceof ObjectId ? value.toHexString() : text(value, 128) ? value : null;
}
// Use only after POS authentication/tenant middleware. This is deliberately not
// a fallback that guesses shop/branch from body, headers or the first user branch.
async function resolve(req, permission) {
  if (!['read', 'write'].includes(permission)) fail('books_receipt_permission_required');
  const user = req?.user, tenant = req?.tenantContext;
  if (!user || !req.db || !tenant) fail('books_receipt_session_required', 401);
  const token = user.api_token === true;
  // Human confirmation records money. Scoped integrations may read evidence,
  // but cannot impersonate a cashier by passing actor fields in their payload.
  if (permission === 'write' && token) fail('books_receipt_cashier_required');
  const access = token ? user.access?.sales : user.access?.sale;
  if (access?.[permission] !== true) fail('books_receipt_forbidden');
  const license = tenant.licenseId, branchId = identity(tenant.branchId);
  if (!identity(license) || !branchId || !equal(user.license, license)) fail('books_receipt_scope_changed');
  if (!Array.isArray(user.branch_access)) fail('books_receipt_branch_access_invalid');
  if (user.branch_access.length && (!user.branch_access.every(row => identity(row?.branch_id)) ||
      !user.branch_access.some(row => identity(row.branch_id) === branchId))) fail('books_receipt_branch_forbidden');
  const actorId = identity(user._id), actorName = user.username || user.email;
  if (!actorId || !text(actorName, 80)) fail('books_receipt_actor_unavailable');
  const authority = await runtime.authority(req.app);
  return Object.freeze({ license, branchId, authority, actorId, actorName });
}
module.exports = { resolve };
