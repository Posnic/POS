'use strict';
const { ObjectId } = require('mongodb');
const Money = require('../utils/currency');
const { validateSaleGrant } = require('./extension-stock-allocations');
const fail = () => {
  const error = new Error('extension_sale_commit_invalid');
  error.code = error.message;
  error.status = 409;
  throw error;
};

/** Replay only a core-calculated, durably authorized sale document. The
 * coordinator builds a limited normal sale (no wallet, invoice or register
 * side effects). Never accept a snapshot from an extension or HTTP request.
 * The Mongo sale identity is shared with the first writer, so a delayed first
 * write and recovery cannot create two sales or different prices.
 */
async function resumeSaleCommit(db, scope, paymentId, stockGrant) {
  const row = await db.collection('extension_payments').findOne({
    _id: paymentId,
    license: new ObjectId(String(scope.license)),
    branch_id: new ObjectId(String(scope.branchId)),
    extensionId: scope.extensionId,
    actorId: String(scope.actorId),
    status: 'submitting',
    'attempt.authorized': true,
  });
  const document = row?.commitDocument;
  if (
    !document ||
    String(document._id) !== String(row.saleId) ||
    String(document.license) !== String(row.license) ||
    String(document.branch_id) !== String(row.branch_id) ||
    document.extension_stock_operation !== row.stockOperationId ||
    document.extension_id !== row.extensionId ||
    document.payment_status !== 'Paid' ||
    document.payment_mode !== (row.method === 'cash' ? 'Cash' : 'Card') ||
    Money.toMinor(document.sales_total, row.currency) !== row.valueMinor ||
    !row.payload ||
    Object.keys(row.payload).some(
      (key) =>
        ![
          'sale_process',
          'payment_mode',
          'sales_total',
          'customer_name',
          'items',
          'multi_payment',
        ].includes(key)
    ) ||
    Number(document.wallet_amount || 0) !== 0 ||
    Number(document.payment_pending || 0) !== 0
  )
    fail();
  await validateSaleGrant(
    stockGrant,
    {
      licenseId: String(row.license),
      branchId: String(row.branch_id),
      userId: row.actorId,
    },
    document.items
  );
  const filter = {
    _id: row.saleId,
    license: row.license,
    branch_id: row.branch_id,
    extension_stock_operation: row.stockOperationId,
  };
  let sale = await db.collection('sales').findOne(filter);
  if (!sale) {
    const repository = require('../repositories/sale.repository');
    try {
      await repository.createSaleUnique(document, () =>
        repository.generateSalesIdForBranch(row.branch_id, { fallbackPrefix: 'S' })
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Duplicate _id/idempotency is success only when this scoped sale exists.
      if (!(await db.collection('sales').findOne(filter))) throw error;
    }
    sale = await db.collection('sales').findOne(filter);
  }
  if (!sale || sale.submission_payload_hash !== document.submission_payload_hash) fail();
  // Same optional acceleration as normal checkout; the periodic sync scan
  // remains the fallback if the process stops before this notification.
  const { enqueue, REASONS } = require('../sync/outbox');
  await enqueue({ collection: 'sales', documentId: sale._id, reason: REASONS.SALE });
  require('../sync/nudge').nudgeSyncAgent();
  return sale;
}
module.exports = { resumeSaleCommit };
