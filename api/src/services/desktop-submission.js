'use strict';
const crypto = require('crypto');
const fingerprint = require('../utils/order-request-fingerprint');
const { ensureIndexOnce } = require('../db/ensure-index');
const { fail } = require('../utils/branch-access');
function identity(scope, actor, payload) {
  if (!actor || typeof payload.idempotencyKey !== 'string' || !payload.idempotencyKey.trim())
    fail('An order request ID and staff identity are required.');
  return (
    'desktop-sale-' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify([String(scope.branchId), String(actor), payload.idempotencyKey]))
      .digest('hex')
  );
}
async function lookup(db, scope, actor, payload) {
  const saved = await db.collection('sales').findOne({
    license: scope.license,
    branch_id: scope.branchId,
    idempotency_key: identity(scope, actor, payload),
  });
  if (saved && saved.submission_payload_hash !== fingerprint(payload))
    fail('Resolve the previous submission before sending changes.', 409);
  return saved;
}
async function prepare(db, scope, actor, payload, document) {
  const request = identity(scope, actor, payload);
  await ensureIndexOnce(
    db.collection('sales'),
    { license: 1, idempotency_key: 1 },
    {
      unique: true,
      partialFilterExpression: { idempotency_key: { $type: 'string' } },
      name: 'unique_idempotency_key_per_license',
    }
  );
  const saved = await lookup(db, scope, actor, payload);
  if (saved) return saved;
  document.idempotency_key = request;
  document.submission_payload_hash = fingerprint(payload);
  return null;
}
module.exports = { prepare, lookup };
