'use strict';
const crypto = require('node:crypto');
const { AssetUpdater } = require('../../../src/asset-updater');
const { safePath, MAX_BYTES, MAX_FILES } = require('../../../src/extension-package');
const fail = () => {
  throw Object.assign(new Error('extension_source_invalid'), {
    code: 'extension_source_invalid',
    status: 422,
  });
};
// A source handover is signed independently and bound to the exact runtime
// manifest digest. It is never an executable installation package.
function verifySourcePackage(manifest, contents, { publicKey } = {}) {
  if (
    !manifest ||
    !/^extension-source:[a-z][a-z0-9.-]{2,99}$/.test(manifest.kind || '') ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(manifest.version || '') ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 2 ||
    manifest.files.length > MAX_FILES ||
    !(contents instanceof Map) ||
    contents.size !== manifest.files.length
  )
    fail();
  let size = 0;
  const names = new Set();
  for (const file of manifest.files) {
    if (
      !safePath(file.path) ||
      file.path.toLowerCase() === 'manifest.json' ||
      names.has(file.path.toLowerCase())
    )
      fail();
    names.add(file.path.toLowerCase());
    const bytes = contents.get(file.path);
    if (
      !Buffer.isBuffer(bytes) ||
      (size += bytes.length) > MAX_BYTES ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      fail();
  }
  if (!AssetUpdater.prototype.verifyManifest.call({ publicKey }, manifest).ok) fail();
  let metadata;
  try {
    metadata = JSON.parse(contents.get('source.json').toString('utf8'));
  } catch {
    fail();
  }
  if (
    metadata?.manifestVersion !== 1 ||
    `extension-source:${metadata.id}` !== manifest.kind ||
    metadata.version !== manifest.version ||
    !/^[a-f0-9]{64}$/.test(metadata.runtimePackageDigest || '') ||
    !/^[a-f0-9]{40}$/.test(metadata.sourceCommit || '') ||
    !contents.has('README.md') ||
    !contents.has('LICENSE')
  )
    fail();
  return metadata;
}
module.exports = { verifySourcePackage };
