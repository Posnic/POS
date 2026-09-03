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
 * Does this installation belong to somebody with a Posnic account?
 *
 * Not the same question as the mode, and the difference is the whole point.
 * resolveMode() answers 'desktop' before it looks at anything else, so a till
 * PAIRED TO CLOUD - a paying customer, standing at their own counter - reports
 * edition 'community'. That is right for the update channel and wrong for
 * "show me my account", which is why this is its own flag rather than a test
 * on edition somewhere in the frontend.
 *
 * Two ways to be true:
 *   cloud mode          - a provisioned tenant process
 *   POSNIC_SYNC_PAIRED  - the desktop shell found a cloud config with a
 *                         gateway on it, so this till is enrolled
 *
 * FALSE IS THE SAFE ANSWER and the default. A community shop sent to an
 * account page that greets them with "no account found" is worse off than one
 * that was never offered the link.
 *
 * A white-labelled build never offers it: that installation is not called
 * Posnic, and sending its owner to posnic.com would break the rebrand it was
 * sold as.
 */
function hasAccount(env, mode) {
  if (String(env.WHITE_LABEL_NAME || '').trim()) return false;
  if (mode === 'cloud') return true;
  return String(env.POSNIC_SYNC_PAIRED || '') === '1';
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
    // Capability flags (PRODUCT_ARCHITECTURE §1/§4). Clients read .features
    // unconditionally; a flag that is absent reads as false, which is always
    // the safe direction here.
    features: {
      /* Show a link to posnic.com/account. See hasAccount() for why this is
         not simply `edition === 'cloud'`. */
      account: hasAccount(env, mode),
    },
  };
}

module.exports = { buildRuntimeInfo, resolveAppVersion, resolveMode, hasAccount };
