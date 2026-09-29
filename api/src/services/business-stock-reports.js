'use strict';
const { ObjectId } = require('mongodb');
const { validateStockSummary } = require('./business-stock-contract');
const indexes = new WeakMap();
const fail = (code, status = 503) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 1;
/** Bounded prepared-snapshot reads only. A request schedules desktop work;
 * this service never scans inventory or derives stock from invoices. */
async function readStockSummary(db, context, query, { now = Date.now } = {}) {
  if (!context.capabilities.includes('stock.read')) fail('access_denied', 403);
  if (!query || Object.keys(query).length !== 1 || !id(query.branchId))
    fail('invalid_request', 400);
  const branch = context.branches.find((value) => value.id === query.branchId);
  if (!branch || !id(context.businessId)) fail('access_denied', 403);
  const at = now(),
    license = new ObjectId(context.businessId),
    key = branch.id + ':stock';
  if (!indexes.has(db)) {
    const ready = Promise.all([
      db
        .collection('business_reporting_requests')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('business_reporting_requests').createIndex({ branchId: 1, expiresAt: 1 }),
    ]).catch((error) => {
      indexes.delete(db);
      throw error;
    });
    indexes.set(db, ready);
  }
  await indexes.get(db);
  await db.collection('business_reporting_requests').updateOne(
    { _id: key },
    {
      $set: {
        summaryKind: 'stock',
        stockSummaryVersion: 1,
        branchId: branch.id,
        license,
        requestedAt: new Date(at),
        expiresAt: new Date(at + 30 * 60000),
      },
    },
    { upsert: true }
  );
  const readOwner = () =>
    db.collection('business_reporting_publishers').findOne(
      { _id: branch.id, license },
      {
        projection: {
          assignmentId: 1,
          deviceId: 1,
          epoch: 1,
          lastSequence: 1,
          'pending.sequence': 1,
          lastRejectedSequence: 1,
        },
        maxTimeMS: 250,
      }
    );
  const owner = await readOwner();
  if (
    !owner ||
    owner.pending ||
    !integer(owner.epoch) ||
    !integer(owner.lastSequence) ||
    typeof owner.assignmentId !== 'string' ||
    !owner.assignmentId ||
    typeof owner.deviceId !== 'string' ||
    !owner.deviceId
  )
    fail('summary_unavailable');
  const row = await db
    .collection('business_prepared_summaries')
    .findOne({ _id: key, license, branch_id: new ObjectId(branch.id) }, { maxTimeMS: 250 });
  const after = await readOwner();
  if (
    !after ||
    after.pending ||
    ['assignmentId', 'deviceId', 'epoch', 'lastSequence', 'lastRejectedSequence'].some(
      (field) => owner[field] !== after[field]
    )
  )
    fail('summary_unavailable');
  if (
    !row ||
    !integer(row.sequence) ||
    row.sequence > owner.lastSequence ||
    row.sequence === owner.lastRejectedSequence ||
    row.publisherAssignmentId !== owner.assignmentId ||
    row.publisherDeviceId !== owner.deviceId ||
    row.publisherEpoch !== owner.epoch ||
    !(row.receivedAt instanceof Date) ||
    !Number.isFinite(row.receivedAt.getTime()) ||
    row.receivedAt.getTime() > now()
  )
    fail('summary_unavailable');
  let s;
  try {
    s = validateStockSummary(row.summary, { id: branch.id, license: context.businessId }, { now });
  } catch {
    fail('summary_unavailable');
  }
  const checkedAt = now();
  if (
    Date.parse(s.preparedAt) > row.receivedAt.getTime() ||
    checkedAt - Date.parse(s.preparedAt) > 24 * 3600000
  )
    fail('summary_unavailable');
  return {
    schemaVersion: 1,
    metricDefinitionVersion: 'stored-stock-v1',
    businessId: context.businessId,
    branchId: branch.id,
    observedFrom: s.observedFrom,
    preparedAt: s.preparedAt,
    coverage: s.coverage,
    lowItemCount: s.lowItemCount,
    lowItems: s.lowItems,
    listTruncated: s.listTruncated,
    freshness: {
      state: checkedAt - Date.parse(s.preparedAt) > 15 * 60000 ? 'delayed' : 'partial',
      sourceUpdatedAt: null,
      checkedAt: new Date(checkedAt).toISOString(),
      complete: false,
    },
  };
}
module.exports = { readStockSummary };
