'use strict';
const { cloudServerUrl } = require('./cloud-activation');

async function recoveryAddress({ config, identity, fetch: request = globalThis.fetch }) {
  if (!config?.deviceToken || !config.gatewayUrl || !identity?.tenantDb) return null;
  const base = cloudServerUrl(config.gatewayUrl);
  const response = await request(`${base}/v1/device/identity`, {
    headers: { authorization: `Bearer ${config.deviceToken}` },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Cloud recovery is unavailable. Check your connection and try again.');
  const result = await response.json();
  if (result.tenantDb !== identity.tenantDb) throw new Error('The linked cloud shop could not be verified.');
  if (!result.connections?.cloud) throw new Error('Cloud recovery is unavailable for this shop.');
  const shop = new URL(cloudServerUrl(result.connections.cloud));
  if (shop.protocol !== 'https:') throw new Error('Cloud recovery requires a secure shop address.');
  return new URL('/login.html#recover', shop.origin).href;
}
module.exports = { recoveryAddress };
