'use strict';

const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');

const fail = (code, status = 409) => {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
};
const objectId = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('invalid_stock_scope', 422);
  return new ObjectId(String(value));
};
const hash = (value) => createHash('sha256').update(value).digest('hex');

/** Internal host primitive. Call only after authorization and a durable command
 * plan have been recorded. Both successful and refused effects are decided in
 * the item document, so a lost Mongo acknowledgement cannot change the result
 * on retry. Works on standalone MongoDB without cross-document transactions.
 * Opaque receipts are not customer adjustment history and must not be removed
 * while an old operation can still be replayed. There is no public skip-stock flag.
 */
async function applyStockEffectInternal(db, scope, effect) {
  if (effect?.stream)
    return require('./extension-stock-fence').applyFencedStockEffect(db, scope, effect);
  const license = objectId(scope?.license);
  const branchId = objectId(scope?.branchId);
  const itemId = objectId(effect?.itemId);
  if (
    typeof effect?.operationId !== 'string' ||
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(effect.operationId)
  )
    fail('invalid_stock_operation', 422);
  const delta = effect.deltaMilli;
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1e12)
    fail('invalid_stock_delta', 422);
  const token = hash(`${license}:${branchId}:${effect.operationId}`);
  const digest = hash(`${token}:${itemId}:${delta}`);
  const field = `extension_stock_effects.${token}`;
  const items = db.collection('items');
  const base = { _id: itemId, license };
  const resultOf = (row) => {
    const receipt = row?.extension_stock_effects?.[token];
    if (!receipt) return null;
    if (receipt.digest !== digest) fail('stock_operation_conflict');
    return { applied: receipt.applied, operationId: effect.operationId };
  };
  const prior = resultOf(await items.findOne(base, { projection: { [field]: 1 } }));
  if (prior) return prior;

  // Shared catalogue access is not a separate stock balance. Require all branch
  // references to resolve to this single branch, and reject malformed balances.
  const belongs = {
    $or: [{ branch_id: branchId }, { 'branch_access.branch_id': branchId }],
    $and: [
      { $or: [{ branch_id: { $exists: false } }, { branch_id: branchId }] },
      {
        $or: [
          { branch_access: { $exists: false } },
          {
            branch_access: {
              $type: 'array',
              $not: { $elemMatch: { branch_id: { $ne: branchId } } },
            },
          },
        ],
      },
    ],
  };
  const scaled = { $multiply: ['$available_quantity', 1000] };
  const rounded = { $round: [scaled, 0] };
  const canApply =
    delta > 0
      ? true
      : {
          $or: [{ $eq: ['$negative_stock', true] }, { $gte: [rounded, -delta] }],
        };
  const row = await items.findOneAndUpdate(
    {
      ...base,
      ...belongs,
      [field]: { $exists: false },
      track_inventory: { $in: [true, 'true'] },
      item_status: { $in: ['regular', 'active'] },
      del_status: { $nin: [1, '1', true] },
      available_quantity: { $type: 'number' },
      $expr: {
        $and: [
          { $lte: [{ $abs: '$available_quantity' }, 1e9] },
          { $lte: [{ $abs: { $subtract: [scaled, rounded] } }, 0.000001] },
          {
            $lt: [
              { $size: { $objectToArray: { $ifNull: ['$extension_stock_effects', {}] } } },
              10000,
            ],
          },
        ],
      },
    },
    [
      {
        $set: {
          updated_date: { $cond: [canApply, '$$NOW', '$updated_date'] },
          available_quantity: {
            $cond: [
              canApply,
              { $divide: [{ $add: [rounded, delta] }, 1000] },
              '$available_quantity',
            ],
          },
          [field]: { digest: { $literal: digest }, applied: canApply },
        },
      },
    ],
    { returnDocument: 'after', projection: { [field]: 1 } }
  );
  const result =
    resultOf(row) || resultOf(await items.findOne(base, { projection: { [field]: 1 } }));
  if (!result) fail('stock_effect_unavailable');
  return result;
}

async function applyStockEffect(db, scope, effect) {
  const result = await applyStockEffectInternal(db, scope, effect);
  if (result.applied) {
    // Retry the deduplicated notification even after a lost acknowledgement.
    // The item timestamp is atomic with stock, so periodic sync can recover
    // when the optional priority outbox is unavailable. Use the same database
    // as the stock write rather than a process-wide connection fallback.
    const outbox = require('../sync/outbox');
    await outbox.enqueueInventory(objectId(effect.itemId), outbox.REASONS.ADJUSTMENT, db);
  }
  return result;
}

module.exports = { applyStockEffect };
