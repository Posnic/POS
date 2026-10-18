'use strict';

// Packages are host-wide executable code; installation approvals and business
// namespaces remain in each request's tenant database. Never pass the control
// database to the single-tenant activation queue from a shard.
async function applyQueued({ tenants, queue, options }) {
  const request = queue.read(options.root);
  if (!request) return;
  if (!/^[a-f0-9]{24}$/.test(request.license || '') || !/^[a-f0-9]{24}$/.test(request.branchId || ''))
    throw new Error('extension_install_scope_invalid');
  const { ObjectId } = require('mongodb');
  const unique = [...new Map([...tenants].map(t => [t.tenantDb, t])).values()];
  const matches = [];
  for (const tenant of unique) {
    if (!tenant.db || tenant.suspended) continue;
    if (await tenant.db.collection('branches').findOne({
      _id: new ObjectId(request.branchId), license: new ObjectId(request.license),
    })) matches.push(tenant);
  }
  if (matches.length !== 1) throw new Error('extension_install_tenant_ambiguous');
  // A global package upgrade needs an estate-wide migration, not a one-shop
  // activation. Refuse it while another tenant depends on the package.
  for (const tenant of unique) {
    if (tenant.tenantDb === matches[0].tenantDb || !tenant.db) continue;
    if (await tenant.db.collection('extension_installations').findOne({ extensionId: request.id, enabled: true }))
      throw new Error('extension_install_multi_tenant_upgrade_required');
  }
  await queue.apply({ ...options, db: matches[0].db });
}

async function start({ initialize, tenants = [], queue, options, log = console.error } = {}) {
  initialize ||= require('./extension-package-loader').initializeInstalledExtensions;
  try {
    if (process.env.POSNIC_EXTENSIONS_ROOT || options) {
      queue ||= require('./extension-install-queue');
      await applyQueued({ tenants, queue, options: options || queue.configuration() });
    }
    const result = await initialize({});
    for (const failure of result.failures || [])
      log('[EXTENSIONS] Package not activated:', failure.id || 'configuration', failure.code);
    return result.release;
  } catch (error) {
    log('[EXTENSIONS] Could not read installed packages:', error.code || error.message);
    return undefined;
  }
}

module.exports = { start, applyQueued };
