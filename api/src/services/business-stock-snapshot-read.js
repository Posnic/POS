'use strict';
const { ObjectId } = require('mongodb');
const { validateStockSummary } = require('./business-stock-contract');
const {
  FRESHNESS_MS,
  digestOf,
  pageCount,
  validateSnapshotPage,
} = require('./business-stock-snapshot-contract');
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
const unavailable = () => ({ status: 'unavailable' });
function validHeader(snapshot, owner, branch, now) {
  try {
    if (
      typeof owner.assignmentId !== 'string' ||
      !/^[\w-]{43}$/.test(owner.assignmentId) ||
      !Number.isSafeInteger(owner.epoch) ||
      owner.epoch < 1 ||
      typeof owner.deviceId !== 'string' ||
      !owner.deviceId
    )
      return false;
    validateStockSummary(snapshot.summary, branch, { now });
    if (
      !digest(snapshot.snapshotId) ||
      snapshot.assignmentId !== owner.assignmentId ||
      snapshot.epoch !== owner.epoch ||
      snapshot.deviceId !== owner.deviceId ||
      !Array.isArray(snapshot.pages) ||
      snapshot.pages.length !== pageCount(snapshot.summary)
    )
      return false;
    let previous = '';
    for (let index = 0; index < snapshot.pages.length; index++) {
      const page = snapshot.pages[index];
      if (
        !page ||
        Object.keys(page).sort().join(',') !== 'digest,first,last,pageIndex' ||
        page.pageIndex !== index ||
        !digest(page.digest)
      )
        return false;
      if (snapshot.summary.coverage.verifiedItems === 0) {
        if (page.first !== null || page.last !== null) return false;
      } else {
        if (!id(page.first) || !id(page.last) || page.first <= previous || page.last < page.first)
          return false;
        previous = page.last;
      }
    }
    return now() - Date.parse(snapshot.summary.preparedAt) < FRESHNESS_MS;
  } catch {
    return false;
  }
}
/** Private worker reader shared by Cloud and Community. Callers enforce live
 * recipient authority separately. Each read uses at most one retained fact page. */
async function readFrame(db, branch, select, expected, now) {
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') return unavailable();
  if (!id(branch?.id) || !id(branch?.license)) throw new Error('invalid_stock_scope');
  const owners = db.collection('business_reporting_publishers');
  const filter = { _id: branch.id, license: new ObjectId(branch.license) };
  const owner = await owners.findOne(filter, { maxTimeMS: 250 });
  const snapshot = owner?.stockSnapshot;
  if (
    !owner ||
    owner.pendingStockSnapshot ||
    !snapshot ||
    !validHeader(snapshot, owner, branch, now) ||
    (expected && expected !== snapshot.snapshotId)
  )
    return unavailable();
  const descriptor = select(snapshot);
  let facts = [];
  if (descriptor) {
    const row = await db.collection('business_stock_snapshot_pages').findOne(
      {
        _id:
          branch.id +
          ':' +
          owner.assignmentId +
          ':' +
          snapshot.snapshotId +
          ':' +
          descriptor.pageIndex,
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
      return unavailable();
    try {
      validateSnapshotPage(row.page, branch, { now });
    } catch {
      return unavailable();
    }
    facts = row.page.facts;
    if (
      (facts[0]?.itemId ?? null) !== descriptor.first ||
      (facts.at(-1)?.itemId ?? null) !== descriptor.last
    )
      return unavailable();
  }
  const current = await owners.findOne(
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
  if (
    !current ||
    !validHeader(current.stockSnapshot, current, branch, now) ||
    digestOf(current.stockSnapshot) !== digestOf(snapshot)
  )
    return unavailable();
  return {
    status: 'ready',
    snapshotId: snapshot.snapshotId,
    summary: snapshot.summary,
    facts,
    pageIndex: descriptor?.pageIndex ?? null,
    pageCount: snapshot.pages.length,
  };
}
async function readStockSnapshotPage(
  db,
  branch,
  { snapshotId, pageIndex = 0, now = Date.now } = {}
) {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= 100 ||
    (snapshotId !== undefined && !digest(snapshotId)) ||
    (pageIndex > 0 && !snapshotId)
  )
    throw new Error('invalid_stock_snapshot_cursor');
  const frame = await readFrame(
    db,
    branch,
    (snapshot) => snapshot.pages[pageIndex],
    snapshotId,
    now
  );
  if (frame.status !== 'ready' || frame.pageIndex === null) return unavailable();
  return { ...frame, nextPageIndex: pageIndex + 1 < frame.pageCount ? pageIndex + 1 : null };
}
async function readStockSnapshotFact(db, branch, itemId, { now = Date.now } = {}) {
  if (!id(itemId)) throw new Error('invalid_stock_scope');
  const frame = await readFrame(
    db,
    branch,
    (snapshot) =>
      snapshot.pages.find((page) => page.first && page.first <= itemId && itemId <= page.last),
    undefined,
    now
  );
  if (frame.status !== 'ready') return unavailable();
  const fact = frame.facts.find((row) => row.itemId === itemId);
  return {
    status: fact ? (fact.low ? 'low' : 'healthy') : 'unknown',
    ...(fact ? { fact } : {}),
    snapshotId: frame.snapshotId,
    observedFrom: frame.summary.observedFrom,
    preparedAt: frame.summary.preparedAt,
    sourceComplete: false,
  };
}
module.exports = { readStockSnapshotPage, readStockSnapshotFact };
