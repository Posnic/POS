'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadVerifiedDirectory } = require('./extension-package-loader');
const { activateStagedVersion } = require('./extension-activation');
function configuration() {
  const root = process.env.POSNIC_EXTENSIONS_ROOT;
  const publicKey =
    process.env.POSNIC_EXTENSIONS_PUBLIC_KEY ||
    (process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE &&
      fs.readFileSync(process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE, 'utf8'));
  if (!path.isAbsolute(root || '') || !publicKey)
    throw Object.assign(new Error('extension_install_not_configured'), { status: 409 });
  return { root, publicKey };
}
function file(root) {
  return path.join(root, '.activation-request.json');
}
function read(root) {
  const filename = file(root);
  if (!fs.existsSync(filename)) return null;
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
    throw new Error('extension_install_queue_invalid');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function validate(request) {
  if (
    !request ||
    !/^[a-z][a-z0-9.-]{2,99}$/.test(request.id || '') ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(request.version || '') ||
    !/^[a-f0-9]{64}$/.test(request.packageDigest || '') ||
    !/^[a-f0-9]{24}$/.test(request.license || '') ||
    !/^[a-f0-9]{24}$/.test(request.branchId || '')
  )
    throw Object.assign(new Error('extension_install_queue_invalid'), { status: 422 });
}
function queue({ root, publicKey, id, version, scope }) {
  const request = {
    id,
    version,
    license: String(scope.license),
    branchId: String(scope.branchId),
    packageDigest: '0'.repeat(64),
  };
  validate(request);
  const verified = loadVerifiedDirectory(path.join(root, id, 'versions', version), publicKey);
  if (verified.descriptor.id !== id || verified.descriptor.version !== version)
    throw new Error('extension_identity_mismatch');
  request.packageDigest = verified.packageDigest;
  const existing = read(root);
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(request)) return existing;
    throw Object.assign(new Error('extension_install_already_queued'), { status: 409 });
  }
  const temporary = path.join(root, `.activation-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(request));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temporary, file(root));
  } finally {
    fs.unlinkSync(temporary);
  }
  return request;
}
function cancel({ root, scope }) {
  const request = read(root);
  if (!request) return;
  validate(request);
  if (request.license !== String(scope.license) || request.branchId !== String(scope.branchId))
    throw Object.assign(new Error('extension_install_scope_mismatch'), { status: 403 });
  if (fs.existsSync(path.join(root, request.id, 'activation.pending.json')))
    throw Object.assign(new Error('extension_activation_recovery_required'), { status: 409 });
  fs.unlinkSync(file(root));
}
async function apply({ root, publicKey, db }) {
  const request = read(root);
  if (!request) return null;
  validate(request);
  const verified = loadVerifiedDirectory(
    path.join(root, request.id, 'versions', request.version),
    publicKey
  );
  if (verified.packageDigest !== request.packageDigest)
    throw new Error('extension_install_digest_changed');
  const result = await activateStagedVersion({
    root,
    publicKey,
    db,
    id: request.id,
    version: request.version,
    enableScopes: [{ license: request.license, branchId: request.branchId }],
  });
  fs.unlinkSync(file(root));
  return result;
}
module.exports = { configuration, read, queue, cancel, apply };
