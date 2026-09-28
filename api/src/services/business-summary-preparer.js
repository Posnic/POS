'use strict';
const { ObjectId } = require('mongodb');
const { setTimeout: pause } = require('node:timers/promises');
const { isMultiTenant } = require('../db/tenant-context');
const { createItemSummary } = require('./business-item-summary');
const {
  saleContribution,
  METRIC_VERSION,
  MetricError,
  businessDate,
} = require('./business-metrics');

const MAX_DOCUMENTS = 100_000;
const MAX_DURATION_MS = 30_000;
const PAGE_SIZE = 100;
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
function safeSum(a, b) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new MetricError('amount_overflow');
  return total;
}
function scopeId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))
    throw new MetricError('invalid_scope');
  return { $in: [new ObjectId(value), value] };
}
/** Desktop-only preparation primitive. There is deliberately no HTTP handler.
 * The caller must obtain a reporting-publisher assignment before publishing.
 * This baseline scan is bounded and cooperatively yields between pages; it
 * never schedules itself on a Cloud server or promises source completeness. */
async function prepareDesktopSummary(
  db,
  branch,
  day,
  { signal, now = Date.now, includeItems = false } = {}
) {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant())
    throw new MetricError('desktop_required');
  const parsedDay = new Date(day + 'T12:00:00Z');
  if (
    typeof day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== day
  )
    throw new MetricError('invalid_date');
  if (signal?.aborted) throw new MetricError('cancelled');
  // Validates the IANA zone before opening a cursor, including an empty branch.
  businessDate(new Date(), branch.timezone);
  if (!/^[A-Z]{3}$/.test(branch.currency) || ![0, 1, 2, 3].includes(branch.currencyDigits))
    throw new MetricError('invalid_currency');
  const startedAt = now();
  const totals = { billedSalesMinor: 0, refundsMinor: 0, completedSales: 0 };
  // Opt-in until the publication contract negotiates item support. Existing
  // workers keep the v2 payload and smaller source projection unchanged.
  const itemSummary = includeItems === true ? createItemSummary(branch, day) : null;
  let scanned = 0,
    sourceUpdatedAt = null;
  const cursor = db
    .collection('sales')
    .find(
      { license: scopeId(branch.license), branch_id: scopeId(branch.id) },
      {
        projection: itemSummary
          ? {
              ...fields,
              items: 1,
              business_item_origin: 1,
              return_refund_transactions: 1,
              'items_return.returnArray.returnValue': 1,
            }
          : fields,
      }
    )
    .sort({ _id: 1 })
    .batchSize(PAGE_SIZE)
    .limit(MAX_DOCUMENTS + 1)
    .maxTimeMS(1500);
  try {
    for await (const sale of cursor) {
      if (signal?.aborted) throw new MetricError('cancelled');
      if (++scanned > MAX_DOCUMENTS || now() - startedAt > MAX_DURATION_MS)
        throw new MetricError('preparation_budget_exceeded');
      const contribution = saleContribution(sale, branch);
      for (const row of contribution.entries) {
        if (row.businessDate !== day) continue;
        for (const key of Object.keys(totals)) totals[key] = safeSum(totals[key], row[key]);
      }
      if (itemSummary && contribution.entries.some((row) => row.businessDate === day))
        itemSummary.add(sale);
      if (!(sale.updated_date instanceof Date) || !Number.isFinite(sale.updated_date.getTime()))
        throw new MetricError('source_timestamp_required');
      if (!sourceUpdatedAt || sale.updated_date > sourceUpdatedAt)
        sourceUpdatedAt = sale.updated_date;
      if (scanned % PAGE_SIZE === 0) await pause(10, undefined, { signal });
    }
    if (signal?.aborted) throw new MetricError('cancelled');
    return {
      schemaVersion: 2,
      metricDefinitionVersion: METRIC_VERSION,
      license: branch.license,
      branchId: branch.id,
      businessDate: day,
      timezone: branch.timezone,
      currency: branch.currency,
      currencyDigits: branch.currencyDigits,
      ...totals,
      salesAfterReturnsMinor: safeSum(totals.billedSalesMinor, -totals.refundsMinor),
      preparedAt: new Date(now()).toISOString(),
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      sourceComplete: false,
      sourceDocuments: scanned,
      ...(itemSummary ? { itemInsights: itemSummary.finish(totals) } : {}),
    };
  } finally {
    await cursor.close();
  }
}
module.exports = { prepareDesktopSummary, MAX_DOCUMENTS, MAX_DURATION_MS, PAGE_SIZE };
