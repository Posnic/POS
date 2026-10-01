'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const Money = require('../utils/currency');
const { runStockBatch } = require('./extension-stock-journal');
const { allocateForSale } = require('./extension-stock-allocations');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
};
const oid = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('extension_payment_scope_invalid');
  return new ObjectId(String(value));
};
function paymentScope(context) {
  return {
    license: oid(context.scope.license),
    branch_id: oid(context.scope.branchId),
    extensionId: context.extensionId,
    actorId: String(oid(context.actorId)),
  };
}
async function saleContext(db, scope) {
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branch_id, license: scope.license });
  const user = await db
    .collection('users')
    .findOne({ _id: oid(scope.actorId), license: scope.license });
  if (!branch || !user) fail('extension_payment_context_unavailable');
  return {
    licenseId: String(scope.license),
    branchId: String(scope.branch_id),
    userId: scope.actorId,
    userName: user.username || user.name || 'Staff',
    branchName: branch.branch_name,
    branchState: String(branch.store_state || branch.state || branch.branch_state || '').trim(),
    printingAddress: branch.printing_address,
    salesPrefix: branch.sales_prefix ?? 'S',
    roundOff: branch.roundOff === true,
    stockManagement: branch.stock_management !== false,
    branchSettings: branch,
  };
}
const publicPayment = (row) => ({
  paymentId: row._id,
  status: row.status,
  ...(row.saleId
    ? {
        saleId: String(row.saleId),
        valueMinor: row.valueMinor,
        quote: row.quote,
        method: row.method,
      }
    : {}),
});

/** Core-owned payment preparation. The quote is persisted before inventory is
 * reserved, and both stock and quantity allocation are replayable. No provider
 * is contacted and no sale is created by preparation.
 */
