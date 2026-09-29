'use strict';
const { ObjectId } = require('mongodb');
const { isMultiTenant } = require('../db/tenant-context');
const {
  FRESHNESS_MS,
  digestOf,
  pageCount,
  validateSnapshotPage,
  assembleSnapshot,
} = require('./business-stock-snapshot-contract');
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
const localOnly = () => {
  if (
    process.env.POSNIC_DESKTOP !== '1' ||
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1' ||
    isMultiTenant()
  )
    fail('desktop_required', 403);
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') fail('stock_alerts_disabled', 404);
};
const samePublisher = (value, owner) =>
  value &&
  value.assignmentId === owner.assignmentId &&
  value.epoch === owner.epoch &&
  value.deviceId === owner.deviceId;
const keyOf = (branchId, assignmentId, snapshotId) =>
  branchId + ':' + assignmentId + ':' + snapshotId;
const fresh = (summary, at) =>
  Date.parse(summary.preparedAt) <= at && at - Date.parse(summary.preparedAt) < FRESHNESS_MS;
/** Internal Community boundary. Identity must come from the private installation
 * adapter, never from an HTTP body. No producer or recipient timer is activated. */
async function receiveCommunityStockSnapshot(db, device, body, { now = Date.now } = {}) {
  localOnly();
  if (
    !body ||
    Object.keys(body).sort().join(',') !== 'assignmentId,epoch,page' ||
    typeof body.assignmentId !== 'string' ||
    !/^[\w-]{43}$/.test(body.assignmentId) ||
    !Number.isSafeInteger(body.epoch) ||
    body.epoch < 1 ||
    !/^[a-f\d]{24}$/.test(body.page?.summary?.branchId)
  )
    fail('invalid_stock_snapshot_publication', 400);
  const page = structuredClone(body.page);
  const branchId = page.summary.branchId;
  if (
    !device?.deviceId ||
    (device.branches?.length && !device.branches.some((id) => String(id) === branchId))
  )
    fail('branch_access_denied', 403);
  const branchRow = await db
    .collection('branches')
    .findOne({ _id: new ObjectId(branchId) }, { maxTimeMS: 250 });
  if (!branchRow || !ObjectId.isValid(branchRow.license)) fail('branch_access_denied', 403);
  const branch = { id: branchId, license: String(branchRow.license) };
  validateSnapshotPage(page, branch, { now });
  if (!fresh(page.summary, now())) fail('stale_stock_snapshot');
  const owners = db.collection('business_reporting_publishers');
  const pages = db.collection('business_stock_snapshot_pages');
  await pages.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await pages.createIndex({ key: 1 });
  const filter = {
    _id: branchId,
    license: branchRow.license,
    deviceId: device.deviceId,
    assignmentId: body.assignmentId,
    epoch: body.epoch,
  };
  const current = async () => {
    const owner = await owners.findOne(filter, { maxTimeMS: 250 });
    if (!owner) fail('publisher_not_assigned', 403);
    return owner;
  };
  const key = keyOf(branchId, body.assignmentId, page.snapshotId);
  const digest = digestOf(page);
  const receipt = (complete) => ({
    schemaVersion: 1,
    snapshotId: page.snapshotId,
    pageIndex: page.pageIndex,
    digest,
    accepted: true,
    complete,
  });
  let owner = await current();
  if (
    samePublisher(owner.stockSnapshot, owner) &&
    owner.stockSnapshot.snapshotId === page.snapshotId
  ) {
    if (owner.stockSnapshot.pages[page.pageIndex]?.digest !== digest)
      fail('stock_snapshot_conflict');
    return receipt(true);
  }
  const pending = owner.pendingStockSnapshot;
  if (pending && (!samePublisher(pending, owner) || !fresh(pending.summary, now()))) {
    await owners.updateOne(
      { ...filter, 'pendingStockSnapshot.snapshotId': pending.snapshotId },
      { $unset: { pendingStockSnapshot: '' } },
      { maxTimeMS: 500 }
    );
    owner = await current();
  }
  if (!owner.pendingStockSnapshot) {
    if (
      owner.stockSnapshot &&
      (page.summary.observedFrom < owner.stockSnapshot.summary.preparedAt ||
        page.summary.preparedAt <= owner.stockSnapshot.summary.preparedAt)
    )
      fail('stale_stock_snapshot');
    const reserved = await owners.findOneAndUpdate(
      {
        ...filter,
        pendingStockSnapshot: { $exists: false },
        'stockSnapshot.snapshotId': owner.stockSnapshot
          ? owner.stockSnapshot.snapshotId
          : { $exists: false },
      },
      {
        $set: {
          pendingStockSnapshot: {
            snapshotId: page.snapshotId,
            summary: page.summary,
            deviceId: owner.deviceId,
            assignmentId: owner.assignmentId,
            epoch: owner.epoch,
          },
        },
      },
      { returnDocument: 'after', maxTimeMS: 500 }
    );
    if (!reserved) fail('stock_snapshot_busy');
    owner = reserved;
  }
  if (
    owner.pendingStockSnapshot.snapshotId !== page.snapshotId ||
    digestOf(owner.pendingStockSnapshot.summary) !== digestOf(page.summary)
  )
    fail('stock_snapshot_busy');
  const recordId = key + ':' + page.pageIndex;
  await pages.updateOne(
    { _id: recordId },
    {
      $setOnInsert: {
        key,
        page,
        digest,
        expiresAt: new Date(Date.parse(page.summary.preparedAt) + 3600000),
      },
    },
    { upsert: true, maxTimeMS: 500 }
  );
  const saved = await pages.findOne({ _id: recordId }, { maxTimeMS: 250 });
  if (!saved || saved.digest !== digest || digestOf(saved.page) !== digest)
    fail('stock_snapshot_conflict');
  // This is a bounded transfer assembly, never an items/sales collection scan.
  const retained = await pages.countDocuments({ key }, { limit: 101, maxTimeMS: 500 });
  if (retained < pageCount(page.summary)) {
    await current();
    return receipt(false);
  }
  const stored = await pages.find({ key }).limit(101).maxTimeMS(500).toArray();
  if (stored.some((row) => row.digest !== digestOf(row.page))) fail('stock_snapshot_conflict');
  const observation = assembleSnapshot(
    stored.map((row) => row.page),
    branch,
    { now }
  );
  if (!fresh(observation.summary, now())) fail('stale_stock_snapshot');
  const descriptors = stored
    .sort((a, b) => a.page.pageIndex - b.page.pageIndex)
    .map((row) => ({
      pageIndex: row.page.pageIndex,
      digest: row.digest,
      first: row.page.facts[0]?.itemId ?? null,
      last: row.page.facts.at(-1)?.itemId ?? null,
    }));
  const result = await owners.updateOne(
    { ...filter, 'pendingStockSnapshot.snapshotId': page.snapshotId },
    {
      $set: {
        stockSnapshot: {
          snapshotId: page.snapshotId,
          summary: observation.summary,
          pages: descriptors,
          assignmentId: owner.assignmentId,
          epoch: owner.epoch,
          deviceId: owner.deviceId,
        },
      },
      $unset: { pendingStockSnapshot: '' },
    },
    { maxTimeMS: 500 }
  );
  owner = await current();
  if (!result.matchedCount && owner.stockSnapshot?.snapshotId !== page.snapshotId)
    fail('stock_snapshot_busy');
  return receipt(true);
}
/** Private worker lookup, not a user endpoint: its caller must separately enforce
 * live recipient ACL/opt-in. Missing facts are unknown, never healthy/recovered. */
