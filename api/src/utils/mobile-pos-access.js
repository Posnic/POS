'use strict';

const { resolveAccess } = require('./access-resolver');

// Mobile uses the same effective role + per-user matrix as desktop. Unlike
// legacy desktop compatibility checks, an unconfigured staff account fails closed.
function allowed(user, module, action = 'write') {
  if (!user) return false;
  const role = String(user.usertype || user.role || '').toLowerCase();
  if (['owner', 'admin', 'super_admin'].includes(role)) return true;
  const access = resolveAccess(user);
  // Mobile setup changes branch configuration; use the existing editable
  // Branch permission rather than inventing an uneditable "settings" ACL.
  if (module === 'settings') module = 'branch';
  // Mobile has no manager-approval protocol: an approval-required action must
  // be completed at the till rather than silently treating it as approved.
  if (
    module === 'pos' &&
    Array.isArray(access.pos_manager_approval) &&
    access.pos_manager_approval.includes(action)
  )
    return false;
  return access[module]?.[action] === true;
}

function canProvisionOtherStaff(user) {
  return ['owner', 'admin', 'super_admin'].includes(
    String(user?.usertype || user?.role || '').toLowerCase()
  );
}

module.exports = { allowed, canProvisionOtherStaff };
