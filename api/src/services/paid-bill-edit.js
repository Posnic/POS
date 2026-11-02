'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { context, allowed, fail } = require('../utils/branch-access');
const summary = require('../helpers/sale-payment-summary');
const Money = require('../utils/currency');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = (c) => ({ branch_id: c.branchId, license: c.license });
const answer = (id) => ({
  status: true,
  data: { sales_id: String(id) },
  message: 'Bill correction saved.',
});
const quantity = (item) => Number(item.item_quantity ?? item.quantity ?? 0);
function quantities(items) {
  const result = new Map();
  for (const item of items || []) {
    const key = String(item.item_id);
    const qty = require('../helpers/selling-units').stockQuantity(item, quantity(item));
    if (!ObjectId.isValid(key) || !Number.isFinite(qty) || qty < 0) fail('Invalid item quantity.');
    result.set(key, (result.get(key) || 0) + qty);
  }
  return result;
}
// Every projection carries the operation ID. A retry finishes the same correction;
// it cannot restore stock twice or create a second payment.
async function recover(db, c, id) {
  const sales = db.collection('sales');
  let sale = await sales.findOne({ ...scope(c), _id: id });
  const job = sale?.payment_correction_pending;
  if (!job || job.kind !== 'paid-bill-edit') return sale;
  const worker = crypto.randomUUID();
  const lease = await sales.updateOne(
    {
      ...scope(c),
      _id: id,
      'payment_correction_pending.id': job.id,
      $or: [
        { 'payment_correction_pending.until': { $exists: false } },
        { 'payment_correction_pending.until': { $lt: new Date() } },
      ],
    },
    {
      $set: {
        'payment_correction_pending.worker': worker,
        'payment_correction_pending.until': new Date(Date.now() + 60000),
      },
    }
  );
  if (!lease.matchedCount) fail('This bill correction is processing. Retry in a minute.', 409);
  try {
    const registers = db.collection('cashregister');
    for (const rid of job.registers) {
      const locked = await registers.updateOne(
        { ...scope(c), _id: rid, register_status: 'Opened' },
        { $addToSet: { payment_correction_locks: job.id } }
      );
      if (!locked.matchedCount) {
        if (!sale.paid_bill_corrections?.some((entry) => entry.id === job.id)) {
          await sales.updateOne(
            { ...scope(c), _id: id, 'payment_correction_pending.id': job.id },
            { $unset: { payment_correction_pending: '' } }
          );
          await registers.updateMany(
            { ...scope(c), payment_correction_locks: job.id },
            { $pull: { payment_correction_locks: job.id } }
          );
        }
        fail('This register is closed. The bill cannot be corrected.', 409);
      }
    }
    await sales.updateOne(
      {
        ...scope(c),
        _id: id,
        'payment_correction_pending.id': job.id,
        'paid_bill_corrections.id': { $ne: job.id },
      },
      {
        $set: job.after,
        $unset: { captain_payment_plan: '' },
        $push: {
          paid_bill_corrections: {
            id: job.id,
            fingerprint: job.fingerprint,
            at: job.at,
            actor: job.actor,
            actorId: job.actorId,
            reason: job.reason,
            before: job.before,
            after: job.after,
            paymentPlan: job.paymentPlan,
            money_movement: false,
          },
        },
      }
    );
    for (const stock of job.stock) {
      const restored = await db.collection('items').updateOne(
        { ...scope(c), _id: stock.id, paid_bill_edit_operations: { $ne: job.id } },
        {
          $inc: { available_quantity: stock.quantity },
          $addToSet: { paid_bill_edit_operations: job.id },
          $set: { updated_date: new Date() },
        }
      );
      if (
        !restored.matchedCount &&
        !(await db
          .collection('items')
          .findOne({ ...scope(c), _id: stock.id, paid_bill_edit_operations: job.id }))
      )
        fail(
          'The corrected bill is saved, but an item is missing. Restore the item and retry to finish stock reconciliation.',
          409
        );
    }
    if (job.logStock)
      for (const stock of job.stock) {
        const logId = new ObjectId(hash(job.id + ':' + String(stock.id)).slice(0, 24));
        await db.collection('stocklogs').updateOne(
          { _id: logId },
          {
            $setOnInsert: {
              ...scope(c),
              view_item_id: stock.id,
              item_name: stock.name || '',
              item_barcode_id: stock.barcode || '',
              item_quantity: stock.quantity,
              count: stock.quantity,
              process: 'Edit Sale',
              action: 'add',
              stocklog: true,
              date: job.at,
              created_date: job.at,
              updated_date: job.at,
              reference: String(id),
              note: job.reason,
              changed_by: job.actor,
            },
          },
          { upsert: true }
        );
      }
    for (const rid of job.registers) {
      await registers.updateOne(
        { ...scope(c), _id: rid, payment_correction_locks: job.id },
        {
          $set: {
            'register_sales.$[entry].register_amount': job.after.sales_total,
            'register_sales.$[entry].register_paymentmode': job.after.payment_mode,
            'register_sales.$[entry].multi_payment': job.after.multi_payment,
            'register_sales.$[entry].register_tax': job.after.tax,
            'register_sales.$[entry].register_discount': job.after.discount,
            'register_sales.$[entry].payment_correction_id': job.id,
            updated_date: new Date(),
          },
        },
        {
          arrayFilters: [
            {
              $or: [
                { 'entry.sales_id': id },
                { 'entry.sale_id': id },
                { 'entry.sales_id': String(id) },
                { 'entry.sale_id': String(id) },
              ],
            },
          ],
        }
      );
    }
    await registers.updateMany(
      { ...scope(c), payment_correction_locks: job.id },
      { $pull: { payment_correction_locks: job.id } }
    );
    await sales.updateOne(
      { ...scope(c), _id: id, 'payment_correction_pending.id': job.id },
      { $unset: { payment_correction_pending: '' } }
    );
    await require('../sync/outbox').enqueue(
      { collection: 'sales', documentId: id, reason: 'sale_inventory' },
      db
    );
    for (const stock of job.stock)
      await require('../sync/outbox').enqueue(
        { collection: 'items', documentId: stock.id, reason: 'sale_inventory' },
        db
      );
    sale = await sales.findOne({ ...scope(c), _id: id });
    return sale;
  } finally {
    await sales.updateOne(
      { ...scope(c), _id: id, 'payment_correction_pending.worker': worker },
      {
        $unset: { 'payment_correction_pending.worker': '', 'payment_correction_pending.until': '' },
      }
    );
  }
}
async function amend(req, payload, saleContext, options = {}) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales write permission is required.', 403);
  const c = await context(req),
    db = req.db;
  const request = payload.paid_bill_correction;
  if (
    !request ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(request.id || '') ||
    typeof request.reason !== 'string' ||
    request.reason.trim().length < 3 ||
    request.reason.length > 300
  )
    fail('Review the bill correction and enter a reason.');
  const id = new ObjectId(req.params.id),
    fingerprint = hash(payload);
  const old = await db.collection('sales').findOne({ ...scope(c), _id: id });
  if (!old) fail('Sale not found.', 404);
  const previous = old.paid_bill_corrections?.find((row) => row.id === request.id);
  if (previous && previous.fingerprint !== fingerprint)
    fail('Reopen this bill before submitting a different correction.', 409);
  if (old.payment_correction_pending) {
    if (
      old.payment_correction_pending.id !== request.id ||
      old.payment_correction_pending.fingerprint !== fingerprint
    )
      fail('Finish the pending payment correction first.', 409);
    await recover(db, c, id);
    return answer(id);
  }
  if (previous) return answer(id);
  if (![true, 'true'].includes(c.branch.allow_payment_correction))
    fail('Enable payment corrections in Sale settings first.', 403);
  if (
    old.payment_status !== 'Paid' ||
    /cancel|return|refund/i.test(old.sale_process || '') ||
    old.items_return?.length ||
    old.return_refund_transactions?.length ||
    old.return_refund_lock
  )
    fail('Only fully paid bills without returns can be corrected.', 409);
  if (
    Number(old.payment_pending || 0) !== 0 ||
    old.partial_check === true ||
    old.partial_check === 'true' ||
    old.extension_stock_operation ||
    old.captain_transfer_allocation ||
    old.source_invoice_id ||
    Number(old.loyalty_redeem_points || 0) > 0 ||
    Number(old.wallet_amount || 0) > 0 ||
    payload.wallet_check === 'true'
  )
    fail('This bill needs payment reconciliation before it can be edited.', 409);
  if (String(old.customer_id) !== String(payload.customer_id))
    fail('Keep the original customer for a paid bill correction.');
  if (
    Number(request.originalTotal) !== Number(old.sales_total) ||
    String(request.updatedAt || '') !== new Date(old.updated_date).toISOString()
  )
    fail('This bill changed. Reopen it and review the correction.', 409);
  const plan = await db.collection('captain_payment_plans').findOne({
    ...scope(c),
    _id: old.captain_payment_plan || old.paid_bill_corrections?.at(-1)?.paymentPlan,
  });
  const allocations = (plan?.payments || []).flatMap((p) => Object.keys(p.allocations || {}));
  if (
    !plan ||
    plan.state !== 'paid' ||
    !allocations.length ||
    (plan.sales && plan.sales.length !== 1) ||
    allocations.some((key) => key !== String(id))
  )
    fail('Shared or unfinished Captain payments need reconciliation before editing.', 409);
  const journalPaid = plan.payments.reduce(
    (sum, p) => sum + Number(p.allocations[String(id)] || 0),
    0
  );
  const money = Money.policy(c.branch);
  if (
    (old.captain_payment_plan && journalPaid !== Money.toMinor(old.paid_amount, money)) ||
    Money.toMinor(old.paid_amount, money) !== Money.toMinor(old.sales_total, money)
  )
    fail('The recorded payment does not match this bill. Reconcile it first.', 409);
  const paymentOptions = await require('./payment-correction').read(req);
  const quote =
    options.quote ||
    (async () =>
      require('./sale.service').processSale(payload, String(id), 'Edit', saleContext, {
        preparePaidEdit: true,
      }));
  const prepared = await quote();
  if (!prepared.status) fail(prepared.message);
  const after = prepared.data;
  if (
    after.payment_status !== 'Paid' ||
    !Number.isFinite(Number(after.sales_total)) ||
    Number(after.sales_total) <= 0
  )
    fail('The corrected bill must have a positive, fully recorded payment.');
  if (
    Number(after.loyalty_redeem_points || 0) > 0 ||
    Number(after.loyalty_redeem_value || 0) > 0 ||
    Number(after.tip_amount || 0) !== Number(old.tip_amount || 0) ||
    String(after.coupon_code || '') !== String(old.coupon_code || '')
  )
    fail('Loyalty, coupon or tip adjustments require reconciliation before editing this bill.');
  const payments = require('./payment-correction').normalize(
    summary.rows(after).map((row) => ({
      method:
        paymentOptions.methods.find((m) => m.toLowerCase() === row.method.toLowerCase()) ||
        row.method,
      amount: row.amount,
    })),
    paymentOptions.methods,
    money
  );
  if (
    payments.reduce((n, p) => n + Money.toMinor(p.amount, money), 0) !==
    Money.toMinor(after.sales_total, money)
  )
    fail('Payment amounts must equal the corrected bill total.');
  const beforeQuantities = quantities(old.items),
    afterQuantities = quantities(after.items);
  for (const [key, qty] of afterQuantities)
    if (qty > (beforeQuantities.get(key) || 0))
      fail(
        'Use a new sale for additional items. This correction can remove items or change their prices.'
      );
  const stock = [];
  for (const [key, qty] of beforeQuantities) {
    const difference = qty - (afterQuantities.get(key) || 0);
    if (difference <= 0) continue;
    const item = await db.collection('items').findOne({ ...scope(c), _id: new ObjectId(key) });
    if (!item) fail('An original item is missing. Restore it before correcting this bill.');
    if ([true, 'true'].includes(item.track_inventory))
      stock.push({
        id: item._id,
        quantity: difference,
        name: item.name || item.item_name || '',
        barcode: item.itemid || '',
      });
  }
  const registers = await db
    .collection('cashregister')
    .find({
      ...scope(c),
      $or: [
        { 'register_sales.sales_id': id },
        { 'register_sales.sale_id': id },
        { 'register_sales.sales_id': String(id) },
        { 'register_sales.sale_id': String(id) },
      ],
    })
    .toArray();
  if (registers.some((r) => r.register_status !== 'Opened'))
    fail('This register is closed. The bill cannot be corrected.', 409);
  if (
    registers.flatMap((r) =>
      (r.register_sales || []).filter((e) =>
        [e.sales_id, e.sale_id].some((v) => String(v) === String(id))
      )
    ).length > 1
  )
    fail('This bill has multiple register collections. Reconcile it before editing.', 409);
  after.paid_amount = Number(after.sales_total);
  after.partial_balance = Number(after.sales_total);
  after.balance = 0;
  after.payment_pending = 0;
  after.multi_payment = Object.fromEntries(payments.map((p) => [p.method, p.amount]));
  after.payment_mode = payments.map((p) => p.method).join(',');
  // These describe a closed order; amending its invoice must not reopen the kitchen.
  for (const key of [
    'sale_process',
    'date',
    'settled_at',
    'floor_closed_at',
    'order_state',
    'kitchen_closed',
    'table_id',
    'table_number',
    'person_count',
    'dine_type',
    'customer_id',
  ])
    if (old[key] !== undefined) after[key] = old[key];
  if (old.cashregister_id === undefined) delete after.cashregister_id;
  else after.cashregister_id = old.cashregister_id;
  for (const key of ['user_id', 'user_name']) if (old[key] !== undefined) after[key] = old[key];
  after.updated_date = new Date();
  if (after.payment_description === 'Collected in Captain')
    after.payment_description = 'Corrected recorded payment';
  const job = {
    kind: 'paid-bill-edit',
    id: request.id,
    fingerprint,
    reason: String(request.reason).trim().slice(0, 300),
    at: new Date(),
    actor: String(req.user.username || req.user.name || ''),
    actorId: String(req.user._id),
    paymentPlan: plan._id,
    before: {
      items: old.items,
      sales_total: old.sales_total,
      subtotal: old.sales_sub_total,
      tax: old.tax,
      discount: old.discount,
      round_off: old.round_off,
      paid_amount: old.paid_amount,
      payments: summary.rows(old),
    },
    after,
    stock,
    logStock: [true, 'true'].includes(c.branch.stock_management_log),
    registers: registers.map((r) => r._id),
  };
  const claimed = await db.collection('sales').updateOne(
    {
      ...scope(c),
      _id: id,
      updated_date: old.updated_date,
      items: old.items,
      captain_payment_plan:
        old.captain_payment_plan === undefined ? { $exists: false } : old.captain_payment_plan,
      payment_status: 'Paid',
      paid_amount: old.paid_amount,
      payment_correction_pending: { $exists: false },
      return_refund_lock: { $exists: false },
      $or: [
        { captain_edit_until: { $exists: false } },
        { captain_edit_until: { $lt: new Date() } },
      ],
    },
    { $set: { payment_correction_pending: job } }
  );
  if (!claimed.matchedCount) fail('This bill changed. Reopen it before editing.', 409);
  await recover(db, c, id);
  return answer(id);
}
module.exports = { amend, recover };
