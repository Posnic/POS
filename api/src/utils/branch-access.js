'use strict';
const { ObjectId } = require('mongodb');
const fail = (message, status = 422) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const owner = (u) =>
  ['owner', 'admin', 'super_admin', 'superadmin', 'manager', 'store_manager'].includes(
    String(u.usertype || u.role).toLowerCase()
  );
const allowed = (u, module, action = 'write') => owner(u) || u.access?.[module]?.[action] === true;
async function context(req) {
  const t = req.tenantContext;
  if (!t?.branchId || !t?.licenseId) fail('Choose a branch first.', 403);
  const branchId = new ObjectId(String(t.branchId)),
    license = new ObjectId(String(t.licenseId));
  const branch = await req.db.collection('branches').findOne({ _id: branchId, license });
  if (!branch) fail('Branch not found.', 403);
  return { branch, branchId, license };
}
module.exports = { allowed, fail, context };
