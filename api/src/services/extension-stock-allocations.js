'use strict';
const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
};
const asId = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('invalid_allocation_scope');
  return new ObjectId(String(value));
};
const grants = new WeakMap();

/** Allocate a subset of a committed stock operation to one immutable sale.
 * Only the host payment coordinator may call this module. An allocation is
 * never automatically released on an error: the payment/sale may have committed.
 * The single funding document arbitrates all competing partial sales.
 */
async function allocateForSale(db, scope, input) {
  const license = asId(scope?.license),
    branchId = asId(scope?.branchId),
    actorId = asId(scope?.actorId);
  const saleId = asId(input?.saleId);
  if (
    !/^[a-f\d]{64}$/.test(input?.stockOperationId ?? '') ||
    !/^[a-z0-9.-]{3,100}$/.test(input?.extensionId ?? '') ||
    !Array.isArray(input?.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 100
  )
    fail('invalid_stock_allocation');
  const lines = input.lines
    .map((line) => {
      if (!Number.isSafeInteger(line?.quantityMilli) || line.quantityMilli <= 0)
        fail('invalid_allocation_quantity');
      return { itemId: String(asId(line.itemId)), quantityMilli: line.quantityMilli };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length)
    fail('duplicate_allocation_item');
  const digest = hash(JSON.stringify({ actorId: String(actorId), lines }));
  const collection = db.collection('extension_stock_commands');
  const filter = {
    _id: input.stockOperationId,
    license,
    branch_id: branchId,
    extensionId: input.extensionId,
    phase: 'committed',
  };
  const key = String(saleId);
  for (let attempt = 0; attempt < 30; attempt++) {
    const journal = await collection.findOne(filter);
    if (!journal) fail('stock_allocation_unavailable');
    const previous = journal.allocations?.[key];
    if (previous) {
      if (previous.digest !== digest) fail('stock_allocation_conflict');
      const grant = Object.freeze({});
      grants.set(grant, {
        db,
        license,
        branchId,
        actorId,
        saleId,
        lines,
        digest,
        stockOperationId: input.stockOperationId,
        extensionId: input.extensionId,
      });
      return grant;
    }
    const remaining = {
      ...(journal.remaining ||
        Object.fromEntries(journal.lines.map((line) => [line.itemId, line.quantityMilli]))),
    };
    for (const line of lines) {
      if (
        !Number.isSafeInteger(remaining[line.itemId]) ||
        remaining[line.itemId] < line.quantityMilli
      )
        fail('stock_allocation_exhausted');
      remaining[line.itemId] -= line.quantityMilli;
    }
    const revision = journal.allocationRevision || 0;
    const result = await collection.updateOne(
      {
        ...filter,
        allocationRevision:
          journal.allocationRevision === undefined ? { $exists: false } : revision,
      },
      {
        $set: {
          remaining,
          allocationRevision: revision + 1,
          [`allocations.${key}`]: {
            digest,
            actorId: String(actorId),
            lines,
            createdAt: new Date(),
          },
        },
      }
    );
    if (result.modifiedCount !== 1) continue;
    const grant = Object.freeze({});
    grants.set(grant, {
      db,
      license,
      branchId,
      actorId,
      saleId,
      lines,
      digest,
      stockOperationId: input.stockOperationId,
      extensionId: input.extensionId,
    });
    return grant;
  }
  fail('stock_allocation_busy');
}

async function validateSaleGrant(grant, context, items) {
  const record = grants.get(grant);
  if (
    !record ||
    String(record.license) !== String(context.licenseId) ||
    String(record.branchId) !== String(context.branchId) ||
    String(record.actorId) !== String(context.userId)
  )
    fail('invalid_stock_grant');
  const requested = new Map();
  for (const item of items) {
    const amount = Number(item.item_quantity) * 1000;
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('invalid_stock_grant_quantity');
    const key = String(asId(item.item_id));
    requested.set(key, (requested.get(key) || 0) + amount);
  }
  if (
    requested.size !== record.lines.length ||
    record.lines.some((line) => requested.get(line.itemId) !== line.quantityMilli)
  )
    fail('stock_grant_quantity_mismatch');
  const live = await record.db.collection('extension_stock_commands').findOne(
    {
      _id: record.stockOperationId,
      license: record.license,
      branch_id: record.branchId,
      phase: 'committed',
      [`allocations.${record.saleId}.digest`]: record.digest,
    },
    { projection: { _id: 1 } }
  );
  if (!live) fail('stock_grant_no_longer_available');
  return {
    saleId: record.saleId,
    stockOperationId: record.stockOperationId,
    extensionId: record.extensionId,
    itemIds: new Set(record.lines.map((line) => line.itemId)),
  };
}

module.exports = { allocateForSale, validateSaleGrant };
