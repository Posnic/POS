'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = require('./extension-runtime');
function loadVerifiedDirectory(directory, publicKey, capabilities = runtime.capabilities) {
  const {
    verifyExtensionPackage,
    safePath,
    MAX_BYTES,
    MAX_FILES,
  } = require('../../../src/extension-package');
  const { callWorker } = require('../../../src/extension-worker');
  const root = path.resolve(directory);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('extension_directory_link_forbidden');
  const read = (relative, limit) => {
    if (!safePath(relative)) throw new Error('extension_path_invalid');
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('extension_file_link_forbidden');
    }
    const info = fs.statSync(current);
    if (!info.isFile() || info.size > limit) throw new Error('extension_file_invalid');
    return fs.readFileSync(current);
  };
  const manifestBytes = read('manifest.json', 128 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_FILES)
    throw new Error('extension_manifest_invalid');
  let remaining = MAX_BYTES;
  const contents = new Map();
  for (const file of manifest.files) {
    const bytes = read(file.path, remaining);
    remaining -= bytes.length;
    if (contents.has(file.path)) throw new Error('extension_duplicate_file');
    contents.set(file.path, bytes);
  }
  const metadata = verifyExtensionPackage(manifest, contents, { publicKey, capabilities });
  let inspected = 0;
  const walk = (relative = '') => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (++inspected > MAX_FILES * 10) throw new Error('extension_entry_limit');
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('extension_file_link_forbidden');
      if (entry.isDirectory()) walk(name);
      else if (!entry.isFile() || (name !== 'manifest.json' && !contents.has(name)))
        throw new Error('extension_unlisted_file');
    }
  };
  walk();
  if (
    !safePath(metadata.initialState) ||
    !contents.has(metadata.initialState) ||
    !metadata.commands ||
    typeof metadata.commands !== 'object'
  )
    throw new Error('extension_contract_invalid');
  for (const [name, permissions] of Object.entries(metadata.commands)) {
    if (
      !/^[a-z][a-zA-Z0-9.-]{1,80}$/.test(name) ||
      !Array.isArray(permissions) ||
      !permissions.length ||
      permissions.some((permission) => !['read', 'write', 'manage'].includes(permission))
    )
      throw new Error('extension_permissions_invalid');
  }
  const initialState = JSON.parse(contents.get(metadata.initialState).toString('utf8'));
  if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState))
    throw new Error('extension_state_invalid');
  for (const [command, resources] of Object.entries(metadata.contextNeeds || {})) {
    if (
      !metadata.commands[command] ||
      !Array.isArray(resources) ||
      resources.some((name) => name !== 'catalog.products')
    )
      throw new Error('extension_context_invalid');
  }
  let view;
  if (metadata.ui !== undefined) {
    if (!metadata.ui || typeof metadata.ui !== 'object' || Array.isArray(metadata.ui))
      throw new Error('extension_ui_invalid');
    view = {};
    for (const key of ['html', 'css', 'script']) {
      const name = metadata.ui[key];
      if (!safePath(name) || !contents.has(name) || contents.get(name).length > 1024 * 1024)
        throw new Error('extension_ui_invalid');
      view[key] = contents.get(name).toString('utf8');
    }
    Object.freeze(view);
  }
  const descriptor = {
    id: metadata.id,
    version: metadata.version,
    initialState,
    commands: metadata.commands,
    contextNeeds: metadata.contextNeeds || {},
    permissionModule: 'extensions',
    menu: metadata.contributes?.menu === 'sales' ? 'sales' : null,
    salesWorkspace: metadata.contributes?.salesWorkspace === true,
    requiredCapabilities: metadata.requiredCapabilities,
    displayName:
      typeof metadata.displayName === 'string' ? metadata.displayName.slice(0, 100) : metadata.id,
    ...(view ? { view } : {}),
    ...(metadata.contextProjection === true
      ? { readContext: (payload) => callWorker(root, metadata.entrypoint, 'context', payload) }
      : {}),
    ...(metadata.receiptProjection === true
      ? {
          readReceipt: (payload) => callWorker(root, metadata.entrypoint, 'receipt', payload),
        }
      : {}),
    plan: (payload) => callWorker(root, metadata.entrypoint, 'plan', payload),
    finalize: (state, results) =>
      callWorker(root, metadata.entrypoint, 'finalize', { state, results }),
  };
  return {
    descriptor,
    packageDigest: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
  };
}

async function initializeInstalledExtensions({
  db,
  root = process.env.POSNIC_EXTENSIONS_ROOT,
  publicKey = process.env.POSNIC_EXTENSIONS_PUBLIC_KEY ||
    (process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE &&
      fs.readFileSync(process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE, 'utf8')),
} = {}) {
  if (!root) return { loaded: [], failures: [] };
  if (!publicKey) return { loaded: [], failures: [{ code: 'extension_trust_key_missing' }] };
  const queueFailures = [];
  if (db) {
    try {
      await require('./extension-install-queue').apply({ root, publicKey, db });
    } catch (error) {
      queueFailures.push({ code: error.code || error.message });
    }
  }
  const lock = await require('./extension-runtime-lock').acquireRuntimeLock(root);
  runtime.clear();
  const loaded = [],
    failures = queueFailures;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9.-]{2,99}$/.test(entry.name)) continue;
    try {
      const directory = path.join(root, entry.name);
      if (fs.existsSync(path.join(directory, 'activation.pending.json')))
        throw new Error('extension_activation_recovery_required');
      const pointer = path.join(directory, 'current');
      if (fs.lstatSync(pointer).isSymbolicLink() || fs.statSync(pointer).size > 100)
        throw new Error('extension_pointer_invalid');
      const version = fs.readFileSync(pointer, 'utf8').trim();
      if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version))
        throw new Error('extension_version_invalid');
      const verified = loadVerifiedDirectory(path.join(directory, 'versions', version), publicKey);
      if (verified.descriptor.id !== entry.name || verified.descriptor.version !== version)
        throw new Error('extension_identity_mismatch');
      runtime.registerVerified(verified.descriptor, verified.packageDigest);
      loaded.push(entry.name);
    } catch (error) {
      failures.push({ id: entry.name, code: error.code || error.message });
    }
  }
  return { loaded, failures, release: lock.release };
}
module.exports = { loadVerifiedDirectory, initializeInstalledExtensions };
