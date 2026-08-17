// src/utils/approval-token.util.js
//
// Short-lived, stateless proof that a manager approved a specific cashier for a
// specific restricted action. The manager-approval endpoints mint one on a
// successful PIN/card check; the acting endpoint (void/refund) verifies it so
// the gate is enforced server-side, not just in the UI.
//
// It is an HMAC-signed payload (no DB round-trip). Bound to action + cashier and
// expires quickly, so it can't be reused for a different action/person or later.

const crypto = require('crypto');
const { currentSecret } = require('../db/tenant-context');

// Signing key, resolved per call so a process serving several shops signs each
// shop's approvals with that shop's own JWT_SECRET - a token minted in one shop
// must never verify in another. Standalone falls back to the environment (the
// app's auth already requires JWT_SECRET, so it is present and identical across
// the dual-process deployment). The random fallback is only reached in
// single-process dev/test where no env secret is set - never a hard-coded
// secret, and unforgeable.
const DEV_FALLBACK = crypto.randomBytes(32).toString('hex');
const secret = () => currentSecret('JWT_SECRET', process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || DEV_FALLBACK);
// 5 minutes: long enough that a refund approved when the return screen opens is
// still valid when the cashier finishes and submits, short enough to limit reuse.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Sign an approval. `payload` should carry at least { action, cashier_user_id }.
 * An `exp` (epoch ms) is added if absent. Returns "body.signature".
 */
function signApproval(payload = {}, ttlMs = DEFAULT_TTL_MS) {
  const body = { ...payload };
  if (!body.exp) body.exp = Date.now() + ttlMs;
  const bodyStr = b64(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret()).update(bodyStr).digest('base64url');
  return `${bodyStr}.${sig}`;
}

/**
 * Verify a token's signature + expiry and return its payload, or null if the
 * token is missing, malformed, tampered, or expired.
 */
function verifyApproval(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [bodyStr, sig] = token.split('.');
  if (!bodyStr || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(bodyStr).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyStr, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || (payload.exp && Date.now() > payload.exp)) return null;
  return payload;
}

/**
 * True if `token` is a valid approval for this exact action + cashier. This is
 * the check the acting endpoint (void/refund) makes.
 */
function isApprovedFor(token, action, cashierUserId) {
  const payload = verifyApproval(token);
  if (!payload) return false;
  if (String(payload.action) !== String(action)) return false;
  if (cashierUserId && String(payload.cashier_user_id) !== String(cashierUserId)) return false;
  return true;
}

module.exports = { signApproval, verifyApproval, isApprovedFor, DEFAULT_TTL_MS };
