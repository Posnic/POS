'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');

// Claim before submitting a physical pulse. An interrupted/failed hardware
// request is not automatically replayed; the cashier can use the normal manual
// drawer control. Neither a printer failure nor retry can undo a paid sale.
async function claimCashDrawer({ db, scope, descriptor, actor, saleId }) {
  if (!actor.permissions.includes('write'))
    throw Object.assign(new Error('extension_write_required'), { status: 403 });
  if (!/^[a-f0-9]{24}$/i.test(saleId || ''))
    throw Object.assign(new Error('extension_sale_invalid'), { status: 422 });
  const sale = await db.collection('sales').findOne(
    {
      _id: new ObjectId(saleId),
      license: scope.license,
      branch_id: scope.branchId,
      extension_id: descriptor.id,
      payment_status: 'Paid',
      payment_mode: 'Cash',
    },
    { projection: { _id: 1 } }
  );
  if (!sale) throw Object.assign(new Error('extension_cash_sale_unavailable'), { status: 404 });
  const _id = crypto
    .createHash('sha256')
    .update(`${scope.license}:${scope.branchId}:${sale._id}:cash-drawer`)
    .digest('hex');
  try {
    await db
      .collection('extension_hardware_claims')
      .insertOne({
        _id,
        saleId: sale._id,
        license: scope.license,
        branch_id: scope.branchId,
        extensionId: descriptor.id,
        actorId: actor.userId,
        claimedAt: new Date(),
      });
    return { open: true };
  } catch (error) {
    if (error.code === 11000) return { open: false };
    throw error;
  }
}
module.exports = { claimCashDrawer };
