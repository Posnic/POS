'use strict';
// Process-local registry is populated only by the verified package loader at
// API startup. HTTP requests cannot register code or choose module paths.
const installed = new Map();
const capabilities = Object.freeze([
  'namespace.commands.v1',
  'stock.durable-debit.v1',
  'stock.lifecycle.v1',
  'sales.adjusted-quantity.v1',
  'payments.verified-result.v1',
  'receipts.normal-template.v1',
  'catalog.command-selection.v1',
  'sales.paged-history.v1',
]);
function get(extensionId) {
  return installed.get(extensionId) || null;
}
function registerVerified(descriptor, packageDigest) {
  if (
    !descriptor ||
    !/^[a-z][a-z0-9.-]{2,99}$/.test(descriptor.id || '') ||
    typeof descriptor.plan !== 'function' ||
    !/^[a-f0-9]{64}$/.test(packageDigest || '')
  )
    throw new Error('Invalid verified extension descriptor');
  installed.set(descriptor.id, Object.freeze({ ...descriptor, packageDigest }));
}
function list() {
  return [...installed.values()];
}
module.exports = { get, list, registerVerified, capabilities };