async function preparePayment(context, input) {
  const { db } = context,
    scope = paymentScope(context);
  if (
    !['cash', 'card'].includes(input.method) ||
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 100
  )
    fail('extension_payment_invalid');
  if (
    input.customer !== undefined &&
    (typeof input.customer !== 'string' || input.customer.length > 120)
  )
    fail('extension_payment_customer_invalid');
  const lines = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0)
      fail('extension_payment_quantity_invalid');
    return { itemId: String(oid(line.itemId)), quantityMilli: line.quantityMilli };
  });
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length)
    fail('extension_payment_duplicate_item');
  if (input.stockOperationId && !/^[a-f\d]{64}$/.test(input.stockOperationId))
    fail('extension_payment_movement_invalid');
  const id = hash(
    `${scope.license}:${scope.branch_id}:${scope.extensionId}:${context.operationId}`
  );
  const digest = hash(
    JSON.stringify({
      actorId: scope.actorId,
      method: input.method,
      lines,
      stockOperationId: input.stockOperationId || null,
      customer: input.customer || '',
    })
  );
  const collection = db.collection('extension_payments');
  try {
    await collection.insertOne({
      _id: id,
      ...scope,
      digest,
      method: input.method,
      lines,
      saleId: new ObjectId(hash(`sale:${id}`).slice(0, 24)),
      status: 'preparing',
      ...(input.stockOperationId ? { stockOperationId: input.stockOperationId } : {}),
      adjusted: Boolean(input.stockOperationId),
      createdAt: new Date(),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  let row = await collection.findOne({ _id: id, ...scope });
  if (!row || row.digest !== digest) fail('extension_payment_conflict');
  if (row.status === 'rejected') return { rejected: true };
  if (row.status !== 'preparing') return publicPayment(row);
  const ctx = await saleContext(db, scope);
  if (!row.quote) {
    const payload = {
      sale_process: 'add',
      payment_mode: row.method === 'cash' ? 'Cash' : 'Card',
      sales_total: 0,
      customer_name: input.customer || '',
      items: lines.map((line) => ({
        item_id: line.itemId,
        item_quantity: line.quantityMilli / 1000,
      })),
    };
    const preview = await require('./sale.service').previewSale(payload, ctx);
    if (!preview.status) fail('extension_payment_quote_invalid');
    const valueMinor = Money.toMinor(preview.data.header.finalSaleTotAmount, ctx.branchSettings);
    if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0)
      fail('extension_payment_amount_invalid');
    // Bind the cash/card ledger to the quoted total. Core validation refuses a
    // changed payable before inserting the sale, rather than silently charging
    // a different amount when catalogue/configuration changed in the meantime.
    payload.sales_total = Money.fromMinor(valueMinor, ctx.branchSettings);
    payload.multi_payment = { [payload.payment_mode]: payload.sales_total };
    await collection.updateOne(
      { _id: id, status: 'preparing', quote: { $exists: false } },
      {
        $set: {
          quote: preview.data,
          valueMinor,
          payload,
        },
      }
    );
    row = await collection.findOne({ _id: id });
  }
  if (!row.stockOperationId) {
    const movement = await runStockBatch(
      db,
      { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
      {
        extensionId: scope.extensionId,
        operationId: `${context.operationId}:payment`,
        lines: row.lines,
        stream: { id: scope.extensionId, sequence: context.sequence },
      }
    );
    if (movement.status === 'rejected') {
      await collection.replaceOne(
        { _id: id, status: 'preparing' },
        { _id: id, ...scope, digest, status: 'rejected' }
      );
      return { rejected: true };
    }
    if (movement.status !== 'committed') fail('extension_payment_stock_unresolved');
    await collection.updateOne(
      { _id: id, status: 'preparing' },
      { $set: { stockOperationId: movement.operationId } }
    );
    row = await collection.findOne({ _id: id });
  }
  await allocateForSale(
    db,
    { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
    {
      extensionId: scope.extensionId,
      stockOperationId: row.stockOperationId,
      saleId: row.saleId,
      lines: row.lines,
    }
  );
  await collection.updateOne({ _id: id, status: 'preparing' }, { $set: { status: 'pending' } });
  return publicPayment(await collection.findOne({ _id: id }));
}

async function confirmCash(context, input, options = {}) {
  const { db } = context,
    scope = paymentScope(context),
    collection = db.collection('extension_payments');
  if (
    !/^[a-f\d]{64}$/.test(input.paymentId || '') ||
    !Number.isSafeInteger(input.tenderMinor) ||
    input.tenderMinor < 0
  )
    fail('extension_cash_confirmation_invalid');
  let row = await collection.findOne({ _id: input.paymentId, ...scope });
  if (!row || row.method !== 'cash') fail('extension_cash_payment_unavailable');
  if (input.tenderMinor < row.valueMinor) fail('extension_cash_tender_insufficient');
  if (row.tenderMinor !== undefined && row.tenderMinor !== input.tenderMinor)
    fail('extension_cash_tender_conflict');
  if (row.status === 'paid')
    return {
      ...publicPayment(row),
      paidAt: row.paidAt,
      tenderMinor: row.tenderMinor,
      changeMinor: row.tenderMinor - row.valueMinor,
    };
  if (!['pending', 'submitting'].includes(row.status)) fail('extension_cash_payment_unavailable');
  await collection.updateOne(
    { _id: row._id, status: 'pending' },
    { $set: { status: 'submitting', tenderMinor: input.tenderMinor } }
  );
  row = await collection.findOne({ _id: row._id });
  if (row.status !== 'submitting' || row.tenderMinor !== input.tenderMinor)
    fail('extension_cash_submission_conflict');
  let sale = await db
    .collection('sales')
    .findOne({
      _id: row.saleId,
      license: scope.license,
      branch_id: scope.branch_id,
      extension_stock_operation: row.stockOperationId,
    });
  if (!sale) {
    const stockGrant = await allocateForSale(
      db,
      { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
      {
        extensionId: scope.extensionId,
        stockOperationId: row.stockOperationId,
        saleId: row.saleId,
        lines: row.lines,
      }
    );
    const ctx = await saleContext(db, scope);
    const save = options.saveSale || require('./sale.service').processSale;
    const result = await save(structuredClone(row.payload), '', 'Add', ctx, { stockGrant });
    sale = await db
      .collection('sales')
      .findOne({
        _id: row.saleId,
        license: scope.license,
        branch_id: scope.branch_id,
        extension_stock_operation: row.stockOperationId,
      });
    if (!sale)
      fail(result.status ? 'extension_cash_sale_unresolved' : 'extension_cash_sale_not_saved');
  }
  const ctx = await saleContext(db, scope);
  if (
    sale.payment_status !== 'Paid' ||
    Money.toMinor(sale.sales_total, ctx.branchSettings) !== row.valueMinor
  )
    fail('extension_cash_sale_mismatch');
  await collection.updateOne(
    { _id: row._id, status: 'submitting' },
    { $set: { status: 'paid', paidAt: sale.date || new Date() } }
  );
  row = await collection.findOne({ _id: row._id });
  return {
    ...publicPayment(row),
    paidAt: row.paidAt,
    tenderMinor: row.tenderMinor,
    changeMinor: row.tenderMinor - row.valueMinor,
  };
}
async function cancelPayment(context, input) {
  const { db } = context,
    scope = paymentScope(context),
    collection = db.collection('extension_payments');
  if (!/^[a-f\d]{64}$/.test(input.paymentId || '')) fail('extension_payment_invalid');
  let row = await collection.findOne({ _id: input.paymentId, ...scope });
  if (!row) fail('extension_payment_unavailable');
  if (row.status === 'cancelled') return { cancelled: true };
  if (!['pending', 'cancelling'].includes(row.status)) fail('extension_payment_cannot_cancel');
  await collection.updateOne(
    { _id: row._id, status: 'pending' },
    { $set: { status: 'cancelling' } }
  );
  row = await collection.findOne({ _id: row._id });
  if (row.status !== 'cancelling') fail('extension_payment_cannot_cancel');
  const funding = await db
    .collection('extension_stock_commands')
    .findOne({ _id: row.stockOperationId, license: scope.license, branch_id: scope.branch_id });
  const stockScope = { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId };
  if (!(funding?.phase === 'cleared' && !row.adjusted)) {
    await require('./extension-stock-allocations').releaseCancelledAllocation(
      db,
      stockScope,
      row._id
    );
    if (!row.adjusted) {
      const lifecycle = require('./extension-stock-lifecycle');
      const action = {
        extensionId: scope.extensionId,
        stockOperationId: row.stockOperationId,
        operationId: `${context.operationId}:cancel`,
        lines: row.lines,
        stream: { id: scope.extensionId, sequence: context.sequence },
      };
      await lifecycle.returnStock(db, stockScope, action);
      await lifecycle.clearStockBasket(db, stockScope, action);
    }
  }
  // Keep the closed request identity, not the cancelled unpaid receipt payload.
  await collection.replaceOne(
    { _id: row._id, status: 'cancelling' },
    {
      _id: row._id,
      ...scope,
      digest: row.digest,
      status: 'cancelled',
    }
  );
  return { cancelled: true };
}
module.exports = { preparePayment, confirmCash, cancelPayment };
