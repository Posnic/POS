'use strict';
const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const { saleContribution, businessDate, MetricError } = require('./business-metrics');
const { createItemSummary } = require('./business-item-summary');

// Deliberately bounded operational reads, not the historical desktop scan.
// These indexes are installed by a migration, never built on a phone request.
const DATE_INDEX = 'business_sales_day';
const RETURN_INDEX = 'business_returns_day';
const MAX_DOCUMENTS = 10000;
const MAX_DURATION_MS = 2500;
async function ensureCloudReportingIndexes(db) {
  await db
    .collection('sales')
    .createIndex({ license: 1, branch_id: 1, date: 1 }, { name: DATE_INDEX });
  await db
    .collection('sales')
    .createIndex(
      { license: 1, branch_id: 1, 'items_return.returnArray.returnDate': 1 },
      { name: RETURN_INDEX }
    );
}
const fields = {
  _id: 1,
  license: 1,
  branch_id: 1,
  sale_process: 1,
  payment_status: 1,
  sales_total: 1,
  items_return_total: 1,
  date: 1,
  updated_date: 1,
  training: 1,
  is_training: 1,
  deleted: 1,
  is_deleted: 1,
  'items_return.returnArray.returnObjId': 1,
  'items_return.returnArray.returnDate': 1,
  'items_return.returnArray.itemsTotalAmount': 1,
};
function sum(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new MetricError('amount_overflow');
  return result;
}
function dayRanges(day, timezone) {
  businessDate(new Date(), timezone);
  const start = moment.tz(day, 'YYYY-MM-DD', true, timezone);
  if (!start.isValid()) throw new MetricError('invalid_date');
  // Calendar-day addition is important on 23/25-hour daylight-saving days.
  const dates = { $gte: start.toDate(), $lt: start.clone().add(1, 'day').toDate() };
  // Legacy ISO strings can carry offsets. Widen only that index interval and
  // then use the exact businessDate calculation below. Never compare strings
  // directly with BSON dates or silently drop legacy offset timestamps.
  const strings = {
    $gte: start.clone().subtract(2, 'days').format('YYYY-MM-DD'),
    $lt: start.clone().add(3, 'days').format('YYYY-MM-DD'),
  };
  return [dates, strings];
}

async function readCloudOverview(
  db,
  context,
  branches,
  day,
  { now = Date.now, includeItems = false } = {}
) {
  const started = Date.now();
  const totals = { billedSalesMinor: 0, refundsMinor: 0, completedSales: 0 };
  let scanned = 0,
    sourceUpdatedAt = null;
  const itemSummary = includeItems
    ? createItemSummary({ ...branches[0], license: context.businessId }, day)
    : null;
  for (const branch of branches) {
    const scope = {
      license: { $in: [new ObjectId(context.businessId), context.businessId] },
      branch_id: { $in: [new ObjectId(branch.id), branch.id] },
    };
    const ranges = dayRanges(day, branch.timezone);
    const seen = new Set();
    const queries = [
      [DATE_INDEX, { ...scope, $or: ranges.map((range) => ({ date: range })) }],
      [
        RETURN_INDEX,
        {
          ...scope,
          $or: ranges.map((range) => ({
            items_return: { $elemMatch: { 'returnArray.returnDate': range } },
          })),
        },
      ],
    ];
    for (const [index, query] of queries) {
      const remaining = MAX_DURATION_MS - (Date.now() - started);
      if (remaining <= 0) throw new MetricError('report_budget_exceeded');
      const cursor = db
        .collection('sales')
        .find(query, {
          projection: includeItems
            ? {
                ...fields,
                items: 1,
                business_item_origin: 1,
                return_refund_transactions: 1,
                'items_return.returnArray.returnValue': 1,
              }
            : fields,
          hint: index,
          maxTimeMS: remaining,
        })
        .batchSize(100)
        .limit(MAX_DOCUMENTS + 1);
      try {
        for await (const sale of cursor) {
          if (++scanned > MAX_DOCUMENTS || Date.now() - started > MAX_DURATION_MS)
            throw new MetricError('report_budget_exceeded');
          if (seen.has(String(sale._id))) continue;
          seen.add(String(sale._id));
          const contribution = saleContribution(sale, { ...branch, license: context.businessId });
          const entry = contribution.entries.find((row) => row.businessDate === day);
          if (!entry) continue;
          for (const key of Object.keys(totals)) totals[key] = sum(totals[key], entry[key]);
          if (itemSummary) itemSummary.add(sale);
          // This is the newest included record timestamp, NOT a till-sync
          // watermark. complete stays false even if there are no records.
          const updated = sale.updated_date instanceof Date ? sale.updated_date : null;
          if (
            updated &&
            Number.isFinite(updated.getTime()) &&
            updated.getTime() <= now() &&
            (!sourceUpdatedAt || updated > sourceUpdatedAt)
          )
            sourceUpdatedAt = updated;
        }
      } finally {
        await cursor.close();
      }
    }
  }
  const checkedAt = new Date(now()).toISOString();
  return {
    schemaVersion: 2,
    metricDefinitionVersion: 2,
    businessId: context.businessId,
    branchIds: branches.map((branch) => branch.id),
    businessDate: day,
    currency: branches[0].currency,
    currencyDigits: branches[0].currencyDigits,
    ...totals,
    salesAfterReturnsMinor: sum(totals.billedSalesMinor, -totals.refundsMinor),
    ...(itemSummary ? { itemInsights: itemSummary.finish(totals) } : {}),
    preparedAt: checkedAt,
    freshness: {
      state: 'partial',
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      checkedAt,
      complete: false,
    },
  };
}
module.exports = { readCloudOverview, ensureCloudReportingIndexes, dayRanges, MAX_DOCUMENTS };
