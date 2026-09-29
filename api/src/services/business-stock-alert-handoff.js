'use strict';
const crypto = require('node:crypto');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const { validateStockFact } = require('./business-stock-contract');
const fail = (code) => {
  throw new MetricError(code);
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const digestOf = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function validateEvent(event, branch) {
  if (
    !exact(event, ['eventId', 'episode', 'fact', 'observedFrom', 'preparedAt', 'sourceComplete']) ||
    !Number.isSafeInteger(event.episode) ||
    event.episode < 1 ||
    event.sourceComplete !== false
  )
    fail('invalid_stock_alert_event');
  validateStockFact(event.fact);
  const key = branch.license + ':' + branch.id + ':' + event.fact.itemId;
  const expected = crypto
    .createHash('sha256')
    .update(JSON.stringify([key, event.episode]))
    .digest('hex');
  if (
    !event.fact.low ||
    event.eventId !== expected ||
    ![event.observedFrom, event.preparedAt].every(
      (value) =>
        typeof value === 'string' &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    ) ||
    event.observedFrom > event.preparedAt ||
    Date.parse(event.preparedAt) - Date.parse(event.observedFrom) > 15000
  )
    fail('invalid_stock_alert_event');
  return event;
}
function validateBatch(batch, branch) {
  if (
    !exact(batch, ['schemaVersion', 'license', 'branchId', 'batchId', 'events']) ||
    batch.schemaVersion !== 1 ||
    batch.license !== branch.license ||
    batch.branchId !== branch.id ||
    typeof batch.batchId !== 'string' ||
    !/^[a-f\d-]{36}$/.test(batch.batchId) ||
    !Array.isArray(batch.events) ||
    batch.events.length < 1 ||
    batch.events.length > 50
  )
    fail('invalid_stock_alert_batch');
  const ids = new Set();
  for (const event of batch.events) {
    validateEvent(event, branch);
    if (ids.has(event.fact.itemId)) fail('invalid_stock_alert_batch');
    ids.add(event.fact.itemId);
  }
  return batch;
}
function validReceipt(receipt, batch) {
  return (
    exact(receipt, ['schemaVersion', 'batchId', 'digest', 'accepted']) &&
    receipt.schemaVersion === 1 &&
    receipt.batchId === batch.batchId &&
    receipt.digest === digestOf(batch) &&
    receipt.accepted === true
  );
}
/** Installation-local handoff; send must use the assigned publisher's authenticated
 * transport. A receipt only means durable server acceptance, never user delivery.
 * Persist the immutable batch BEFORE sending, and the receipt BEFORE removal. */
function createStockAlertHandoff(db, { send, now = Date.now } = {}) {
  let running = false,
    indexed = false;
  return {
    async tick(branch) {
      if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) fail('desktop_required');
      if (
        ![branch?.id, branch?.license].every(
          (id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id)
        )
      )
        fail('invalid_scope');
      if (typeof send !== 'function') fail('stock_alert_transport_required');
      if (running) return;
      running = true;
      const collection = db.collection('business_stock_alert_local');
      const key = 'handoff:' + branch.license + ':' + branch.id;
      let lease;
      try {
        if (!indexed) {
          await collection.createIndex(
            { license: 1, branchId: 1, itemId: 1 },
            { partialFilterExpression: { 'pendingEvents.0': { $exists: true } } }
          );
          indexed = true;
        }
        await collection.updateOne(
          { _id: key },
          {
            $setOnInsert: {
              kind: 'handoff',
              license: branch.license,
              branchId: branch.id,
              nextAttemptAt: new Date(now()),
            },
          },
          { upsert: true, maxTimeMS: 500 }
        );
        const job = await collection.findOneAndUpdate(
          {
            _id: key,
            nextAttemptAt: { $lte: new Date(now()) },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }],
          },
          { $set: { leaseId: crypto.randomUUID(), leaseUntil: new Date(now() + 30000) } },
          { returnDocument: 'after', maxTimeMS: 500 }
        );
        if (!job) return;
        lease = { _id: key, leaseId: job.leaseId };
        let batch = job.batch;
        if (!batch) {
          const rows = await collection
            .find(
              {
                license: branch.license,
                branchId: branch.id,
                itemId: { $exists: true },
                'pendingEvents.0': { $exists: true },
              },
              { projection: { itemId: 1, pendingEvents: { $slice: 1 } } }
            )
            .sort({ itemId: 1 })
            .limit(50)
            .maxTimeMS(500)
            .toArray();
          if (!rows.length) {
            await collection.updateOne(
              lease,
              { $unset: { leaseId: '', leaseUntil: '' } },
              { maxTimeMS: 500 }
            );
            return { accepted: 0 };
          }
          batch = {
            schemaVersion: 1,
            license: branch.license,
            branchId: branch.id,
            batchId: crypto.randomUUID(),
            events: rows.map((row) => {
              if (row.pendingEvents[0].fact?.itemId !== row.itemId)
                fail('invalid_stock_alert_event');
              return row.pendingEvents[0];
            }),
          };
          validateBatch(batch, branch);
          const saved = await collection.updateOne(
            lease,
            { $set: { batch, cleanupAfter: 0 }, $unset: { receipt: '' } },
            { maxTimeMS: 500 }
          );
          if (!saved.matchedCount) return;
        }
        validateBatch(batch, branch);
        let receipt = job.receipt;
        if (receipt && !validReceipt(receipt, batch)) fail('invalid_stock_alert_receipt');
        if (!receipt) {
          const controller = new AbortController();
          let timeout;
          try {
            receipt = await Promise.race([
              send(structuredClone(batch), { signal: controller.signal }),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  controller.abort();
                  reject(new MetricError('stock_alert_handoff_timeout'));
                }, 20000);
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
          if (!validReceipt(receipt, batch)) fail('invalid_stock_alert_receipt');
          const saved = await collection.updateOne(
            { ...lease, 'batch.batchId': batch.batchId },
            { $set: { receipt } },
            { maxTimeMS: 500 }
          );
          if (!saved.matchedCount) return;
        }
        // Removing only the accepted episode cannot drop a later crossing appended
        // concurrently. Revision changes make journal writers retry their CAS.
        const cleanupAfter = job.cleanupAfter ?? 0;
        if (
          !Number.isInteger(cleanupAfter) ||
          cleanupAfter < 0 ||
          cleanupAfter > batch.events.length
        )
          fail('invalid_stock_alert_cleanup');
        const cleanupStarted = now();
        for (let index = cleanupAfter; index < batch.events.length; index++) {
          if (now() - cleanupStarted >= 3000) {
            await collection.updateOne(
              lease,
              { $unset: { leaseId: '', leaseUntil: '' }, $set: { nextAttemptAt: new Date(now()) } },
              { maxTimeMS: 500 }
            );
            return { accepted: 0, pendingCleanup: true };
          }
          const event = batch.events[index];
          await collection.updateOne(
            {
              _id: branch.license + ':' + branch.id + ':' + event.fact.itemId,
              'pendingEvents.eventId': event.eventId,
            },
            { $pull: { pendingEvents: { eventId: event.eventId } }, $inc: { revision: 1 } },
            { maxTimeMS: 500 }
          );
          const advanced = await collection.updateOne(
            { ...lease, 'batch.batchId': batch.batchId },
            { $set: { cleanupAfter: index + 1 } },
            { maxTimeMS: 500 }
          );
          if (!advanced.matchedCount) return;
        }
        await collection.updateOne(
          { ...lease, 'batch.batchId': batch.batchId },
          {
            $set: {
              lastAccepted: {
                batchId: batch.batchId,
                count: batch.events.length,
                at: new Date(now()),
              },
              nextAttemptAt: new Date(now()),
            },
            $unset: {
              batch: '',
              receipt: '',
              cleanupAfter: '',
              leaseId: '',
              leaseUntil: '',
              error: '',
            },
          },
          { maxTimeMS: 500 }
        );
        return { accepted: batch.events.length };
      } catch (error) {
        if (lease)
          await collection.updateOne(
            lease,
            {
              $set: {
                error:
                  typeof error.code === 'string' ? error.code : 'stock_alert_handoff_unavailable',
                nextAttemptAt: new Date(now() + 60000),
              },
              $unset: { leaseId: '', leaseUntil: '' },
            },
            { maxTimeMS: 500 }
          );
        throw error;
      } finally {
        running = false;
      }
    },
  };
}
module.exports = { createStockAlertHandoff, validateBatch, validateEvent, validReceipt, digestOf };
