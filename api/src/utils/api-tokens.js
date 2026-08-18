'use strict';
/*
 * Scoped API tokens (INTEGRATION_PLATFORM_ARCHITECTURE step 2).
 *
 * A token is a headless caller with EXACTLY the permissions it was minted
 * with - the same ACL matrix shape the whole API already enforces, so
 * checkPermission and every route gate work unchanged. Least privilege by
 * construction: scopes are whitelisted per module, till actions
 * (access.pos) can never be granted to a token, and the plaintext is shown
 * once at mint and stored only as a SHA-256 hash.
 *
 * The token principal carries the minting admin's license and branch
 * access, so tenant context resolves exactly as it does for a signed-in
 * user - one authentication join point (continueWithTenant), audited once.
 */

const crypto = require('crypto');

const COLLECTION = 'api_tokens';
const PREFIX = 'posnic_';

/* The ACL modules a token may be scoped to. Deliberately NOT including
   pos (till actions), plan, or setting - integrations read and write
   business records; they do not approve refunds or rewire the shop. */
const MODULES = Object.freeze([
  'sales',
  'item',
  'customer',
  'supplier',
  'category',
  'receiving',
  'expense',
  'branch',
  'user',
  'report',
  'dashboard',
]);
const PERMS = Object.freeze(['read', 'write', 'delete']);

function generateToken() {
  return PREFIX + crypto.randomBytes(24).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function tokenHint(token) {
  return String(token).slice(0, PREFIX.length + 6) + '…';
}

/**
 * Whitelist in, matrix out. Unknown modules and unknown permissions are
 * dropped silently; a scope set that grants nothing is refused - a token
 * that can do nothing is a mistake, not a credential.
 */
function sanitizeScopes(input) {
  const out = {};
  let granted = 0;
  if (input && typeof input === 'object') {
    for (const module of MODULES) {
      const src = input[module];
      if (!src || typeof src !== 'object') continue;
      const entry = {};
      for (const perm of PERMS) {
        entry[perm] = src[perm] === true;
        if (entry[perm]) granted++;
      }
      out[module] = entry;
    }
  }
  return granted > 0 ? out : null;
}

/** Mint. Returns the plaintext exactly once; the store keeps the hash. */
async function createToken(db, { name, scopes, creator }) {
  const clean = sanitizeScopes(scopes);
  if (!clean) return { ok: false, reason: 'scopes must grant at least one permission' };
  if (!creator || !creator.license) return { ok: false, reason: 'no shop context' };

  const token = generateToken();
  const row = {
    name: String(name || 'API token').slice(0, 80),
    token_hash: hashToken(token),
    token_hint: tokenHint(token),
    access: clean,
    usertype: 'api',
    license: creator.license,
    branch_access: creator.branch_access || [],
    created_by: String(creator._id || ''),
    createdAt: new Date(),
    last_used_at: null,
    active: true,
  };
  const r = await db.collection(COLLECTION).insertOne(row);
  return { ok: true, id: r.insertedId, token, hint: row.token_hint };
}

async function listTokens(db) {
  return db
    .collection(COLLECTION)
    .find({}, { projection: { token_hash: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
}

async function revokeToken(db, id) {
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(String(id))) return { ok: false };
  const r = await db
    .collection(COLLECTION)
    .updateOne(
      { _id: new ObjectId(String(id)) },
      { $set: { active: false, revokedAt: new Date() } }
    );
  return { ok: r.matchedCount === 1 };
}

const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Bearer token -> principal, or null. Fail closed: anything short of an
 * active row with a matching hash is null, and the caller must 401.
 * The principal is shaped like a lean user document so continueWithTenant
 * and every downstream consumer treat it as any other authenticated caller.
 */
async function resolveScopedToken(db, token) {
  if (!db || typeof token !== 'string' || !token.startsWith(PREFIX)) return null;
  const row = await db
    .collection(COLLECTION)
    .findOne({ token_hash: hashToken(token), active: true });
  if (!row) return null;

  const now = Date.now();
  if (!row.last_used_at || now - new Date(row.last_used_at).getTime() > LAST_USED_THROTTLE_MS) {
    db.collection(COLLECTION)
      .updateOne({ _id: row._id }, { $set: { last_used_at: new Date() } })
      .catch(() => {});
  }

  return {
    _id: row._id,
    id: String(row._id),
    username: 'token:' + row.name,
    usertype: 'api',
    access: row.access,
    license: row.license,
    branch_access: row.branch_access || [],
    active: 'yes',
    api_token: true,
  };
}

module.exports = {
  COLLECTION,
  PREFIX,
  MODULES,
  PERMS,
  generateToken,
  hashToken,
  tokenHint,
  sanitizeScopes,
  createToken,
  listTokens,
  revokeToken,
  resolveScopedToken,
};
