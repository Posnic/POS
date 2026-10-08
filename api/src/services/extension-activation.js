'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { acquireRuntimeLock } = require('./extension-runtime-lock');
const { loadVerifiedDirectory } = require('./extension-package-loader');
const runtime = require('./extension-runtime');
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: 409 });
};
function atomicWrite(filename, value) {
  if (
    fs.existsSync(filename) &&
    (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
  )
    fail('extension_activation_file_invalid');
  const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filename);
}
function pointer(directory, name) {
  const filename = path.join(directory, name);
  if (!fs.existsSync(filename)) return null;
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100) fail('extension_pointer_invalid');
  const version = fs.readFileSync(filename, 'utf8').trim();
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) fail('extension_version_invalid');
  return version;
}
/** Offline activation only. The API holds the same runtime lock for its whole
 * lifetime, so new commands cannot race the pending-operation inspection.
 * Journaled pointer/enablement writes resume after interruption. No namespace
 * is reset, migrated or deleted, and rollback uses the same checks. */
async function activateStagedVersion({
  root,
  publicKey,
  db,
  id,
  version,
  enableScopes = [],
  capabilities = runtime.capabilities,
  afterPointer,
} = {}) {
  if (
    !path.isAbsolute(root || '') ||
    !/^[a-z][a-z0-9.-]{2,99}$/.test(id || '') ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version || '') ||
    !Array.isArray(enableScopes) ||
    enableScopes.length > 100
  )
    fail('extension_activation_invalid');
  const lock = await acquireRuntimeLock(root);
  try {
    const directory = path.join(root, id),
      target = path.join(directory, 'versions', version);
    // Every ancestor must be a real directory, matching the staging contract.
    let part = path.parse(path.resolve(target)).root;
    for (const segment of path.relative(part, target).split(path.sep)) {
      part = path.join(part, segment);
      const stat = fs.lstatSync(part);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('extension_install_directory_invalid');
    }
    const verified = loadVerifiedDirectory(target, publicKey, capabilities);
    if (verified.descriptor.id !== id || verified.descriptor.version !== version)
      fail('extension_identity_mismatch');
    const normalized = enableScopes
      .map((scope) => {
        if (
          !/^[a-f\d]{24}$/i.test(scope?.license || '') ||
          !/^[a-f\d]{24}$/i.test(scope?.branchId || '')
        )
          fail('extension_activation_scope_invalid');
        return { license: scope.license.toLowerCase(), branchId: scope.branchId.toLowerCase() };
      })
      .sort((a, b) => `${a.license}:${a.branchId}`.localeCompare(`${b.license}:${b.branchId}`));
    for (const scope of normalized)
      if (
        !(await db
          .collection('branches')
          .findOne({ _id: new ObjectId(scope.branchId), license: new ObjectId(scope.license) }))
      )
        fail('extension_activation_scope_invalid');
    const namespaces = await db
      .collection('extension_namespaces')
      .find({ extensionId: id })
      .toArray();
    if (namespaces.some((row) => row.pending)) fail('extension_activation_operation_pending');
    if (
      namespaces.some(
        (row) =>
          row.data?.version !== undefined &&
          row.data.version !== verified.descriptor.initialState.version
      )
    )
      fail('extension_state_version_incompatible');
    const journalFile = path.join(directory, 'activation.pending.json');
    let journal;
    if (fs.existsSync(journalFile)) {
      const stat = fs.lstatSync(journalFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768)
        fail('extension_activation_journal_invalid');
      journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      if (
        journal.id !== id ||
        journal.version !== version ||
        journal.packageDigest !== verified.packageDigest ||
        JSON.stringify(journal.enableScopes) !== JSON.stringify(normalized)
      )
        fail('extension_activation_recovery_required');
      if (
        (journal.previous !== null &&
          !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(journal.previous || '')) ||
        (journal.previousDigest !== null && !/^[a-f\d]{64}$/.test(journal.previousDigest || ''))
      )
        fail('extension_activation_journal_invalid');
      const active = pointer(directory, 'current');
      if (active !== journal.previous && active !== version)
        fail('extension_activation_recovery_required');
    } else {
      const previous = pointer(directory, 'current');
      let previousDigest = null;
      if (previous)
        previousDigest = loadVerifiedDirectory(
          path.join(directory, 'versions', previous),
          publicKey,
          capabilities
        ).packageDigest;
      journal = {
        id,
        version,
        packageDigest: verified.packageDigest,
        previous,
        previousDigest,
        enableScopes: normalized,
      };
      atomicWrite(journalFile, JSON.stringify(journal));
    }
    if (journal.previous && journal.previous !== version)
      atomicWrite(path.join(directory, 'previous'), journal.previous + '\n');
    atomicWrite(path.join(directory, 'current'), version + '\n');
    if (afterPointer) await afterPointer();
    if (journal.previousDigest && journal.previousDigest !== verified.packageDigest) {
      await db
        .collection('extension_installations')
        .updateMany(
          { extensionId: id, packageDigest: journal.previousDigest },
          { $set: { packageDigest: verified.packageDigest, version } }
        );
    }
    for (const scope of journal.enableScopes) {
      const filter = {
        license: new ObjectId(scope.license),
        branch_id: new ObjectId(scope.branchId),
        extensionId: id,
      };
      // Deterministic identity prevents duplicate enablement on repeat installs.
      const installationId = crypto
        .createHash('sha256')
        .update(`${scope.license}:${scope.branchId}:${id}`)
        .digest('hex');
      await db
        .collection('extension_installations')
        .updateOne(
          filter,
          {
            $set: { packageDigest: verified.packageDigest, version, enabled: true },
            $setOnInsert: { _id: installationId },
          },
          { upsert: true }
        );
    }
    fs.unlinkSync(journalFile);
    return {
      id,
      version,
      packageDigest: verified.packageDigest,
      previous: journal.previous,
      restartRequired: true,
    };
  } finally {
    await lock.release();
  }
}
module.exports = { activateStagedVersion, pointer };
