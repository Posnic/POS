'use strict';
const { ObjectId } = require('mongodb');
const { setTimeout: pause } = require('node:timers/promises');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const { registerCloseFact } = require('./business-register-close');
const { registerSaleContribution } = require('./business-register-metrics');
const { MAX_DOCUMENTS, MAX_DURATION_MS, PAGE_SIZE } = require('./business-summary-preparer');
const projection = {
  _id: 1,
  license: 1,
  branch_id: 1,
  cashregister_id: 1,
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
  'items_return.returnArray.cashregister_id': 1,
};
const closeProjection = {
  _id: 1,
  license: 1,
  branch_id: 1,
  register_id: 1,
  register_name: 1,
  register_status: 1,
  register_opendate: 1,
  register_closedate: 1,
};
const scope = (value) => ({ $in: [new ObjectId(value), value] });

/** Desktop-only, bounded source preparation. No HTTP handler, timer or Cloud
 * scan is introduced here. Publication must retain assigned-publisher fencing. */
async function prepareDesktopRegisterSummary(
  db,
  branch,
  sessionId,
  { signal, now = Date.now } = {}
) {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant())
    throw new MetricError('desktop_required');
  if (
    ![sessionId, branch?.id, branch?.license].every(
      (id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id)
    )
  )
    throw new MetricError('invalid_scope');
  if (signal?.aborted) throw new MetricError('cancelled');
  if (!/^[A-Z]{3}$/.test(branch.currency || '') || ![0, 1, 2, 3].includes(branch.currencyDigits))
    throw new MetricError('invalid_currency');
  const readClose = async () =>
    registerCloseFact(
      await db.collection('cashregister').findOne(
        {
          _id: new ObjectId(sessionId),
          license: scope(branch.license),
          branch_id: scope(branch.id),
        },
        { projection: closeProjection, maxTimeMS: 250 }
      ),
      branch,
      { now }
    );
  const close = await readClose();
  if (!close) throw new MetricError('close_unavailable');
  if (Date.parse(close.eligibleAt) > now()) throw new MetricError('close_grace_pending');
  const started = now(),
    totals = { billedSalesMinor: 0, refundsMinor: 0, completedSales: 0 };
  let scanned = 0;
  const cursor = db
    .collection('sales')
    .find({ license: scope(branch.license), branch_id: scope(branch.id) }, { projection })
    .sort({ _id: 1 })
    .batchSize(PAGE_SIZE)
    .limit(MAX_DOCUMENTS + 1)
    .maxTimeMS(1500);
  try {
    for await (const sale of cursor) {
      if (signal?.aborted) throw new MetricError('cancelled');
      if (++scanned > MAX_DOCUMENTS || now() - started > MAX_DURATION_MS)
        throw new MetricError('preparation_budget_exceeded');
      const contribution = registerSaleContribution(sale, branch, close);
      for (const key of Object.keys(totals)) {
        totals[key] += contribution[key];
        if (!Number.isSafeInteger(totals[key])) throw new MetricError('amount_overflow');
      }
      if (scanned % PAGE_SIZE === 0) await pause(10, undefined, { signal });
    }
    if (signal?.aborted) throw new MetricError('cancelled');
    const after = await readClose();
    if (!after || after.closeRevision !== close.closeRevision)
      throw new MetricError('close_changed');
    return {
      schemaVersion: 1,
      metricDefinitionVersion: 'register-session-v1',
      license: branch.license,
      branchId: branch.id,
      close,
      currency: branch.currency,
      currencyDigits: branch.currencyDigits,
      ...totals,
      salesAfterReturnsMinor: totals.billedSalesMinor - totals.refundsMinor,
      preparedAt: new Date(now()).toISOString(),
      sourceComplete: false,
      sourceDocuments: scanned,
    };
  } finally {
    await cursor.close();
  }
}
module.exports = { prepareDesktopRegisterSummary };
