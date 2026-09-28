'use strict';
const { ObjectId } = require('mongodb');
const { validateItemSummary } = require('./business-item-summary-validation');
const fail = (code, status) => {
  throw Object.assign(new Error(code), { code, status });
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const requestIndexes = new WeakMap();
const sum = (a, b) => {
  const total = a + b;
  if (!Number.isSafeInteger(total)) fail('summary_unavailable', 503);
  return total;
};

// Three bounded primary-key reads. Never prepares a report on a phone request.
async function readBusinessOverview(
  db,
  context,
  query,
  { now = Date.now, includeItems = false } = {}
) {
  if (!context.capabilities.includes('overview.read')) fail('access_denied', 403);
  if (includeItems && !context.capabilities.includes('items.read')) fail('access_denied', 403);
  const ids = typeof query.branchId === 'string' ? [query.branchId] : query.branchId;
  const day = query.businessDate;
  const parsedDate = typeof day === 'string' ? new Date(day + 'T12:00:00Z') : null;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    (includeItems && ids.length !== 1) ||
    ids.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id)) ||
    new Set(ids).size !== ids.length ||
    typeof day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(parsedDate?.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== day
  )
    fail('invalid_request', 400);
  const branches = ids.map((id) => context.branches.find((branch) => branch.id === id));
  if (branches.some((branch) => !branch)) fail('access_denied', 403);
  const currency = branches[0].currency,
    currencyDigits = branches[0].currencyDigits;
  if (
    branches.some(
      (branch) => branch.currency !== currency || branch.currencyDigits !== currencyDigits
    )
  )
    fail('mixed_currencies', 409);
  const license = new ObjectId(context.businessId);
  const age = now() - parsedDate.getTime();
  if (age > 32 * 86400000 || age < -2 * 86400000) fail('date_out_of_range', 400);
  if (!requestIndexes.has(db)) {
    const setup = Promise.all([
      db
        .collection('business_reporting_requests')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('business_reporting_requests').createIndex({ branchId: 1, expiresAt: 1 }),
    ]).catch((error) => {
      requestIndexes.delete(db);
      throw error;
    });
    requestIndexes.set(db, setup);
  }
  await requestIndexes.get(db);
  // Signal an assigned desktop to prepare asynchronously. This writes only
  // bounded request metadata; no sale scan or report computation runs here.
  const requestedAt = new Date(now());
  await db.collection('business_reporting_requests').bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { _id: id + ':' + day },
        update: {
          $set: {
            branchId: id,
            license,
            businessDate: day,
            requestedAt,
            expiresAt: new Date(requestedAt.getTime() + 30 * 60000),
          },
        },
        upsert: true,
      },
    }))
  );
  const publishers = db.collection('business_reporting_publishers');
  const readPublishers = () =>
    publishers
      .find(
        { _id: { $in: ids }, license },
        {
          projection: {
            assignmentId: 1,
            deviceId: 1,
            epoch: 1,
            lastSequence: 1,
            'pending.sequence': 1,
          },
        }
      )
      .limit(ids.length)
      .maxTimeMS(250)
      .toArray();
  const assignments = await readPublishers();
  if (assignments.length !== ids.length || assignments.some((row) => row.pending))
    fail('summary_unavailable', 503);
  const rows = await db
    .collection('business_prepared_summaries')
    .find(
      { _id: { $in: ids.map((id) => id + ':' + day) }, license },
      includeItems ? {} : { projection: { 'summary.itemInsights': 0 } }
    )
    .limit(ids.length)
    .maxTimeMS(250)
    .toArray();
  if (rows.length !== ids.length) fail('summary_unavailable', 503);
  const after = await readPublishers();
  if (
    assignments.some(
      (row) =>
        !after.some(
          (next) =>
            next._id === row._id &&
            next.assignmentId === row.assignmentId &&
            next.epoch === row.epoch &&
            next.lastSequence === row.lastSequence &&
            !next.pending
        )
    )
  )
    fail('summary_unavailable', 503);
  const totals = {
    billedSalesMinor: 0,
    refundsMinor: 0,
    salesAfterReturnsMinor: 0,
    completedSales: 0,
  };
  let preparedAt = null,
    sourceUpdatedAt = null,
    sourceMissing = false;
  let itemInsights;
  const checkedAt = now();
  for (const branch of branches) {
    const row = rows.find((row) => String(row.branch_id) === branch.id);
    const owner = assignments.find((owner) => owner._id === branch.id);
    const s = row?.summary;
    if (
      !row ||
      !owner ||
      row.publisherAssignmentId !== owner.assignmentId ||
      row.publisherDeviceId !== owner.deviceId ||
      row.publisherEpoch !== owner.epoch ||
      !integer(row.sequence) ||
      row.sequence > owner.lastSequence ||
      !s ||
      s.schemaVersion !== 2 ||
      s.metricDefinitionVersion !== 2 ||
      s.branchId !== branch.id ||
      s.license !== context.businessId ||
      s.businessDate !== day ||
      s.currency !== branch.currency ||
      s.currencyDigits !== branch.currencyDigits ||
      s.timezone !== branch.timezone ||
      s.sourceComplete !== false ||
      !integer(s.billedSalesMinor) ||
      !integer(s.refundsMinor) ||
      !integer(s.completedSales) ||
      !Number.isSafeInteger(s.salesAfterReturnsMinor) ||
      s.salesAfterReturnsMinor !== s.billedSalesMinor - s.refundsMinor ||
      !instant(s.preparedAt) ||
      Date.parse(s.preparedAt) > checkedAt + 5 * 60000 ||
      (s.sourceUpdatedAt !== null &&
        (!instant(s.sourceUpdatedAt) ||
          Date.parse(s.sourceUpdatedAt) > Date.parse(s.preparedAt) + 5 * 60000))
    )
      fail('summary_unavailable', 503);
    if (includeItems) {
      try {
        if (!integer(s.sourceDocuments) || s.sourceDocuments > 100000)
          fail('summary_unavailable', 503);
        itemInsights = validateItemSummary(s.itemInsights, s);
      } catch {
        fail('summary_unavailable', 503);
      }
    }
    for (const key of Object.keys(totals)) totals[key] = sum(totals[key], s[key]);
    if (!preparedAt || s.preparedAt < preparedAt) preparedAt = s.preparedAt;
    if (s.sourceUpdatedAt === null) sourceMissing = true;
    else if (!sourceUpdatedAt || s.sourceUpdatedAt < sourceUpdatedAt)
      sourceUpdatedAt = s.sourceUpdatedAt;
  }
  return {
    schemaVersion: 2,
    metricDefinitionVersion: 2,
    businessId: context.businessId,
    branchIds: ids,
    businessDate: day,
    currency,
    currencyDigits,
    ...totals,
    ...(includeItems ? { itemInsights } : {}),
    preparedAt,
    freshness: {
      state: checkedAt - Date.parse(preparedAt) > 15 * 60000 ? 'delayed' : 'partial',
      sourceUpdatedAt: sourceMissing ? null : sourceUpdatedAt,
      checkedAt: new Date(checkedAt).toISOString(),
      complete: false,
    },
  };
}
async function readBusinessItems(db, context, query, options = {}) {
  return readBusinessOverview(db, context, query, { ...options, includeItems: true });
}
module.exports = { readBusinessOverview, readBusinessItems };
