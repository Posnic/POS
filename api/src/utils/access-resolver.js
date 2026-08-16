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

module.exports = { resolveAccess };
