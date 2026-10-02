'use strict';
const crypto = require('node:crypto');
const { readExtensionArchive, readSourceArchive, MAX_ARCHIVE_BYTES } = require('./extension-archive');
const fail = code => { throw Object.assign(new Error(code), { status: 409 }); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

// Internal reviewed-release publication only. Neither the local POS nor an
// extension worker may call this. Identity/roles and trust key are server-owned.
async function publishPrivateRelease(db, actor, input, { storage, publicKey, capabilities } = {}) {
  if (!identifier(actor?.id) || !Array.isArray(actor.roles) || !actor.roles.includes('extension-publisher'))
    fail('extension_publication_forbidden');
  if (!publicKey || !storage?.put || !Array.isArray(capabilities) ||
      !Array.isArray(input?.organizations) || !input.organizations.length || input.organizations.length > 100 ||
      input.organizations.some(value => !identifier(value)) ||
      typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 120)
    fail('extension_publication_invalid');
  // Snapshot before awaiting verification: publish exactly the verified bytes.
  if (!Buffer.isBuffer(input.package) || input.package.length > MAX_ARCHIVE_BYTES) fail('extension_publication_invalid');
  const organizations = [...new Set(input.organizations)].sort();
  const displayName = input.displayName.trim(), publishedBy = actor.id;
  const bytes = Buffer.from(input.package);
  if (input.source !== undefined && (!Buffer.isBuffer(input.source) || input.source.length > MAX_ARCHIVE_BYTES))
    fail('extension_publication_invalid');
  const sourceBytes = input.source === undefined ? null : Buffer.from(input.source);
  const verified = await readExtensionArchive(bytes, { publicKey, capabilities });
  if (sourceBytes) {
    const source = await readSourceArchive(sourceBytes, { publicKey });
    if (source.metadata.id !== verified.metadata.id || source.metadata.version !== verified.metadata.version ||
        source.metadata.runtimePackageDigest !== verified.packageDigest) fail('extension_publication_source_mismatch');
  }
  const identity = verified.metadata.id + ':' + verified.metadata.version;
  const releaseId = crypto.createHash('sha256').update(identity).digest('hex');
  const artifact = await storage.put(bytes);
  const sourceArtifact = sourceBytes ? await storage.put(sourceBytes) : null;
  const immutable = { extensionId: verified.metadata.id, version: verified.metadata.version,
    packageDigest: verified.packageDigest, displayName,
    visibility: 'private', organizations, artifacts: { package: artifact, ...(sourceArtifact ? { source: sourceArtifact } : {}) } };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
  const collection = db.collection('library_releases');
  try {
    await collection.insertOne({ _id: releaseId, ...immutable, fingerprint,
      status: 'approved', publishedBy, publishedAt: new Date() });
  } catch (error) { if (error.code !== 11000) throw error; }
  const release = await collection.findOne({ _id: releaseId });
  // A retry cannot replace a version, expand its audience or undo withdrawal.
  if (release.fingerprint !== fingerprint || release.status !== 'approved')
    fail('extension_publication_conflict');
  return { releaseId, extensionId: release.extensionId, version: release.version, artifact };
}
module.exports = { publishPrivateRelease };
