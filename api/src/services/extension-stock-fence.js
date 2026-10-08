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
const oid = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('invalid_stock_scope');
  return new ObjectId(String(value));
};

/** A bounded replay fence for a serialized extension namespace. The host,
 * never the extension payload, supplies the namespace's durable revision.
 * Older writers cannot apply after the next namespace command advances the
 * fence. Each item keeps one opaque receipt per installed extension/branch,
 * rather than one permanent field for every historical adjustment.
 */
async function applyFencedStockEffect(db, scope, effect) {
  const license = oid(scope.license),
    branch = oid(scope.branchId),
    item = oid(effect.itemId);
  const stream = effect.stream;
  if (
    !/^[a-z][a-z0-9.-]{2,99}$/.test(stream?.id || '') ||
    !Number.isSafeInteger(stream?.sequence) ||
    stream.sequence < 1 ||
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(effect.operationId || '') ||
    !Number.isSafeInteger(effect.deltaMilli) ||
    !effect.deltaMilli ||
    Math.abs(effect.deltaMilli) > 1e12
  )
    fail('invalid_stock_fence');
  if (
    effect.reverseOf &&
    (effect.deltaMilli <= 0 || effect.operationId !== `${effect.reverseOf}:reverse`)
  )
    fail('invalid_stock_reversal');
  const token = hash(`${license}:${branch}:${stream.id}`),
    field = `extension_stock_streams.${token}`;
  const digest = hash(
    JSON.stringify({
      sequence: stream.sequence,
      itemId: String(item),
      operationId: effect.reverseOf || effect.operationId,
      deltaMilli: effect.reverseOf ? -effect.deltaMilli : effect.deltaMilli,
    })
  );
  const collection = db.collection('items'),
    base = { _id: item, license };
  const receiptOf = (row) => row?.extension_stock_streams?.[token];
  const inspect = (receipt) => {
    if (!receipt) return null;
    if (receipt.sequence > stream.sequence) fail('stock_effect_superseded');
    if (receipt.sequence !== stream.sequence) return null;
    if (receipt.digest !== digest) fail('stock_operation_conflict');
    if (!effect.reverseOf || receipt.reversed || !receipt.applied)
      return { applied: receipt.applied, operationId: effect.operationId };
    return null;
  };
  const before = receiptOf(await collection.findOne(base, { projection: { [field]: 1 } }));
  const existing = inspect(before);
  if (existing) return existing;
  if (
    effect.reverseOf &&
    (!before || before.sequence !== stream.sequence || before.digest !== digest)
  )
    fail('stock_reversal_unfunded');
  const scaled = { $multiply: ['$available_quantity', 1000] },
    rounded = { $round: [scaled, 0] };
  const permitted =
    effect.deltaMilli > 0
      ? true
      : {
          $or: [{ $eq: ['$negative_stock', true] }, { $gte: [rounded, -effect.deltaMilli] }],
        };
  const fence = effect.reverseOf
    ? {
        [`${field}.sequence`]: stream.sequence,
        [`${field}.digest`]: digest,
        [`${field}.applied`]: true,
        [`${field}.reversed`]: { $ne: true },
      }
    : {
        $or: [
          { [`${field}.sequence`]: { $exists: false } },
          { [`${field}.sequence`]: { $lt: stream.sequence } },
        ],
      };
  const row = await collection.findOneAndUpdate(
    {
      ...base,
      $and: [
        fence,
        { $or: [{ branch_id: branch }, { 'branch_access.branch_id': branch }] },
        { $or: [{ branch_id: { $exists: false } }, { branch_id: branch }] },
        {
          $or: [
            { branch_access: { $exists: false } },
            {
              branch_access: {
                $type: 'array',
                $not: { $elemMatch: { branch_id: { $ne: branch } } },
              },
            },
          ],
        },
      ],
      ...(effect.reverseOf
        ? {}
        : {
            track_inventory: { $in: [true, 'true'] },
            item_status: { $in: ['regular', 'active'] },
            del_status: { $nin: [1, '1', true] },
          }),
      available_quantity: { $type: 'number' },
      $expr: {
        $and: [
          { $lte: [{ $abs: '$available_quantity' }, 1e9] },
          { $lte: [{ $abs: { $subtract: [scaled, rounded] } }, 0.000001] },
        ],
      },
    },
    [
      {
        $set: {
          updated_date: { $cond: [permitted, '$$NOW', '$updated_date'] },
          available_quantity: {
            $cond: [
              permitted,
              { $divide: [{ $add: [rounded, effect.deltaMilli] }, 1000] },
              '$available_quantity',
            ],
          },
          ...(effect.reverseOf
            ? { [`${field}.reversed`]: true }
            : {
                [field]: {
                  sequence: stream.sequence,
                  digest: { $literal: digest },
                  applied: permitted,
                  reversed: false,
                },
              }),
        },
      },
    ],
    { returnDocument: 'after', projection: { [field]: 1 } }
  );
  const outcome =
    inspect(receiptOf(row)) ||
    inspect(receiptOf(await collection.findOne(base, { projection: { [field]: 1 } })));
  if (!outcome) fail('stock_effect_unavailable');
  return outcome;
}
module.exports = { applyFencedStockEffect };
