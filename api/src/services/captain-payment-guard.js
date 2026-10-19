'use strict';
const { ObjectId } = require('mongodb');
const message =
  'This bill has a recorded restaurant payment. Ordinary sale edits cannot overwrite it. Open payment details to review the recorded payments.';
const paidMessage =
  'This restaurant bill is already paid. Use Return items to reverse the sale, or Correct payment to change the payment method.';
async function mutable(db, sale) {
  if (sale?.payment_correction_pending)
    throw Object.assign(new Error('Finish the pending payment correction first.'), { status: 409 });
  if (!sale?.captain_payment_plan) return;
  const plans = db.collection('captain_payment_plans');
  const id = sale.captain_payment_plan;
  const result = await plans.findOneAndUpdate(
    { _id: id, payments: { $size: 0 }, state: { $in: ['open', 'preparing', 'releasing'] } },
    { $set: { state: 'releasing' } },
    { returnDocument: 'after' }
  );
  const plan = result?.value || result;
  if (plan?._id) {
    await db
      .collection('sales')
      .updateMany(
        { captain_payment_plan: id, branch_id: sale.branch_id, license: sale.license },
        { $unset: { captain_payment_plan: '' } }
      );
    await plans.deleteOne({ _id: id, state: 'releasing' });
    if (typeof sale.set === 'function') sale.set('captain_payment_plan', undefined);
    else delete sale.captain_payment_plan;
    return;
  }
  const operation = await plans.findOne({ _id: id }, { projection: { purpose: 1, state: 1 } });
  throw Object.assign(
    new Error(
      operation?.purpose === 'order-restructure'
        ? 'This order is being updated. Please retry.'
        : operation?.state === 'paid'
          ? paidMessage
          : message
    ),
    { status: 409, statusCode: 409 }
  );
}
// Payment reservation checks this short edit lease. A crash expires the lease;
// it never clears a recorded payment or authorizes a second payment.
async function beginEdit(db, sale) {
  await mutable(db, sale);
  const branch = await db
    .collection('branches')
    .findOne({ _id: sale.branch_id, license: sale.license });
  if (
    !require('../utils/captain-payment-enabled')(branch) &&
    ![true, 'true'].includes(branch?.allow_payment_correction)
  )
    return null;
  const token = new ObjectId().toHexString();
  const result = await db.collection('sales').updateOne(
    {
      _id: sale._id,
      license: sale.license,
      branch_id: sale.branch_id,
      captain_payment_plan: { $exists: false },
      payment_correction_pending: { $exists: false },
      $or: [
        { captain_edit_until: { $exists: false } },
        { captain_edit_until: { $lt: new Date() } },
      ],
    },
    { $set: { captain_edit_token: token, captain_edit_until: new Date(Date.now() + 5 * 60000) } }
  );
  if (!result.matchedCount)
    throw Object.assign(new Error('This order is being updated. Please retry.'), {
      status: 409,
      statusCode: 409,
    });
  return async () => {
    await db
      .collection('sales')
      .updateOne(
        { _id: sale._id, captain_edit_token: token },
        { $unset: { captain_edit_token: '', captain_edit_until: '' } }
      );
  };
}
module.exports = { mutable, beginEdit, message };
