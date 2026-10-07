'use strict';
const { ObjectId } = require('mongodb');
const namespace = require('./extension-namespace');
const Money = require('../utils/currency');
const { receiptDocument } = require('../helpers/bill-payload');
const fail = (code, status = 409) => {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
};

async function readReceipt({ db, scope, descriptor, actor, request }) {
  if (typeof descriptor.readReceipt !== 'function') fail('extension_receipt_unavailable', 404);
  if (!request || Buffer.byteLength(JSON.stringify(request)) > 32768)
    fail('extension_receipt_request_invalid', 422);
  const current = await namespace.readNamespace(db, scope, descriptor, actor);
  if (current.busy) fail('extension_operation_unresolved');
  const result = await descriptor.readReceipt({ state: current.state, request });
  if (result?.kind === 'paid') {
    if (!/^[a-f\d]{24}$/i.test(result.saleId || '')) fail('extension_receipt_invalid');
    const sale = await db
      .collection('sales')
      .findOne(
        {
          _id: new ObjectId(result.saleId),
          license: scope.license,
          branch_id: scope.branchId,
          extension_id: descriptor.id,
          payment_status: 'Paid',
        },
        { projection: { _id: 1 } }
      );
    if (!sale) fail('extension_receipt_unavailable', 404);
    return { kind: 'paid', saleId: String(sale._id) };
  }
  if (
    !['pending', 'held'].includes(result?.kind) ||
    (result.kind === 'pending' && !/^[a-f\d]{64}$/.test(result.stockOperationId || '')) ||
    !Array.isArray(result.lines) ||
    !result.lines.length ||
    result.lines.length > 200 ||
    typeof result.reference !== 'string' ||
    result.reference.length > 100 ||
    typeof result.customer !== 'string' ||
    result.customer.length > 120 ||
    !Number.isFinite(Date.parse(result.createdAt))
  )
    fail('extension_receipt_invalid');
  let available;
  if (result.kind === 'held') {
    // A verified read-only projection of the scoped namespace. No stock
    // movement or sale is required or created for an unpaid basket slip.
    available = Object.fromEntries(result.lines.map(line => [line.productId, line.quantityMilli]));
  } else {
  const movement = await db.collection('extension_stock_commands').findOne({
    _id: result.stockOperationId,
    license: scope.license,
    branch_id: scope.branchId,
    extensionId: descriptor.id,
    phase: 'committed',
  });
  if (!movement || movement.lifecycle) fail('extension_receipt_unavailable', 404);
  available = {
    ...(movement.remaining ||
      Object.fromEntries(movement.lines.map((line) => [line.itemId, line.quantityMilli]))),
  };
  // A prepared but unpaid allocation still belongs on a pending goods slip.
  // Paid/uncertain submissions never get added back to the printable balance.
  for (const [saleId, allocation] of Object.entries(movement.allocations || {})) {
    if (allocation.state === 'released') continue;
    const payment = await db.collection('extension_payments').findOne({
      saleId: new ObjectId(saleId),
      license: scope.license,
      branch_id: scope.branchId,
      extensionId: descriptor.id,
      stockOperationId: movement._id,
      status: 'pending',
    });
    if (payment)
      for (const line of allocation.lines)
        available[line.itemId] = (available[line.itemId] || 0) + line.quantityMilli;
  }
  }
  const selected = new Map();
  let value = 0n;
  for (const line of result.lines) {
    if (
      !/^[a-f\d]{24}$/i.test(line.productId || '') ||
      typeof line.description !== 'string' ||
      line.description.length > 200 ||
      !Number.isSafeInteger(line.quantityMilli) ||
      line.quantityMilli <= 0 ||
      !Number.isSafeInteger(line.priceMinor) ||
      line.priceMinor < 0
    )
      fail('extension_receipt_invalid');
    selected.set(line.productId, (selected.get(line.productId) || 0) + line.quantityMilli);
    value += (BigInt(line.quantityMilli) * BigInt(line.priceMinor) + 500n) / 1000n;
  }
  for (const [id, quantity] of selected)
    if (!Number.isSafeInteger(quantity) || quantity > (available[id] || 0))
      fail('extension_receipt_quantity_unavailable');
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || Number(value) !== result.valueMinor)
    fail('extension_receipt_total_invalid');
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branchId, license: scope.license });
  if (!branch) fail('extension_branch_unavailable', 403);
  const currency = Money.policy(result.currency || branch);
  const lines = result.lines.map((line) => ({
    item_name: line.description,
    item_quantity: line.quantityMilli / 1000,
    item_price: Money.fromMinor(line.priceMinor, currency),
    total_amount: Money.fromMinor(
      Number((BigInt(line.quantityMilli) * BigInt(line.priceMinor) + 500n) / 1000n),
      currency
    ),
  }));
  const total = Money.fromMinor(result.valueMinor, currency);
  const stamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: result.timeZone || branch.time_zone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(result.createdAt));
  const document = receiptDocument({ customer_name: result.customer, items: lines }, branch, {
    storeName: branch.branch_name,
    storeAddress: branch.printing_address || '',
    date: stamp,
    currency: currency.currencyCode || currency.currencySymbol,
    subTotal: total,
    total,
    taxes: [],
    discount: 0,
    roundOff: 0,
    items: lines.map((line) => ({
      name: line.item_name,
      qty: line.item_quantity,
      rate: line.item_price,
      amount: line.total_amount,
    })),
  });
  document.pending_goods_receipt = true;
  document.document_reference = result.reference;
  document.payment_status = 'Pending';
  document.gst = 'disable';
  // Ensure deletion or a concurrent payment did not invalidate this read while
  // the worker was preparing it. Nothing is persisted or queued by this endpoint.
  const latest = await namespace.readNamespace(db, scope, descriptor, actor);
  if (latest.busy || latest.revision !== current.revision) fail('extension_receipt_changed');
  return { kind: 'pending', document };
}
module.exports = { readReceipt };
