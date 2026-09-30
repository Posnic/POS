'use strict';
const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const purpose = 'order-restructure';
const problem = () => Object.assign(new Error('This order is being updated. Please retry.'), { status: 409, statusCode: 409 });
const scopeFilter = scope => ({ branch_id: scope.branchId, license: scope.license });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const journalId = (scope, requestId) => 'restructure:' + hash([String(scope.license), String(scope.branchId), requestId]);
const journals = db => db.collection('captain_payment_plans');

// All existing payment/settlement/edit writers already condition their sale
// write on captain_payment_plan being absent. Reserve through that same fence,
// with an explicit non-payment purpose and no monetary entries. Generic sync
// must never copy this journal to another issuer.
async function read(db, scope, requestId, actor) {
  const journal = await journals(db).findOne({ _id: journalId(scope, requestId), ...scopeFilter(scope), purpose });
  if (!journal || journal.actor !== String(actor)) throw problem();
  return journal;
}
async function clear(db, scope, journal) {
  await db.collection('sales').updateMany({ ...scopeFilter(scope),
    // Includes a new destination created by a transfer during projection.
    captain_payment_plan: journal._id,
  }, { $unset: { captain_payment_plan: '' } });
}
async function cancel(db, scope, requestId, actor) {
  const journal = await read(db, scope, requestId, actor);
  if (!['reserving', 'reserved', 'cancelled'].includes(journal.stage)) throw problem();
  const cancelled = await journals(db).updateOne({ _id: journal._id, ...scopeFilter(scope),
    stage: { $in: ['reserving', 'reserved', 'cancelled'] },
  }, { $set: { stage: 'cancelled', cancelledAt: new Date() } });
  if (!cancelled.matchedCount) throw problem();
  // Retain the tombstone, and repeat cleanup on every retry. An acquisition
  // which was already in flight checks this state after its sale CAS too.
  await clear(db, scope, journal);
  return { requestId, stage: 'cancelled' };
}
async function reserve(db, scope, { requestId, actor, intent, sales }) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) ||
      !actor || !intent || !Array.isArray(sales) || !sales.length || sales.length > 2)
    throw problem();
  const ids = sales.map(sale => String(sale._id)).sort();
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-f0-9]{24}$/i.test(id))) throw problem();
  const signature = hash({ actor: String(actor), ids, intent });
  const entry = { _id: journalId(scope, requestId), ...scopeFilter(scope), purpose,
    requestId, actor: String(actor), signature, intent, orderIds: ids,
    sales, payments: [], guests: [], version: 0, state: 'restructuring',
    stage: 'reserving', createdAt: new Date() };
  try { await journals(db).insertOne(entry); }
  catch (error) { if (error.code !== 11000) throw error; }
  let journal = await read(db, scope, requestId, actor);
  if (journal.signature !== signature || journal.stage === 'cancelled') throw problem();
  if (['reserved', 'applying', 'completed'].includes(journal.stage)) return journal;
  try {
    for (const id of journal.orderIds) {
      const sale = journal.sales.find(row => String(row._id) === id);
      const expected = {};
      for (const key of ['items', 'changes', 'kitchen_service', 'sales_total', 'updated_date'])
        expected[key] = sale[key] === undefined ? { $exists: false } : sale[key];
      const result = await db.collection('sales').updateOne({ ...scopeFilter(scope),
        _id: new ObjectId(id), ...expected, sale_process: 'KOT', payment_status: 'Unpaid',
        floor_closed_at: { $exists: false }, order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
        $and: [
          { $or: [{ captain_payment_plan: { $exists: false } }, { captain_payment_plan: journal._id }] },
          { $or: [{ captain_edit_until: { $exists: false } }, { captain_edit_until: { $lt: new Date() } }] },
        ],
      }, { $set: { captain_payment_plan: journal._id } });
      if (!result.matchedCount) throw problem();
      const current = await read(db, scope, requestId, actor);
      if (current.stage === 'cancelled') throw problem();
    }
    await journals(db).updateOne({ _id: journal._id, stage: 'reserving' }, { $set: { stage: 'reserved' } });
    journal = await read(db, scope, requestId, actor);
    if (!['reserved', 'applying', 'completed'].includes(journal.stage)) throw problem();
    return journal;
  } catch (error) {
    await cancel(db, scope, requestId, actor).catch(() => {});
    throw error;
  }
}
async function applying(db, scope, requestId, actor) {
  let journal = await read(db, scope, requestId, actor);
  if (['applying', 'completed'].includes(journal.stage)) return journal;
  if (journal.stage !== 'reserved') throw problem();
  const owned = await db.collection('sales').countDocuments({ ...scopeFilter(scope),
    _id: { $in: journal.orderIds.map(id => new ObjectId(id)) }, captain_payment_plan: journal._id });
  if (owned !== journal.orderIds.length) throw problem();
  await journals(db).updateOne({ _id: journal._id, stage: 'reserved' }, { $set: { stage: 'applying' } });
  journal = await read(db, scope, requestId, actor);
  if (!['applying', 'completed'].includes(journal.stage)) throw problem();
  return journal;
}
// Caller invokes this only after its idempotent sale/seating projections have
// all been verified. A lost acknowledgement can safely repeat the cleanup.
async function complete(db, scope, requestId, actor) {
  const journal = await read(db, scope, requestId, actor);
  if (!['applying', 'completed'].includes(journal.stage)) throw problem();
  const result = await journals(db).updateOne({ _id: journal._id, stage: { $in: ['applying', 'completed'] } },
    { $set: { stage: 'completed', completedAt: new Date() } });
  if (!result.matchedCount) throw problem();
  await clear(db, scope, journal);
  return { requestId, stage: 'completed' };
}
module.exports = { reserve, read, cancel, applying, complete };
