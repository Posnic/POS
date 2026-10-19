'use strict';
const { ObjectId } = require('mongodb');
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

// Hard deletion is authorized by the controller and requires a retained backup.
// Keep the payment journal: deleting it would allow a payment retry to run again.
async function begin(db, sale) {
  if (!sale.captain_payment_plan) {
    const release = await require('./captain-payment-guard').beginEdit(db, sale);
    return {
      finish: async () => {
        if (release) await release();
      },
    };
  }
  const scope = { branch_id: sale.branch_id, license: sale.license };
  const plans = db.collection('captain_payment_plans');
  const plan = await plans.findOne({ ...scope, _id: sale.captain_payment_plan });
  if (!plan)
    throw conflict(
      'Delete this restaurant sale on the installation that collected its payment. Its payment journal is not available here.'
    );
  if (
    Array.isArray(plan.payments) &&
    !plan.payments.length &&
    ['open', 'preparing', 'releasing'].includes(plan.state)
  ) {
    const release = await require('./captain-payment-guard').beginEdit(db, sale);
    return {
      finish: async () => {
        if (release) await release();
      },
    };
  }
  if (plan.state === 'deleting')
    throw conflict(
      'A previous deletion needs review before retrying. Payment and stock cleanup may be incomplete.'
    );
  if (
    plan.state !== 'paid' ||
    plan.projectedVersion !== plan.version ||
    plan.receiptPending ||
    sale.payment_status !== 'Paid' ||
    sale.captain_payment_version !== plan.version ||
    !Array.isArray(plan.sales) ||
    plan.sales.length !== 1 ||
    String(plan.sales[0]._id) !== String(sale._id)
  ) {
    throw conflict(
      'Only a fully settled, single-sale restaurant payment can be deleted. Complete pending payments or use Return items for a shared bill.'
    );
  }
  if (
    sale.payment_correction_pending ||
    sale.return_refund_lock ||
    sale.items_return?.length ||
    sale.return_refund_transactions?.length ||
    sale.payment_corrections?.length ||
    sale.paid_bill_corrections?.length
  )
    throw conflict(
      'This sale has returns or payment corrections. Use its return workflow instead of deleting it.'
    );
  const token = new ObjectId().toHexString();
  const sales = db.collection('sales');
  const locked = await sales.updateOne(
    {
      ...scope,
      _id: sale._id,
      captain_payment_plan: plan._id,
      captain_payment_version: plan.version,
      payment_status: 'Paid',
      sale_process: sale.sale_process,
      updated_date: sale.updated_date,
      payment_correction_pending: { $exists: false },
      return_refund_lock: { $exists: false },
      'return_refund_transactions.0': { $exists: false },
      'items_return.0': { $exists: false },
      'payment_corrections.0': { $exists: false },
      'paid_bill_corrections.0': { $exists: false },
      $or: [
        { captain_edit_until: { $exists: false } },
        { captain_edit_until: { $lt: new Date() } },
      ],
    },
    { $set: { captain_edit_token: token, captain_edit_until: new Date('9999-01-01') } }
  );
  if (!locked.matchedCount)
    throw conflict('This sale changed or is being updated. Refresh and retry.');
  const marked = await plans.updateOne(
    {
      ...scope,
      _id: plan._id,
      state: 'paid',
      version: plan.version,
      projectedVersion: plan.version,
    },
    { $set: { state: 'deleting', deletion_token: token, deletion_started_at: new Date() } }
  );
  if (!marked.matchedCount) {
    await sales.updateOne(
      { ...scope, _id: sale._id, captain_edit_token: token },
      { $unset: { captain_edit_token: '', captain_edit_until: '' } }
    );
    throw conflict('The payment journal changed. Refresh and retry.');
  }
  return {
    filter: { _id: sale._id, captain_payment_plan: plan._id, captain_edit_token: token },
    async finish({ completed, started }) {
      if (completed) {
        await plans.updateOne(
          { ...scope, _id: plan._id, deletion_token: token, state: 'deleting' },
          { $set: { state: 'deleted', deleted_at: new Date() } }
        );
      } else if (!started) {
        await plans.updateOne(
          { ...scope, _id: plan._id, deletion_token: token, state: 'deleting' },
          { $set: { state: 'paid' }, $unset: { deletion_token: '', deletion_started_at: '' } }
        );
        await sales.updateOne(
          { ...scope, _id: sale._id, captain_edit_token: token },
          { $unset: { captain_edit_token: '', captain_edit_until: '' } }
        );
      }
      // Once cleanup starts, retain the lock on failure. Blind retries could
      // restore stock twice; an interrupted deletion requires reconciliation.
    },
  };
}
module.exports = { begin };
