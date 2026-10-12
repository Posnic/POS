'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { context, allowed, fail } = require('../utils/branch-access');
const summary = require('../helpers/sale-payment-summary');
const Money = require('../utils/currency');
const REASONS = [
  'Wrong method selected',
  'Cash recorded as UPI',
  'UPI recorded as cash',
  'Card recorded incorrectly',
  'Mixed payment missed',
  'Split amounts entered wrongly',
];
const fingerprint = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = (c) => ({ branch_id: c.branchId, license: c.license });
const fields = [
  'payment_mode',
  'multi_payment',
  'paid_amount',
  'partial_balance',
  'payment_pending',
  'payment_status',
  'sale_process',
  'items_total',
  'updated_date',
  'payment_corrections',
  'return_refund_lock',
  'return_refund_transactions',
  'captain_edit_token',
  'captain_edit_until',
];
function snapshot(sale) {
  return Object.fromEntries(fields.map((k) => [k, sale[k] ?? null]));
}
function oid(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Sale not found.', 404);
  return new ObjectId(String(id));
}
async function authorize(req, requireEnabled = true) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales write permission is required.', 403);
  const c = await context(req);
  if (requireEnabled && ![true, 'true'].includes(c.branch.allow_payment_correction))
    fail('Enable payment corrections in Sale settings first.', 403);
  return c;
}
function eligible(sale) {
  if (sale.payment_status !== 'Paid' || /cancel|return|refund/i.test(sale.sale_process || ''))
    fail('Only fully paid, non-returned sales can be corrected.', 409);
  if (Number(sale.payment_pending || 0) > 0) fail('Finish collecting this payment first.', 409);
  if (
    sale.return_refund_lock ||
    sale.return_refund_transactions?.length ||
    new Date(sale.captain_edit_until || 0).getTime() >= Date.now()
  )
    fail('This sale has a refund or another edit in progress.', 409);
  if (!summary.rows(sale).length) fail('This sale has no recorded payment breakdown.', 409);
}
async function methods(db, c) {
  const rows = await db.collection('payment_method').find(scope(c)).toArray();
  const result = rows
    .filter((r) => r.enabled !== false)
    .map((r) => String(r.payment_value || r.payment_field || '').trim())
    .filter(Boolean);
  if (
    !c.branch.payment_methods_initialized &&
    !rows.some((r) => /^cash$/i.test(r.payment_field || r.payment_value || ''))
  )
    result.unshift('Cash');
  return [...new Set(result)];
}
function normalize(input, enabled, money) {
  if (!Array.isArray(input) || !input.length || input.length > 20) fail('Choose a payment method.');
  const seen = new Set();
  return input.map((row) => {
    if (
      !row ||
      !enabled.includes(row.method) ||
      seen.has(row.method) ||
      /[.$]/.test(row.method) ||
      ['__proto__', 'constructor', 'prototype'].includes(row.method)
    )
      fail('Choose an enabled payment method.');
    seen.add(row.method);
    const amountPattern =
      money.currencyDigits === 0
        ? /^\d+$/
        : new RegExp('^\\d+(?:\\.\\d{1,' + money.currencyDigits + '})?$');
    if (!amountPattern.test(String(row.amount))) fail('Enter valid payment amounts.');
    const minor = Money.toMinor(row.amount, money);
    if (minor <= 0 || minor > 100000000000) fail('Enter a positive payment amount.');
    return { method: row.method, amount: Money.fromMinor(minor, money) };
  });
}
const comparable = (rows) =>
  rows.map((r) => [r.method.toLowerCase(), r.amount]).sort((a, b) => a[0].localeCompare(b[0]));
