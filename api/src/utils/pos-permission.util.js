// src/utils/pos-permission.util.js
//
// Server-side check for a granular POS action (void/refund/discount/...). Mirrors
// the frontend PosnicPro.posCan: owner-class accounts always pass; otherwise the
// resolved access.pos matrix decides. Fails OPEN when a user has no pos matrix
// (a session/user from before roles were resolved) so nothing is unexpectedly
// blocked - enforcement only bites for explicitly-configured staff.

const MANAGER_TYPES = ['owner', 'admin', 'super_admin', 'manager', 'store_manager'];

function canPos(user, action) {
  if (!user) return true;
  const type = String(user.usertype || user.role || '').toLowerCase();
  if (MANAGER_TYPES.includes(type)) return true;
  const pos = user.access && user.access.pos;
  if (!pos || typeof pos !== 'object') return true; // fail open when unconfigured
  return pos[action] === true;
}

module.exports = { canPos };
