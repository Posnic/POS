'use strict';
const { ObjectId } = require('mongodb');
const { readRegisterClose } = require('./business-register-close');
const indexes = new WeakMap();
const fail = (code, status = 503) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const instant = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const fields = [
  'schemaVersion',
  'metricDefinitionVersion',
  'license',
  'branchId',
  'close',
  'currency',
  'currencyDigits',
  'billedSalesMinor',
  'refundsMinor',
  'completedSales',
  'salesAfterReturnsMinor',
  'preparedAt',
  'sourceComplete',
  'sourceDocuments',
];
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
const sameClose = (value, close) =>
  exact(value, Object.keys(close)) && Object.keys(close).every((k) => value[k] === close[k]);

/** Bounded metadata/request/snapshot I/O only. Financial work remains on the assigned desktop. */
async function readRegisterSummary(db, context, query, { now = Date.now } = {}) {
  if (
    !context.capabilities.includes('overview.read') ||
    !context.capabilities.includes('notifications.self.manage')
  )
    fail('access_denied', 403);
  if (!exact(query, ['branchId', 'sessionId']) || !id(query.branchId) || !id(query.sessionId))
    fail('invalid_request', 400);
  const branch = context.branches.find((b) => b.id === query.branchId);
  if (!branch || !id(context.businessId)) fail('access_denied', 403);
  const checkedAt = now();
  const close = await readRegisterClose(db, context, branch.id, query.sessionId, { now });
  if (!close) fail('close_unavailable', 404);
  if (checkedAt - Date.parse(close.closedAt) > 32 * 86400000) fail('date_out_of_range', 400);
  if (checkedAt < Date.parse(close.eligibleAt)) fail('close_grace_pending', 409);
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
  const key = branch.id + ':session:' + query.sessionId,
    license = new ObjectId(context.businessId);
  await db.collection('business_reporting_requests').updateOne(
    { _id: key },
    {
      $set: {
        summaryKind: 'register-session',
        registerSummaryVersion: 1,
        branchId: branch.id,
        license,
        sessionId: query.sessionId,
        closeRevision: close.closeRevision,
        businessDate: close.businessDate,
        requestedAt: new Date(checkedAt),
        expiresAt: new Date(checkedAt + 30 * 60000),
      },
    },
    { upsert: true }
  );
  const publishers = db.collection('business_reporting_publishers');
  const readOwner = () =>
    publishers.findOne(
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
    !count(owner.epoch) ||
    owner.epoch < 1 ||
    !count(owner.lastSequence) ||
    owner.lastSequence < 1
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
      (k) => after[k] !== owner[k]
    )
  )
    fail('summary_unavailable');
  const finalClose = await readRegisterClose(db, context, branch.id, query.sessionId, { now });
  if (!sameClose(finalClose, close)) fail('summary_unavailable');
  const s = row?.summary;
  if (
    !row ||
    !count(row.sequence) ||
    row.sequence < 1 ||
    row.sequence > owner.lastSequence ||
    row.sequence === owner.lastRejectedSequence ||
    row.publisherAssignmentId !== owner.assignmentId ||
    row.publisherDeviceId !== owner.deviceId ||
    row.publisherEpoch !== owner.epoch ||
    !(row.receivedAt instanceof Date) ||
    !Number.isFinite(row.receivedAt.getTime()) ||
    row.receivedAt.getTime() > now() + 300000 ||
    !exact(s, fields) ||
    s.schemaVersion !== 1 ||
    s.metricDefinitionVersion !== 'register-session-v1' ||
    s.branchId !== branch.id ||
    s.license !== context.businessId ||
    !sameClose(s.close, close) ||
    s.currency !== branch.currency ||
    s.currencyDigits !== branch.currencyDigits ||
    s.sourceComplete !== false ||
    ![s.billedSalesMinor, s.refundsMinor, s.completedSales, s.sourceDocuments].every(count) ||
    s.sourceDocuments > 100000 ||
    s.completedSales > s.sourceDocuments ||
    (s.billedSalesMinor > 0 && s.completedSales === 0) ||
    (s.refundsMinor > 0 && s.sourceDocuments === 0) ||
    !Number.isSafeInteger(s.salesAfterReturnsMinor) ||
    s.salesAfterReturnsMinor !== s.billedSalesMinor - s.refundsMinor ||
    !instant(s.preparedAt) ||
    Date.parse(s.preparedAt) < Date.parse(close.eligibleAt) ||
    Date.parse(s.preparedAt) > now() + 300000 ||
    Date.parse(s.preparedAt) > row.receivedAt.getTime() + 300000
  )
    fail('summary_unavailable');
  return {
    schemaVersion: 1,
    metricDefinitionVersion: 'register-session-v1',
    businessId: context.businessId,
    branchId: branch.id,
    close,
    currency: s.currency,
    currencyDigits: s.currencyDigits,
    billedSalesMinor: s.billedSalesMinor,
    refundsMinor: s.refundsMinor,
    completedSales: s.completedSales,
    salesAfterReturnsMinor: s.salesAfterReturnsMinor,
    preparedAt: s.preparedAt,
    freshness: {
      state: now() - Date.parse(s.preparedAt) > 15 * 60000 ? 'delayed' : 'partial',
      sourceUpdatedAt: null,
      checkedAt: new Date(now()).toISOString(),
      complete: false,
    },
  };
}
module.exports = { readRegisterSummary };