function registerQuery(c, id) {
  return {
    ...scope(c),
    $or: [
      { 'register_sales.sales_id': id },
      { 'register_sales.sale_id': id },
      { 'register_sales.sales_id': String(id) },
      { 'register_sales.sale_id': String(id) },
    ],
  };
}
// A journal embedded in the sale makes recovery possible on standalone desktop
// MongoDB too. A pending correction holds the drawer open until projection finishes.
async function recover(db, c, id) {
  const sales = db.collection('sales'),
    registers = db.collection('cashregister');
  const sale = await sales.findOne({ ...scope(c), _id: id });
  const job = sale?.payment_correction_pending;
  if (!job) return sale;
  const worker = new ObjectId().toHexString();
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
  if (!lease.matchedCount) fail('This correction is still processing. Retry in a minute.', 409);
  try {
    for (const registerId of job.registers) {
      const current = await registers.findOne({ ...scope(c), _id: registerId });
      if ((current?.register_sales || []).some((e) => e.payment_correction_id === job.id)) continue;
      const locked = await registers.updateOne(
        { ...scope(c), _id: registerId, register_status: 'Opened' },
        { $addToSet: { payment_correction_locks: job.id } }
      );
      if (!locked.matchedCount) {
        // No sale amounts have changed while still in the prepared state.
        if (!sale.payment_corrections?.some((a) => a.id === job.id)) {
          await sales.updateOne(
            { ...scope(c), _id: id, 'payment_correction_pending.id': job.id },
            { $unset: { payment_correction_pending: '' } }
          );
          await registers.updateMany(
            { ...scope(c), payment_correction_locks: job.id },
            { $pull: { payment_correction_locks: job.id } }
          );
        }
        fail('This register is closed. A closed shift cannot be rewritten.', 409);
      }
    }
    const multi = Object.fromEntries(job.after.map((r) => [r.method, r.amount]));
    const payment_mode = job.after.map((r) => r.method).join(',');
    await sales.updateOne(
      {
        ...scope(c),
        _id: id,
        'payment_correction_pending.id': job.id,
        'payment_corrections.id': { $ne: job.id },
      },
      {
        $set: {
          multi_payment: multi,
          payment_mode,
          updated_date: new Date(),
          updated_by: job.actor,
        },
        $push: {
          payment_corrections: {
            id: job.id,
            before: job.before,
            after: job.after,
            reason: job.reason,
            actor: job.actor,
            actorId: job.actorId,
            at: job.at,
            fingerprint: job.fingerprint,
          },
        },
      }
    );
    for (const registerId of job.registers) {
      await registers.updateOne(
        { ...scope(c), _id: registerId, payment_correction_locks: job.id },
        {
          $set: {
            'register_sales.$[entry].register_paymentmode': payment_mode,
            'register_sales.$[entry].multi_payment': multi,
            'register_sales.$[entry].payment_correction_id': job.id,
            updated_date: new Date(),
          },
          $inc: { payment_correction_revision: 1 },
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
    // Unlock before clearing the journal so a crash never leaves an orphan lock.
    await registers.updateMany(
      { ...scope(c), payment_correction_locks: job.id },
      { $pull: { payment_correction_locks: job.id } }
    );
    await sales.updateOne(
      { ...scope(c), _id: id, 'payment_correction_pending.id': job.id },
      { $unset: { payment_correction_pending: '' }, $set: { updated_date: new Date() } }
    );
    await require('../sync/outbox').enqueue(
      { collection: 'sales', documentId: id, reason: 'sale_inventory' },
      db
    );
    return sales.findOne({ ...scope(c), _id: id });
  } finally {
    await sales.updateOne(
      { ...scope(c), _id: id, 'payment_correction_pending.worker': worker },
      {
        $unset: { 'payment_correction_pending.worker': '', 'payment_correction_pending.until': '' },
      }
    );
  }
}
async function read(req) {
  const c = await authorize(req, false),
    id = oid(req.params.id);
  const sale = await recover(req.db, c, id);
  if (!sale) fail('Sale not found.', 404);
  eligible(sale);
  const money = Money.snapshot(sale);
  return {
    enabled: [true, 'true'].includes(c.branch.allow_payment_correction),
    saleId: String(id),
    bill: sale.sales_id,
    revision: fingerprint(snapshot(sale)),
    payments: summary.rows(sale),
    methods: await methods(req.db, c),
    reasons: REASONS,
    money,
    history: sale.payment_corrections || [],
  };
}
async function save(req) {
  const c = await authorize(req, false),
    id = oid(req.params.id),
    input = req.body || {};
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '')) fail('Invalid correction request.');
  const sale = await recover(req.db, c, id);
  if (!sale) fail('Sale not found.', 404);
  const requestHash = fingerprint({
    payments: input.payments,
    reason: input.reason,
    revision: input.revision,
  });
  const previous = sale.payment_corrections?.find((a) => a.id === input.requestId);
  if (previous) {
    if (previous.fingerprint !== requestHash)
      fail('This request was already used. Reopen the correction.', 409);
    return { saved: true };
  }
  if (![true, 'true'].includes(c.branch.allow_payment_correction))
    fail('Enable payment corrections in Sale settings first.', 403);
  eligible(sale);
  if (fingerprint(snapshot(sale)) !== input.revision)
    fail('This sale changed. Reopen and review it.', 409);
  const money = Money.snapshot(sale),
    before = summary.rows(sale);
  const after = normalize(input.payments, await methods(req.db, c), money);
  const sum = (rows) => rows.reduce((n, r) => n + Money.toMinor(r.amount, money), 0);
  if (sum(before) !== sum(after)) fail('Amounts must equal the payment already collected.');
  if (JSON.stringify(comparable(before)) === JSON.stringify(comparable(after)))
    fail('Choose a different payment method or split.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 300)
    fail('Choose a reason or enter 3 to 300 characters.');
  const registers = await req.db.collection('cashregister').find(registerQuery(c, id)).toArray();
  if (registers.some((r) => r.register_status !== 'Opened'))
    fail('This register is closed. A closed shift cannot be rewritten.', 409);
  // More than one register entry means multiple collections; do not replicate the
  // full bill across those separate collections.
  const entries = registers.flatMap((r) =>
    (r.register_sales || []).filter((e) =>
      [e.sales_id, e.sale_id].some((v) => String(v) === String(id))
    )
  );
  if (entries.length > 1)
    fail('This sale has multiple register collections. Correct it through reconciliation.', 409);
  const pending = {
    id: input.requestId,
    before,
    after,
    reason,
    fingerprint: requestHash,
    actor: String(req.user.username || req.user.name || req.user.email || ''),
    actorId: String(req.user._id),
    at: new Date(),
    registers: registers.map((r) => r._id),
  };
  const expected = Object.fromEntries(
    fields.map((k) => [k, sale[k] === undefined ? { $exists: false } : sale[k]])
  );
  const claimed = await req.db
    .collection('sales')
    .updateOne(
      { ...scope(c), _id: id, ...expected, payment_correction_pending: { $exists: false } },
      { $set: { payment_correction_pending: pending } }
    );
  if (!claimed.matchedCount) fail('This sale changed. Reopen and review it.', 409);
  await recover(req.db, c, id);
  return { saved: true };
}
module.exports = { read, save, recover, REASONS, normalize };
