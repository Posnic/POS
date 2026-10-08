'use strict';
const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const { applyStockEffect } = require('./extension-stock-effects');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
};
const asId = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('stock_lifecycle_scope_invalid');
  return new ObjectId(String(value));
};
function filterFor(scope, input) {
  if (
    !/^[a-f\d]{64}$/.test(input?.stockOperationId || '') ||
    !/^[a-z][a-z0-9.-]{2,99}$/.test(input?.extensionId || '') ||
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(input?.operationId || '')
  )
    fail('stock_lifecycle_request_invalid');
  return {
    _id: input.stockOperationId,
    license: asId(scope.license),
    branch_id: asId(scope.branchId),
    extensionId: input.extensionId,
  };
}
const revisionFilter = (row) =>
  row.allocationRevision === undefined ? { $exists: false } : row.allocationRevision;
async function requireSettled(db, row) {
  for (const saleId of Object.keys(row.allocations || {})) {
    if (row.allocations[saleId].state === 'released') continue;
    const sale = await db.collection('sales').findOne(
      {
        _id: asId(saleId),
        license: row.license,
        branch_id: row.branch_id,
        extension_stock_operation: row._id,
        payment_status: 'Paid',
      },
      { projection: { _id: 1 } }
    );
    if (!sale) fail('stock_lifecycle_payment_unresolved');
  }
}

async function returnStock(db, scope, input, options = {}) {
  const filter = filterFor(scope, input),
    actorId = String(asId(scope.actorId));
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100)
    fail('stock_return_lines_invalid');
  const lines = input.lines
    .map((line) => {
      if (
        !Number.isSafeInteger(line.quantityMilli) ||
        line.quantityMilli <= 0 ||
        line.quantityMilli > 1e12
      )
        fail('stock_return_quantity_invalid');
      return { itemId: String(asId(line.itemId)), quantityMilli: line.quantityMilli };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length)
    fail('stock_return_duplicate_item');
  const operationId = hash(`${filter._id}:${input.operationId}`),
    digest = hash(
      JSON.stringify({ actorId, lines, ...(input.stream ? { stream: input.stream } : {}) })
    );
  const collection = db.collection('extension_stock_commands');
  let row;
  for (let attempt = 0; attempt < 30; attempt++) {
    row = await collection.findOne(filter);
    if (!row || row.phase !== 'committed') fail('stock_return_unavailable');
    const receipt = row.returnReceipts?.[operationId];
    if (receipt) {
      if (receipt !== digest) fail('stock_return_conflict');
      return { returned: true };
    }
    if (row.lifecycle) {
      if (row.lifecycle.operationId !== operationId || row.lifecycle.digest !== digest)
        fail('stock_lifecycle_busy');
      break;
    }
    await requireSettled(db, row);
    const remaining = {
      ...(row.remaining ||
        Object.fromEntries(row.lines.map((line) => [line.itemId, line.quantityMilli]))),
    };
    for (const line of lines) {
      if (
        !Number.isSafeInteger(remaining[line.itemId]) ||
        remaining[line.itemId] < line.quantityMilli
      )
        fail('stock_return_exhausted');
      remaining[line.itemId] -= line.quantityMilli;
    }
    const locked = await collection.updateOne(
      {
        ...filter,
        phase: 'committed',
        lifecycle: { $exists: false },
        allocationRevision: revisionFilter(row),
      },
      {
        $set: {
          remaining,
          allocationRevision: (row.allocationRevision || 0) + 1,
          lifecycle: { operationId, digest, actorId, kind: 'return', lines },
        },
      }
    );
    if (locked.modifiedCount === 1) {
      row = await collection.findOne(filter);
      break;
    }
    row = null;
  }
  if (!row?.lifecycle || row.lifecycle.operationId !== operationId) fail('stock_lifecycle_busy');
  const apply = options.applyEffect || applyStockEffect;
  for (let index = 0; index < lines.length; index++) {
    const result = await apply(db, scope, {
      itemId: lines[index].itemId,
      operationId: `${operationId}:${index}:return`,
      deltaMilli: lines[index].quantityMilli,
      ...(input.stream ? { stream: input.stream } : {}),
    });
    if (!result.applied) fail('stock_return_recovery_required');
  }
  await collection.updateOne(
    { ...filter, phase: 'committed', 'lifecycle.operationId': operationId },
    {
      $set: { [`returnReceipts.${operationId}`]: digest },
      $unset: { lifecycle: '' },
    }
  );
  return { returned: true };
}

async function clearStockBasket(db, scope, input) {
  const filter = filterFor(scope, input),
    actorId = String(asId(scope.actorId));
  const clearDigest = hash(`${actorId}:${input.operationId}`),
    collection = db.collection('extension_stock_commands');
  for (let attempt = 0; attempt < 30; attempt++) {
    const row = await collection.findOne(filter);
    if (!row) fail('stock_basket_unavailable');
    if (row.phase === 'cleared') {
      if (row.clearDigest !== clearDigest) fail('stock_basket_already_cleared');
      return { cleared: true };
    }
    if (row.phase !== 'committed' || row.lifecycle) fail('stock_lifecycle_busy');
    await requireSettled(db, row);
    // The CAS also fences concurrent sale allocations. Retain only an opaque
    // closed-operation tombstone, never unpaid quantities, staff or receipts.
    const changed = await collection.replaceOne(
      {
        ...filter,
        phase: 'committed',
        lifecycle: { $exists: false },
        allocationRevision: revisionFilter(row),
      },
      {
        ...filter,
        phase: 'cleared',
        digest: row.digest,
        clearDigest,
      }
    );
    if (changed.modifiedCount === 1) return { cleared: true };
  }
  fail('stock_lifecycle_busy');
}
module.exports = { returnStock, clearStockBasket };
