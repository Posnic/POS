'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { AssetUpdater } = require('../src/asset-updater');
const { verifyExtensionPackage } = require('../src/extension-package');
const keys = crypto.generateKeyPairSync('ed25519');
function bundle(metadata = {}, extra = []) {
  const extension = { id: 'posnic.example', version: '1.0.0', manifestVersion: 1,
    apiVersion: 1, entrypoint: 'worker.js', requiredCapabilities: ['stock.v1'], ...metadata };
  const contents = new Map([['extension.json', Buffer.from(JSON.stringify(extension))],
    ['worker.js', Buffer.from('export const version = 1;')], ...extra]);
  const manifest = { kind: `extension:${extension.id}`, version: extension.version,
    files: [...contents].map(([path, bytes]) => ({ path, sha256: AssetUpdater.hash(bytes) })) };
  manifest.signature = crypto.sign(null, Buffer.from(AssetUpdater.signedPayload(manifest)), keys.privateKey).toString('base64');
  return { manifest, contents };
}
const options = { publicKey: keys.publicKey, capabilities: ['stock.v1'] };
test('signed offline extension validates without network or activation', () => {
  const b = bundle(); assert.equal(verifyExtensionPackage(b.manifest, b.contents, options).id, 'posnic.example');
});
test('tampered bytes, trust key, compatibility and installation scripts are rejected', () => {
  const b = bundle(); b.contents.set('worker.js', Buffer.from('changed'));
  assert.throws(() => verifyExtensionPackage(b.manifest, b.contents, options), { code: 'extension_hash_invalid' });
  const good = bundle();
  assert.throws(() => verifyExtensionPackage(good.manifest, good.contents, { capabilities: ['stock.v1'] }));
  assert.throws(() => verifyExtensionPackage(good.manifest, good.contents, { ...options, capabilities: [] }), { code: 'extension_incompatible' });
  const scripts = bundle({ postInstall: 'script.js' });
  assert.throws(() => verifyExtensionPackage(scripts.manifest, scripts.contents, options), { code: 'extension_install_hooks_forbidden' });
});
for (const path of ['../outside.js', '/outside.js', 'C:/outside.js', 'dir\\file.js', 'CON.txt', 'dir/NUL', 'dir/file.', 'WORKER.js']) {
  test(`reject archive path or Windows collision: ${path}`, () => {
    const b = bundle({}, [[path, Buffer.from('x')]]);
    assert.throws(() => verifyExtensionPackage(b.manifest, b.contents, options), { code: 'extension_path_invalid' });
  });
}
test('unsigned version traversal cannot reach a staging directory', () => {
  const b = bundle(); b.manifest.version = '../../outside';
  assert.throws(() => verifyExtensionPackage(b.manifest, b.contents, options), { code: 'extension_manifest_invalid' });
});
