// src/utils/access-resolver.js
//
// Single source of truth for a user's EFFECTIVE access matrix
// (modules → {read, write, delete} + dashboard.financials + plan.read).
//
// TODAY this is just the per-user `access` object stored on the user document,
// so this function is behaviour-identical to the previous inline
// `user.access || user._doc.access`.
//
// This is the SEAM for Phase 1 (roles / permission groups): once reusable roles
// exist, the resolution — merge the assigned role(s) `access` with any per-user
// `access_overrides` — happens HERE, so the ~150 `checkPermission` call-sites
// never change. Keeping the resolution in one place is the whole point.

/**
 * Resolve the effective access matrix for a user.
 * @param {Object} user - the request user (plain object or Mongoose-style _doc)
 * @returns {Object} the access matrix (never null)
 */
function resolveAccess(user) {
  if (!user) return {};
  // Support both plain objects and Mongoose docs, matching the prior behaviour.
  const access = user.access || (user._doc && user._doc.access);
  return access || {};
}

/**
 * Merge a role's access matrix with a user's per-user overrides.
 *
 * Phase 1 assignment model is "one role + per-user tweaks": a user's EFFECTIVE
 * access = the role's `access`, with any leaf in `access_overrides` winning.
 * This is computed at WRITE time (when the role/user changes) and stored back on
 * `user.access`, so `resolveAccess` (and the ~150 checkPermission call-sites)
 * keep reading a plain resolved object with no per-request role lookup.
 *
 * Merge is two levels deep: module → { read, write, delete, financials, ... }.
 * Leaves present in `overrides` replace those in `base`; other leaves are kept.
 *
 * @param {Object} base       the role's access matrix
 * @param {Object} overrides  the user's access_overrides (may be empty/undefined)
 * @returns {Object} the effective access matrix (new object; inputs untouched)
 */
function mergeAccess(base, overrides) {
  const b = base && typeof base === 'object' ? base : {};
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const out = {};
  const modules = new Set([...Object.keys(b), ...Object.keys(o)]);
  modules.forEach((m) => {
    const bm = b[m] && typeof b[m] === 'object' ? b[m] : {};
    const om = o[m] && typeof o[m] === 'object' ? o[m] : {};
    out[m] = { ...bm, ...om };
  });
  return out;
}

module.exports = { resolveAccess, mergeAccess };
