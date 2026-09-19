'use strict';

// Activation replies are configuration, never code or filesystem paths.
// Keep a closed schema and validate before persisting or using credentials.
function cloudServerUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid cloud server address.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid cloud server address.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a secure cloud server address without credentials or query parameters.');
  }
  return url.href.replace(/\/+$/, '');
}

function validateActivation(reply, fallbackUrl) {
  if (!reply || typeof reply !== 'object'
      || typeof reply.deviceToken !== 'string' || !/^[a-f0-9]{64}$/i.test(reply.deviceToken)
      || typeof reply.deviceId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(reply.deviceId)) {
    throw new Error('The cloud server returned invalid activation details. Please retry.');
  }
  return {
    deviceToken: reply.deviceToken,
    deviceId: reply.deviceId,
    gatewayUrl: cloudServerUrl(reply.syncUrl || reply.gatewayUrl || fallbackUrl),
  };
}

module.exports = { cloudServerUrl, validateActivation };
