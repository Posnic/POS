'use strict';
const crypto = require('crypto');
// Only transport/approval fields are excluded. Item order, quantities, notes,
// payments and customer details remain part of the requested sale.
const transient = new Set(['idempotencyKey', 'approval_token', 'approval_tokens']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
module.exports = function fingerprint(payload) {
  if (payload === undefined) return null;
  const fields = Object.fromEntries(Object.entries(payload).filter(([key]) => !transient.has(key)));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(fields)))
    .digest('hex');
};
