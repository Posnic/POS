'use strict';
const crypto = require('node:crypto');
const { AssetUpdater } = require('./asset-updater');
const fail = reason => { const error = new Error(reason); error.code = reason; throw error; };
const MAX_FILES = 250;
const MAX_BYTES = 20 * 1024 * 1024;
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function safePath(value) {
  if (typeof value !== 'string' || value.length > 200 || value.includes('\\') ||
      !/^[a-zA-Z0-9_.\/-]+$/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..' &&
    !part.endsWith('.') && !reserved.test(part));
}

/** Validate an already bounded archive before any file is staged or executed.
 * The archive reader must reject symbolic links and duplicate entry names.
 * extension.json is hashed inside the signed payload: entrypoint, permissions
 * and compatibility cannot be altered while retaining a genuine signature.
 */
function verifyExtensionPackage(manifest, contents, { publicKey, capabilities = [], apiVersion = 1 } = {}) {
  if (!manifest || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(manifest.version || '') ||
      !/^extension:[a-z][a-z0-9.-]{2,99}$/.test(manifest.kind || '') ||
      !Array.isArray(manifest.files) || manifest.files.length < 2 || manifest.files.length > MAX_FILES ||
      !(contents instanceof Map) || contents.size !== manifest.files.length)
    fail('extension_manifest_invalid');
  const names = new Set(); let total = 0;
  for (const file of manifest.files) {
    if (!safePath(file.path) || file.path.toLowerCase() === 'manifest.json' ||
        names.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256 || ''))
      fail('extension_path_invalid');
    names.add(file.path.toLowerCase());
    const bytes = contents.get(file.path);
    if (!Buffer.isBuffer(bytes) || (total += bytes.length) > MAX_BYTES)
      fail('extension_size_invalid');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      fail('extension_hash_invalid');
  }
  const verdict = AssetUpdater.prototype.verifyManifest.call({ publicKey }, manifest);
  if (!verdict.ok) fail(`extension_${verdict.reason}`);
  let extension;
  try { extension = JSON.parse(contents.get('extension.json').toString('utf8')); }
  catch { fail('extension_metadata_invalid'); }
  if (!extension || extension.manifestVersion !== 1 || `extension:${extension.id}` !== manifest.kind ||
      extension.version !== manifest.version || !safePath(extension.entrypoint) ||
      !contents.has(extension.entrypoint) || extension.apiVersion !== apiVersion ||
      !Array.isArray(extension.requiredCapabilities) || extension.requiredCapabilities.length > 30 ||
      extension.requiredCapabilities.some(value => typeof value !== 'string' || !capabilities.includes(value)))
    fail('extension_incompatible');
  if (extension.installScripts || extension.postInstall || extension.nativeModules)
    fail('extension_install_hooks_forbidden');
  return extension;
}
module.exports = { verifyExtensionPackage, safePath, MAX_BYTES, MAX_FILES };
