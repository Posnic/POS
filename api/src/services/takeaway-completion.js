'use strict';
const { rounds } = require('../helpers/kitchen-rounds');
const { ObjectId } = require('mongodb');

// Payment alone does not mean a takeaway has been handed over. Derive completion
// from served quantities, not kitchen_closed (older payment saves reset that flag).
function completed(sale) {
  if (sale?.toObject) sale = sale.toObject();
  if (!sale || !/^take[\s_-]*away$/i.test(sale.fulfilment || sale.dine_type || '')) return false;
  if (sale.payment_status !== 'Paid' || sale.floor_lifecycle !== true) return false;
  if (['pending', 'rejected', 'cancelled'].includes(sale.order_state)) return false;
  if (!['KOT', 'Add', 'Edit'].includes(sale.sale_process)) return false;
  if (
    ['payment_pending', 'balance'].some((key) => {
      const value = Number(sale[key] ?? 0);
      return !Number.isFinite(value) || value > 0;
    })
  )
    return false;
  const lines = rounds(sale).flatMap((round) => round.items);
  return lines.length > 0 && lines.every((line) => line.remaining === 0);
}

async function reconcile(db, scope, saleId) {
  if (
    !/^[a-f\d]{24}$/i.test(String(scope.branchId)) ||
    !/^[a-f\d]{24}$/i.test(String(scope.license))
  )
    return;
  if (saleId != null && !/^[a-f\d]{24}$/i.test(String(saleId))) return;
  const branchId = new ObjectId(String(scope.branchId));
  const license = new ObjectId(String(scope.license));
  const collection = db.collection('sales');
  const filter = {
    branch_id: branchId,
    license,
    floor_closed_at: { $exists: false },
    floor_lifecycle: true,
    payment_status: 'Paid',
    $or: [{ dine_type: /^take[\s_-]*away$/i }, { fulfilment: /^take[\s_-]*away$/i }],
    ...(saleId ? { _id: new ObjectId(String(saleId)) } : {}),
  };
  for await (const sale of collection.find(filter)) {
    if (!completed(sale)) continue;
    if (sale.captain_payment_plan) {
      const plan = await db.collection('captain_payment_plans').findOne({
        _id: { $eq: sale.captain_payment_plan },
        branch_id: branchId,
        license,
      });
      if (!plan || plan.state !== 'paid' || plan.projectedVersion !== plan.version) continue;
    }
    // Fence changes to quantities, payment and transfer state between read/write.
    const snapshot = Object.fromEntries(
      [
        'updated_date',
        'items',
        'changes',
        'kitchen_service',
        'payment_pending',
        'balance',
        'captain_payment_plan',
        'captain_payment_version',
        'order_state',
        'sale_process',
        'dine_type',
        'fulfilment',
      ].map((key) => [key, sale[key] === undefined ? { $exists: false } : { $eq: sale[key] }])
    );
    const result = await collection.updateOne(
      { ...filter, _id: { $eq: sale._id }, ...snapshot },
      {
        $set: { floor_closed_at: new Date(), kitchen_closed: true, updated_date: new Date() },
      }
    );
    if (result.modifiedCount) {
      try {
        require('../sync/outbox').enqueue({
          collection: 'sales',
          documentId: sale._id,
          reason: 'sale',
        });
        require('../sync/nudge').nudgeSyncAgent();
      } catch {
        /* Periodic sync discovers updated_date too. */
      }
    }
  }
}
// Never turn an already committed payment/service action into a failed response.
// Floor refresh repeats this reconciliation after a transient database failure.
async function recover(db, scope, saleId) {
  try {
    await reconcile(db, scope, saleId);
  } catch (error) {
    console.warn('[takeaway] Completion reconciliation pending:', error.message);
  }
}
module.exports = { completed, reconcile, recover };
