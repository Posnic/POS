'use strict';

function validateIdentity(identity) {
  if (!identity || typeof identity.tenantDb !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(identity.tenantDb)
      || !Array.isArray(identity.branchIds) || identity.branchIds.length > 10000
      || !identity.branchIds.every((id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id))) {
    throw new Error('Could not verify the cloud shop. Please retry.');
  }
  return { tenantDb: identity.tenantDb, branchIds: identity.branchIds };
}

function assertSameShop({ identity, savedTenant, localBranchIds, userCount, businessDataCount = 0 }) {
  const verified = validateIdentity(identity);
  const refusal = 'This computer contains data for another or unlinked local shop. Connection stopped to protect your data. Back up this shop and contact support to migrate it; accounts are never merged automatically.';
  if (savedTenant && savedTenant !== verified.tenantDb) throw new Error(refusal);
  if (localBranchIds.length) {
    const cloud = new Set(verified.branchIds);
    if (localBranchIds.some((id) => !cloud.has(String(id)))) throw new Error(refusal);
  } else if (!savedTenant && (userCount > 0 || businessDataCount > 0)) throw new Error(refusal);
  return verified;
}

module.exports = { assertSameShop, validateIdentity };
