'use strict';

const { assertSameShop } = require('./cloud-shop-identity');

function cloudAddress(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !['/', '/api', '/api/'].includes(url.pathname) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
    return `${url.origin}/api`;
  } catch (_) { return null; }
}

// Called after enrollment and periodically for already paired tills. Public
// phone discovery reads the cached branch field and never waits on the cloud.
async function refresh({ config, savedTenant, db, fetchImpl = fetch }) {
  if (!config?.gatewayUrl || !config.deviceToken) return { updated: false };
  const gateway = new URL(config.gatewayUrl);
  if (gateway.protocol !== 'https:' || gateway.username || gateway.password) throw new Error('Invalid cloud gateway');
  const response = await fetchImpl(`${config.gatewayUrl.replace(/\/+$/, '')}/v1/device/identity`, {
    headers: { authorization: `Bearer ${config.deviceToken}` },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Cloud shop details could not be refreshed');
  const identity = await response.json();
  const branches = await db.collection('branches').find({}, { projection: { _id: 1 } }).toArray();
  assertSameShop({ identity, savedTenant, localBranchIds: branches.map(b => String(b._id)), userCount: 0 });
  // Old gateways do not send this field. Keep the last verified address when
  // offline or talking to an older gateway; explicit null withdraws it.
  if (!Object.prototype.hasOwnProperty.call(identity.connections || {}, 'cloud')) return { updated: false };
  const cloud = cloudAddress(identity.connections.cloud);
  if (identity.connections.cloud && !cloud) throw new Error('Invalid cloud shop address');
  const result = await db.collection('branches').updateMany(
    { _id: { $in: branches.map(b => b._id) } },
    cloud ? { $set: { captain_cloud_url: cloud } } : { $unset: { captain_cloud_url: '' } }
  );
  return { updated: true, cloud, matchedCount: result.matchedCount };
}

module.exports = { refresh, cloudAddress };
