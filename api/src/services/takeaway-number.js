'use strict';
const crypto = require('crypto');
const { context, allowed, fail } = require('../utils/branch-access');

// The unique branch/number index is the allocation lock. Reservations survive
// retries and abandoned drafts; issued numbers are never recycled.
async function allocate(db, scope, requestId, orderKey) {
  if (!requestId || String(requestId).length > 200) fail('An order request ID is required.', 422);
  const branch = String(scope.branchId);
  const license = String(scope.license);
  const _id = crypto
    .createHash('sha256')
    .update(JSON.stringify([license, branch, String(requestId)]))
    .digest('hex');
  const collection = db.collection('takeaway_numbers');
  await collection.createIndex({ license: 1, branch: 1, number: -1 }, { unique: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await collection.findOne({ _id });
    if (existing) {
      if (orderKey) {
        const bound = await collection.updateOne(
          { _id, $or: [{ order_key: { $exists: false } }, { order_key: String(orderKey) }] },
          { $set: { order_key: String(orderKey) } }
        );
        if (!bound.matchedCount)
          fail('This takeaway number belongs to an order already sent. Start a new order.', 409);
      }
      return existing.number;
    }
    const latest = await collection.findOne({ license, branch }, { sort: { number: -1 } });
    const number = (latest?.number || 0) + 1;
    try {
      await collection.insertOne({
        _id,
        license,
        branch,
        number,
        ...(orderKey ? { order_key: String(orderKey) } : {}),
        created_at: new Date(),
      });
      return number;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  fail('Please retry assigning the takeaway number.', 503);
}
async function reserve(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Permission is required.', 403);
  const scope = await context(req);
  return { number: await allocate(req.db, scope, req.body?.request_id) };
}
module.exports = { allocate, reserve };
