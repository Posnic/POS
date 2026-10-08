'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readExtensionArchive } = require('./extension-archive');
const { loadVerifiedDirectory } = require('./extension-package-loader');
const { safePath } = require('../../../src/extension-package');
const runtime = require('./extension-runtime');
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: 409 });
};

function ensureDirectory(absolute) {
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('extension_install_directory_invalid');
  }
}
function durableFile(filename, bytes) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Stage an immutable signed version. This does not activate code, overwrite
 * current/previous pointers, enable a shop, run hooks or reset namespace data.
 * A restart/activation coordinator owns those separate decisions.
 */
async function stageExtensionArchive(
  input,
  { root, publicKey, capabilities = runtime.capabilities } = {}
) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('extension_install_root_invalid');
  const verified = await readExtensionArchive(input, { publicKey, capabilities });
  const { metadata, manifestBytes, contents, packageDigest } = verified;
  if (!safePath(metadata.id) || metadata.id.includes('/'))
    fail('extension_install_identity_invalid');
  const base = path.resolve(root);
  const versions = path.join(base, metadata.id, 'versions');
  const target = path.join(versions, metadata.version);
  const existing = () => {
    const loaded = loadVerifiedDirectory(target, publicKey, capabilities);
    if (loaded.packageDigest !== packageDigest) fail('extension_version_already_exists');
    return {
      id: metadata.id,
      version: metadata.version,
      packageDigest,
      directory: target,
      existing: true,
    };
  };
  ensureDirectory(versions);
  if (fs.existsSync(target)) return existing();
  const staging = path.join(base, `.staging-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  let moved = false;
  try {
    for (const [name, bytes] of contents) {
      const destination = path.join(staging, ...name.split('/'));
      ensureDirectory(path.dirname(destination));
      durableFile(destination, bytes);
    }
    durableFile(path.join(staging, 'manifest.json'), manifestBytes);
    // Validate the executable contract as well as the signature before this
    // version is eligible for activation. The loader creates no worker here.
    loadVerifiedDirectory(staging, publicKey, capabilities);
    try {
      fs.renameSync(staging, target);
      moved = true;
    } catch (error) {
      // Another installer may have staged this same immutable version while
      // the archive was being verified. Never overwrite it in place.
      if (fs.existsSync(target)) return existing();
      throw error;
    }
    const result = existing();
    return { ...result, existing: false };
  } finally {
    if (!moved && fs.existsSync(staging)) {
      // Only this invocation's random staging directory may be removed.
      if (path.dirname(path.resolve(staging)) !== base || fs.lstatSync(staging).isSymbolicLink())
        fail('extension_install_cleanup_invalid');
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
module.exports = { stageExtensionArchive };
