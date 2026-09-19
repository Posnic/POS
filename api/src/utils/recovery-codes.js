'use strict';

const crypto = require('crypto');
const { resolveMode } = require('./runtime-info');
const { isMultiTenant } = require('../db/tenant-context');

function enabled(env = process.env) {
  return !isMultiTenant() && resolveMode(env) !== 'cloud' && env.POSNIC_SYNC_PAIRED !== '1';
}

function normalize(code) {
  if (typeof code !== 'string' || code.length > 80) return null;
  const value = code.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-F0-9]{32}$/.test(value) ? value : null;
}

function digest(code) {
  const value = normalize(code);
  return value
    ? crypto
        .createHash('sha256')
        .update('posnic:recovery:v1:' + value)
        .digest('hex')
    : null;
}

// Each code contains 128 random bits. Only digests are kept by the shop.
// Codes remain valid until used or replaced; expiring an emergency sheet
// silently would strand an offline shop again.
function createBatch(now = new Date()) {
  const codes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-')
  );
  return { codes, record: { hashes: codes.map(digest), createdAt: now } };
}

module.exports = { enabled, normalize, digest, createBatch };
