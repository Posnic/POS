'use strict';
const { hostsFor } = require('./shop-hosts');

// An isolated release owns the whole tenant, including its background work.
// Excluding any alias excludes all aliases; HTTP-only routing is insufficient.
function isExcluded(tenant, setting = process.env.SHARD_EXCLUDE_HOSTS || '') {
  const excluded = new Set(String(setting).split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
  return hostsFor(tenant).some(host => excluded.has(host.toLowerCase()));
}
module.exports = { isExcluded };