async function readCommunityStockSnapshotFact(db, branch, itemId, { now = Date.now } = {}) {
  localOnly();
  if (
    ![branch?.id, branch?.license, itemId].every(
      (id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id)
    )
  )
    fail('invalid_stock_scope', 400);
  const filter = { _id: branch.id, license: new ObjectId(branch.license) };
  const owners = db.collection('business_reporting_publishers');
  const owner = await owners.findOne(filter, { maxTimeMS: 250 });
  const snapshot = owner?.stockSnapshot;
  if (
    !owner ||
    owner.pendingStockSnapshot ||
    !samePublisher(snapshot, owner) ||
    !fresh(snapshot.summary, now())
  )
    return { status: 'unavailable' };
  const descriptor = snapshot.pages.find(
    (page) => page.first && page.first <= itemId && itemId <= page.last
  );
  let fact;
  if (descriptor) {
    const row = await db.collection('business_stock_snapshot_pages').findOne(
      {
        _id: keyOf(branch.id, owner.assignmentId, snapshot.snapshotId) + ':' + descriptor.pageIndex,
      },
      { maxTimeMS: 250 }
    );
    if (
      !row ||
      row.digest !== descriptor.digest ||
      digestOf(row.page) !== descriptor.digest ||
      row.page.snapshotId !== snapshot.snapshotId ||
      row.page.pageIndex !== descriptor.pageIndex ||
      digestOf(row.page.summary) !== digestOf(snapshot.summary)
    )
      return { status: 'unavailable' };
    validateSnapshotPage(row.page, branch, { now });
    fact = row.page.facts.find((value) => value.itemId === itemId);
  }
  // Recheck after the page read so a handover or a newer in-flight observation
  // cannot be represented as a current fact from the former publisher.
  const stillCurrent = await owners.findOne(
    {
      ...filter,
      assignmentId: owner.assignmentId,
      epoch: owner.epoch,
      deviceId: owner.deviceId,
      'stockSnapshot.snapshotId': snapshot.snapshotId,
      pendingStockSnapshot: { $exists: false },
    },
    { maxTimeMS: 250 }
  );
  if (!stillCurrent || !fresh(snapshot.summary, now())) return { status: 'unavailable' };
  return {
    status: fact ? (fact.low ? 'low' : 'healthy') : 'unknown',
    ...(fact ? { fact } : {}),
    snapshotId: snapshot.snapshotId,
    observedFrom: snapshot.summary.observedFrom,
    preparedAt: snapshot.summary.preparedAt,
    sourceComplete: false,
  };
}
module.exports = { receiveCommunityStockSnapshot, readCommunityStockSnapshotFact };
