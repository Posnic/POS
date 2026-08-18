// src/utils/runtime-info.js
//
// The one answer to "where am I running and which version is this?"
// (PRODUCT_ARCHITECTURE §1; SEAMLESS_UPDATE_ROADMAP U1). The UI and the
// update machinery read this single endpoint instead of sniffing user agents
// or build flags - edition and mode are RUNTIME facts, never build forks.
//
// Modes:
//   desktop - the API is running in-process inside the Electron shell
//             (main.js sets POSNIC_DESKTOP=1 before requiring the server)
//   cloud   - a provisioned tenant process (the provisioner's env carries the
//             per-shop POSNIC_KEY; POSNIC_CLOUD=1 is the explicit override)
//   local   - anything else: a community self-hosted server / LAN host
//
// Edition follows mode: cloud => 'cloud' (branded), otherwise 'community'.
//
// The app version is the ROOT package version (the only one users and the
// updater see). Resolution: POSNIC_APP_VERSION env (set by the desktop shell)
// -> ../package.json next to the api directory (dev tree / bundled layouts)
// -> null. Null is deliberate: reporting an unrelated number (api/package.json
// says 2.0.0 forever) would be worse than admitting we don't know.

const fs = require('fs');
const path = require('path');
const { API_SCHEMA_VERSION, SYNC_PROTOCOL_VERSION } = require('../constants/runtime.constants');

function resolveAppVersion(env, apiRoot) {
  const fromEnv = String(env.POSNIC_APP_VERSION || '').trim();
  if (/^\d+\.\d+\.\d+/.test(fromEnv)) return fromEnv;
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(apiRoot, '..', 'package.json'), 'utf8'));
    // The api's own package.json must never masquerade as the app version.
    if (rootPkg && rootPkg.name !== 'posnic-api' && /^\d+\.\d+\.\d+/.test(rootPkg.version || '')) {
      return rootPkg.version;
    }
  } catch (e) {
    /* no adjacent root package: version stays unknown */
  }
  return null;
}

function resolveMode(env) {
  if (String(env.POSNIC_DESKTOP || '') === '1') return 'desktop';
  if (String(env.POSNIC_CLOUD || '') === '1' || env.POSNIC_KEY) return 'cloud';
  return 'local';
}

/**
 * Build the runtime-info payload. Pure given (env, apiRoot) so it is
 * unit-testable; contains no tenant data and requires no auth.
 */
function buildRuntimeInfo(env = process.env, apiRoot = path.join(__dirname, '..', '..')) {
  const mode = resolveMode(env);
  return {
    edition: mode === 'cloud' ? 'cloud' : 'community',
    mode,
    version: resolveAppVersion(env, apiRoot),
    channel: String(env.POSNIC_UPDATE_CHANNEL || '').trim() || null,
    apiSchema: API_SCHEMA_VERSION,
    syncProtocol: SYNC_PROTOCOL_VERSION,
    // Reserved for capability flags (PRODUCT_ARCHITECTURE §1/§4); shipping the
    // empty object now means clients can read .features unconditionally.
    features: {},
  };
}

module.exports = { buildRuntimeInfo, resolveAppVersion, resolveMode };
