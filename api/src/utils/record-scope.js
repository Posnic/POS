const { toObjectId, TenantContextError } = require('./tenant-context');

// Only accept authenticated/request-local context, never scope from a payload.
function scope(context, branch = true) {
  const license = toObjectId(context?.licenseId);
  const branchId = toObjectId(context?.branchId);
  if (!license || (branch && !branchId)) {
    throw new TenantContextError('Valid tenant context is required');
  }
  return branch ? { license, branch_id: branchId } : { license };
}
function requestScope(req, branch = true) {
  return scope(
    {
      licenseId: req.tenantContext?.licenseId || req.user?.license || req.user?.license_id,
      branchId: req.tenantContext?.branchId || req.user?.branch_id,
    },
    branch
  );
}
function currentScope(branch = true) {
  const context = require('./request-context').getRequestContext();
  return scope({ licenseId: context?.license, branchId: context?.currentBranch }, branch);
}
module.exports = { scope, requestScope, currentScope };
