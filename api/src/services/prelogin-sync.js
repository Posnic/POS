'use strict';

// Credentials stay in the authenticated device sync lane. Never accept a shop
// URL or device token from the unauthenticated login request.
function createPreloginSync({
  env = process.env,
  request = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  let pending;
  async function run() {
    if (env.POSNIC_DESKTOP !== '1' || env.POSNIC_SYNC_PAIRED !== '1') return { state: 'local' };
    const port = Number(env.SYNC_AGENT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { state: 'unavailable' };
    const origin = `http://127.0.0.1:${port}`;
    try {
      const response = await request(`${origin}/sync-users`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) return { state: 'upgrade-required' };
      if (!response.ok) return { state: 'unavailable' };
      const result = await response.json();
      if (result.state === 'updated') return { state: 'updated' };
    } catch (_) {
      /* Offline tills retain their last locally verified login. */
    }
    return { state: 'unavailable' };
  }
  return function refresh() {
    if (!pending)
      pending = run().finally(() => {
        pending = null;
      });
    return pending;
  };
}

module.exports = { createPreloginSync, refresh: createPreloginSync() };
