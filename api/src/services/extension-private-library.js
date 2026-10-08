'use strict';
// Registry-side service. Use a dedicated registry database, not a shop's POS
// database. actor.id must come from verified Posnic account authentication.
const crypto = require('node:crypto');
const fail = () => {
  throw Object.assign(new Error('extension_library_unavailable'), { status: 404 });
};
const valid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function initializeLibrary(db) {
  await db
    .collection('library_memberships')
    .createIndex({ organizationId: 1, userId: 1 }, { unique: true });
  await db
    .collection('library_entitlements')
    .createIndex({ organizationId: 1, extensionId: 1 }, { unique: true });
  await db
    .collection('library_download_tickets')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
async function membership(db, actor, organizationId) {
  if (!valid(actor?.id) || !valid(organizationId)) fail();
  const member = await db.collection('library_memberships').findOne({
    organizationId,
    userId: actor.id,
    status: 'active',
  });
  if (!member) fail();
}
async function releaseAccess(db, actor, organizationId, releaseId, kind) {
  await membership(db, actor, organizationId);
  if (typeof releaseId !== 'string' || !valid(releaseId) || !['package', 'source'].includes(kind))
    fail();
  const release = await db
    .collection('library_releases')
    .findOne({ _id: String(releaseId), status: 'approved' });
  if (
    !release ||
    (release.visibility !== 'public' &&
      !(release.visibility === 'private' && release.organizations?.includes(organizationId)))
  )
    fail();
  const entitlement = await db.collection('library_entitlements').findOne({
    organizationId,
    extensionId: release.extensionId,
    status: 'active',
  });
  // Exact release grants avoid interpreting a maintenance expiry as expiry of
  // a version already purchased. New-release eligibility is handled at grant.
  if (
    !entitlement?.releaseIds?.includes(releaseId) ||
    (kind === 'source' && entitlement.sourceAccess !== true)
  )
    fail();
  const artifact = release.artifacts?.[kind];
  if (
    !artifact ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256 || '') ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > 100 * 1024 * 1024
  )
    fail();
  return { release, artifact };
}
async function listReleases(db, actor, organizationId) {
  await membership(db, actor, organizationId);
  const entitlements = await db
    .collection('library_entitlements')
    .find({ organizationId, status: 'active' })
    .limit(500)
    .toArray();
  const ids = [...new Set(entitlements.flatMap((row) => row.releaseIds || []))]
    .filter(valid)
    .slice(0, 1000);
  const releases = await db
    .collection('library_releases')
    .find({
      _id: { $in: ids },
      status: 'approved',
      $or: [{ visibility: 'public' }, { visibility: 'private', organizations: organizationId }],
    })
    .sort({ _id: 1 })
    .limit(1000)
    .toArray();
  return releases
    .filter((row) =>
      entitlements.some(
        (grant) => grant.extensionId === row.extensionId && grant.releaseIds.includes(row._id)
      )
    )
    .map((row) => ({
      id: row._id,
      extensionId: row.extensionId,
      version: row.version,
      displayName: row.displayName,
      sourceAvailable:
        !!row.artifacts?.source &&
        entitlements.some(
          (grant) =>
            grant.extensionId === row.extensionId &&
            grant.sourceAccess === true &&
            grant.releaseIds.includes(row._id)
        ),
    }));
}
async function issueDownload(
  db,
  actor,
  organizationId,
  releaseId,
  kind,
  { now = new Date() } = {}
) {
  const { artifact } = await releaseAccess(db, actor, organizationId, releaseId, kind);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  await db.collection('library_download_tickets').insertOne({
    _id: digest(token),
    userId: actor.id,
    organizationId,
    releaseId,
    kind,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}
async function download(db, actor, token, readBlob, { now = new Date() } = {}) {
  if (!valid(actor?.id) || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) fail();
  const ticket = await db.collection('library_download_tickets').findOne({
    _id: digest(token),
    userId: actor.id,
    expiresAt: { $gt: now },
  });
  if (!ticket) fail();
  // Recheck membership, entitlement and release approval at EVERY download.
  // A valid ticket is not authority after revocation or package withdrawal.
  const { artifact } = await releaseAccess(
    db,
    actor,
    ticket.organizationId,
    ticket.releaseId,
    ticket.kind
  );
  if (artifact.sha256 !== ticket.sha256 || artifact.bytes !== ticket.bytes) fail();
  const bytes = await readBlob(artifact.sha256);
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== artifact.bytes ||
    digest(bytes) !== artifact.sha256
  )
    fail();
  // The HTTP layer must authenticate before resolution and send no-store.
  return {
    bytes,
    sha256: artifact.sha256,
    contentType: 'application/zip',
    filename: ticket.releaseId + '-' + ticket.kind + '.zip',
    cacheControl: 'private, no-store',
  };
}
module.exports = { initializeLibrary, listReleases, issueDownload, download };
