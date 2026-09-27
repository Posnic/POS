'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { snapshotFrom, billForGuest } = require('./guest-bill.service');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oid = (value) => new ObjectId(String(value));
const METHODS = ['Cash', 'Card', 'Upi'];
function settings(branch) {
  const saved = branch.captain_payments || {};
  return {
    enabled:
      saved.enabled === true && ![false, 0, '0', 'false'].includes(branch.module_captain_enable),
    methods: METHODS.filter((method) => (saved.methods || METHODS).includes(method)),
    printReceipt: saved.printReceipt !== false,
  };
}
function validateSettings(value) {
  if (
    typeof value.enabled !== 'boolean' ||
    typeof value.printReceipt !== 'boolean' ||
    !Array.isArray(value.methods) ||
    value.methods.some((method) => !METHODS.includes(method)) ||
    (value.enabled && !value.methods.length)
  )
    fail('Choose at least one payment method.');
  return {
    enabled: value.enabled,
    methods: [...new Set(value.methods)],
    printReceipt: value.printReceipt,
  };
}
async function scope(req, requireEnabled = true) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req);
  const input = { ...req.query, ...req.body };
  if (input.branchId && String(input.branchId) !== String(c.branchId))
    fail('Choose the authorized branch.', 403);
  c.options = settings(c.branch);
  if (req.captainPaymentDesktop) c.options = { ...c.options, enabled: true, methods: METHODS };
  if (requireEnabled && !c.options.enabled) fail('Captain payment collection is disabled.', 403);
  return c;
}
function tableOf(req) {
  const table = String(req.body?.table_number || req.query?.table_number || '').trim();
  if (!table || table.length > 40 || Array.from(table).some((c) => c.charCodeAt(0) < 32))
    fail('Choose a table.');
  return table;
}
const baseFilter = (c) => ({ license: c.license, branch_id: c.branchId });
function wholeGuest(snapshot) {
  const components = {};
  for (const line of snapshot.lines)
    for (const part of line.components)
      components[part.key] = (components[part.key] || 0) + part.minor;
  return {
    index: 0,
    name: 'Table ' + snapshot.table,
    totalMinor: snapshot.totalMinor,
    components,
    lines: snapshot.lines.map((line) => ({
      ...line,
      weight: 1,
      weightTotal: 1,
      components: Object.fromEntries(line.components.map((part) => [part.key, part.minor])),
    })),
  };
}
async function fresh(db, c, table, input) {
  const sales = await db
    .collection('sales')
    .find({ ...baseFilter(c), table_number: table, sale_process: 'KOT', payment_status: 'Unpaid' })
    .sort({ _id: 1 })
    .limit(201)
    .toArray();
  if (!sales.length || sales.length > 200) fail('No payable table bill was found.', 409);
  if (
    sales.some(
      (sale) =>
        sale.captain_payment_plan || Number(sale.paid_amount || sale.partial_balance || 0) > 0
    )
  )
    fail('Refresh the table payment details.', 409);
  const snapshot = snapshotFrom(sales, c.branch, table);
  const batch = await db.collection('printjobs').findOne(
    {
      branch_id: c.branchId,
      kind: 'bill',
      status: 'shadow',
      'payload.table': table,
      'payload.queued': true,
      'payload.revision': snapshot.revision,
    },
    { sort: { created_at: -1 } }
  );
  if (input.plan && input.revision !== snapshot.revision)
    fail('The table changed. Refresh before collecting payment.', 409);
  const guests = input.plan
    ? require('../utils/guest-bill-split').split(snapshot, input.plan)
    : batch?.payload?.guests || [wholeGuest(snapshot)];
  if (
    snapshot.totalMinor <= 0 ||
    sales.some((sale) => !snapshot.lines.some((line) => line.id.startsWith(String(sale._id) + ':')))
  )
    fail('Ask the cashier to settle this bill.', 422);
  return { sales, snapshot, guests };
}
function view(plan, options) {
  const paidGuests = new Set((plan.payments || []).flatMap((p) => p.guests));
  const paidMinor = (plan.payments || []).reduce((sum, p) => sum + p.amountMinor, 0);
  return {
    id: plan._id,
    table: plan.table,
    currency: plan.snapshot.currency,
    totalMinor: plan.snapshot.totalMinor,
    paidMinor,
    dueMinor: plan.snapshot.totalMinor - paidMinor,
    version: plan.version || 0,
    guests: plan.guests.map((guest, index) => ({
      name: guest.name,
      totalMinor: guest.totalMinor,
      paid: guest.totalMinor === 0 || paidGuests.has(index),
    })),
    payments: (plan.payments || []).map((p) => ({
      id: p.id,
      method: p.method,
      amountMinor: p.amountMinor,
      receivedMinor: p.receivedMinor,
      changeMinor: p.changeMinor,
      staff: p.staffName,
      at: p.at,
      reference: p.reference,
    })),
    ...options,
  };
}
// Every effect is derived from the durable payment journal. Replaying repairs
// an interrupted write without incrementing money, touching stock or reprinting.
async function reconcile(db, c, plan) {
  const payments = plan.payments || [];
  if (!payments.length) return;
  for (const sale of plan.sales) {
    const multi = {};
    let paid = 0;
    for (const payment of payments) {
      const amount = payment.allocations[String(sale._id)] || 0;
      if (!amount) continue;
      paid += amount;
      multi[payment.method] = Math.round(((multi[payment.method] || 0) + amount / 100) * 100) / 100;
    }
    const total = plan.saleTotals[String(sale._id)];
    const due = total - paid;
    if (!Number.isSafeInteger(due) || due < 0)
      throw new Error('Payment journal exceeds the order total.');
    const update = await db.collection('sales').updateOne(
      {
        ...baseFilter(c),
        _id: sale._id,
        captain_payment_plan: plan._id,
        $or: [
          { captain_payment_version: { $exists: false } },
          { captain_payment_version: { $lte: plan.version } },
        ],
      },
      {
        $set: {
          captain_payment_version: plan.version,
          paid_amount: paid / 100,
          partial_balance: paid / 100,
          payment_pending: due / 100,
          balance: due / 100,
          payment_status: due ? 'Unpaid' : 'Paid',
          partial_check: due > 0 && paid > 0,
          payment_mode: Object.keys(multi).join(','),
          multi_payment: multi,
          payment_description: 'Collected in Captain',
          updated_date: new Date(),
          updated_by: payments[payments.length - 1].staffName,
          updated_by_id: oid(payments[payments.length - 1].staffId),
          captain_payments: payments
            .filter((p) => p.allocations[String(sale._id)] > 0)
            .map((p) => ({
              id: p.id,
              method: p.method,
              amount: p.allocations[String(sale._id)] / 100,
              reference: p.reference,
              staffId: p.staffId,
              staffName: p.staffName,
              at: p.at,
            })),
        },
      }
    );
    if (!update.matchedCount) {
      const current = await db.collection('sales').findOne({ ...baseFilter(c), _id: sale._id });
      if (
        current?.captain_payment_plan !== plan._id ||
        current.captain_payment_version < plan.version
      )
        throw new Error('Payment projection needs recovery.');
    }
    // Existing drawer links keep their tender totals. Floor payments without a
    // drawer remain attributed to the collecting staff member on the sale.
    await db.collection('cashregister').updateMany(
      { ...baseFilter(c), 'register_sales.sales_id': sale._id },
      {
        $set: {
          'register_sales.$[entry].register_paymentmode': Object.keys(multi).join(','),
          'register_sales.$[entry].multi_payment': multi,
          'register_sales.$[entry].captain_payment_version': plan.version,
        },
      },
      {
        arrayFilters: [
          {
            'entry.sales_id': sale._id,
            $or: [
              { 'entry.captain_payment_version': { $exists: false } },
              { 'entry.captain_payment_version': { $lte: plan.version } },
            ],
          },
        ],
      }
    );
    try {
      require('../sync/outbox').enqueue({
        collection: 'sales',
        documentId: sale._id,
        reason: 'sale',
      });
      require('../sync/nudge').nudgeSyncAgent();
    } catch {
      /* Periodic sync also discovers changed sales. */
    }
  }
  let receiptPending = false;
  if (payments.some((p) => p.printReceipt)) {
    const queue = require('../repositories/print-job.repository').queuePrintJob;
    for (const payment of payments) {
      if (!payment.printReceipt) continue;
      const selected = payment.guests.map((index) => plan.guests[index]);
      const guest = {
        index: 0,
        name: selected.map((g) => g.name).join(', '),
        totalMinor: payment.amountMinor,
        components: {},
        lines: selected.flatMap((g) => g.lines),
      };
      for (const g of selected)
        for (const [key, amount] of Object.entries(g.components))
          guest.components[key] = (guest.components[key] || 0) + amount;
      const payload = billForGuest(plan.snapshot, guest, c.branch, plan.sales[0], hash(payment.id));
      payload.title = 'PAYMENT RECEIPT';
      payload.billNo = 'CP-' + payment.id.slice(-10);
      payload.footer = 'Payment received. Keep this receipt.';
      payload.extras = [
        { label: 'Payment', value: payment.method },
        { label: 'Received', value: (payment.receivedMinor / 100).toFixed(2) },
        { label: 'Change', value: (payment.changeMinor / 100).toFixed(2) },
        { label: 'Staff', value: payment.staffName },
      ];
      const copies = Math.max(1, Math.min(3, Number(c.branch.bill_print_copies) || 1));
      for (let copy = 1; copy <= copies; copy++) {
        const result = await queue({
          branchId: c.branchId,
          kind: 'bill',
          ticketKey: 'captain-payment:' + payment.id + ':' + copy,
          payload,
          label: 'Payment · ' + plan.table,
        }).catch(() => ({ status: false }));
        if (!result.status) receiptPending = true;
      }
    }
    require('../helpers/bill-notify').notifyBillRequested({
      branchId: c.branchId,
      table: plan.table,
    });
  }
  if (receiptPending) throw new Error('Payment saved; receipt is pending.');
  const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  await db.collection('captain_payment_plans').updateOne(
    { _id: plan._id, version: plan.version },
    {
      $set: {
        projectedVersion: plan.version,
        receiptPending,
        state: paid === plan.snapshot.totalMinor ? 'paid' : 'open',
      },
    }
  );
}
async function prepare(req) {
  const c = await scope(req),
    db = req.db,
    table = tableOf(req);
  const plans = db.collection('captain_payment_plans');
  let plan = await plans.findOne(
    { ...baseFilter(c), table, state: { $in: ['preparing', 'open', 'releasing'] } },
    { sort: { createdAt: -1 } }
  );
  if (plan) {
    if (plan.state === 'preparing' || plan.state === 'releasing') {
      if (plan.state === 'preparing' && Date.now() - new Date(plan.createdAt).getTime() < 60000)
        fail('The bill is being prepared. Please retry.', 409);
      await require('./captain-payment-guard').mutable(db, {
        captain_payment_plan: plan._id,
        ...baseFilter(c),
      });
      return prepare(req);
    }
    await reconcile(db, c, plan);
    return view(plan, c.options);
  }
  if (!settings(c.branch).enabled) fail('Captain payment collection is disabled.', 403);
  const data = await fresh(db, c, table, req.body);
  const planId = crypto.randomUUID();
  plan = {
    _id: planId,
    ...baseFilter(c),
    table,
    sales: data.sales,
    snapshot: data.snapshot,
    guests: data.guests,
    saleTotals: {},
    printReceipt: c.options.printReceipt,
    payments: [],
    version: 0,
    state: 'preparing',
    createdAt: new Date(),
  };
  for (const line of data.snapshot.lines) {
    const id = line.id.split(':')[0];
    plan.saleTotals[id] = (plan.saleTotals[id] || 0) + line.amountMinor;
  }
  try {
    await plans.insertOne(plan);
  } catch (e) {
    if (e.code !== 11000) throw e;
    const current = await plans.findOne({ _id: planId });
    if (current.state === 'open' || current.state === 'paid') return view(current, c.options);
    fail('The bill is being prepared. Please retry.', 409);
  }
  try {
    for (const sale of data.sales) {
      const match = {
        ...baseFilter(c),
        _id: sale._id,
        payment_status: 'Unpaid',
        sale_process: 'KOT',
        captain_payment_plan: { $exists: false },
        $or: [
          { captain_edit_until: { $exists: false } },
          { captain_edit_until: { $lt: new Date() } },
        ],
        items: sale.items,
        sales_total: sale.sales_total,
        updated_date: sale.updated_date || { $exists: false },
      };
      const result = await db
        .collection('sales')
        .updateOne(match, { $set: { captain_payment_plan: planId } });
      if (!result.matchedCount) fail('The table changed. Refresh before collecting payment.', 409);
    }
    const opened = await plans.updateOne(
      { _id: planId, state: 'preparing' },
      { $set: { state: 'open' } }
    );
    if (!opened.modifiedCount) fail('The table changed. Refresh before collecting payment.', 409);
    plan.state = 'open';
    return view(plan, c.options);
  } catch (error) {
    await require('./captain-payment-guard')
      .mutable(db, { captain_payment_plan: planId, ...baseFilter(c) })
      .catch(() => {});
    throw error;
  }
}
async function release(req) {
  const c = await scope(req, false),
    db = req.db;
  const planId = String(req.body.planId || '');
  const result = await db
    .collection('captain_payment_plans')
    .findOneAndUpdate(
      { ...baseFilter(c), _id: planId, state: 'open', payments: { $size: 0 } },
      { $set: { state: 'releasing' } },
      { returnDocument: 'after' }
    );
  const plan = result?.value || result;
  if (plan?._id) {
    await db
      .collection('sales')
      .updateMany(
        { ...baseFilter(c), captain_payment_plan: planId },
        { $unset: { captain_payment_plan: '' } }
      );
    await db.collection('captain_payment_plans').deleteOne({ _id: planId, state: 'releasing' });
  }
  return { released: Boolean(plan?._id) };
}
async function record(req) {
  const c = await scope(req, false),
    db = req.db,
    input = req.body;
  if (typeof input.request_id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.request_id))
    fail('Invalid payment request.');
  const plans = db.collection('captain_payment_plans');
  await plans.createIndex(
    { branch_id: 1, 'payments.id': 1 },
    { unique: true, partialFilterExpression: { 'payments.id': { $exists: true } } }
  );
  const used = await plans.findOne({ ...baseFilter(c), 'payments.id': input.request_id });
  if (used && used._id !== input.planId) fail('This payment request was already used.', 409);
  let plan = await plans.findOne({ ...baseFilter(c), _id: String(input.planId || '') });
  if (!plan) fail('Refresh the table payment details.', 409);
  const signature = hash({
    planId: input.planId,
    guest: input.guest ?? null,
    amountMinor: input.amountMinor,
    method: input.method,
    receivedMinor: input.receivedMinor,
    reference: input.reference || '',
  });
  const previous = (plan.payments || []).find((p) => p.id === input.request_id);
  if (previous) {
    if (previous.signature !== signature) fail('This payment request was already used.', 409);
    await reconcile(db, c, plan);
    return { ...view(plan, c.options), confirmed: input.request_id };
  }
  if (!Number.isSafeInteger(input.version) || input.version !== plan.version)
    fail('Another payment changed this bill. Refresh before collecting more.', 409);
  if (!c.options.enabled || !c.options.methods.includes(input.method))
    fail('This payment method is not enabled in Captain.', 403);
  const paidGuests = new Set(plan.payments.flatMap((p) => p.guests));
  const indexes =
    input.guest === null || input.guest === undefined
      ? plan.guests.map((_, i) => i).filter((i) => !paidGuests.has(i))
      : [input.guest];
  if (
    !indexes.length ||
    indexes.some((i) => !Number.isInteger(i) || !plan.guests[i] || paidGuests.has(i))
  )
    fail('This guest bill has already been paid. Refresh the bill.', 409);
  const amount = indexes.reduce((sum, i) => sum + plan.guests[i].totalMinor, 0);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor !== amount || amount <= 0)
    fail('The amount changed. Review the bill again.', 409);
  if (
    !Number.isSafeInteger(input.receivedMinor) ||
    input.receivedMinor < amount ||
    input.receivedMinor > 1e12 ||
    (input.method !== 'Cash' && input.receivedMinor !== amount)
  )
    fail('Enter the amount received.');
  if (typeof (input.reference || '') !== 'string' || (input.reference || '').length > 100)
    fail('Invalid payment reference.');
  const allocations = {};
  for (const index of indexes)
    for (const line of plan.guests[index].lines) {
      const id = line.id.split(':')[0];
      allocations[id] = (allocations[id] || 0) + line.amountMinor;
    }
  if (
    Object.values(allocations).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    Object.values(allocations).reduce((a, b) => a + b, 0) !== amount
  )
    fail('Ask the cashier to settle this bill.', 422);
  const payment = {
    id: input.request_id,
    signature,
    guests: indexes,
    amountMinor: amount,
    printReceipt: plan.printReceipt,
    receivedMinor: input.receivedMinor,
    changeMinor: input.receivedMinor - amount,
    method: input.method,
    reference: (input.reference || '').trim(),
    allocations,
    at: new Date(),
    staffId: String(req.user._id || req.user.id),
    staffName: String(req.user.name || req.user.username || req.user.email || ''),
  };
  const result = await plans
    .updateOne(
      {
        _id: plan._id,
        ...baseFilter(c),
        state: 'open',
        version: plan.version,
        'payments.id': { $ne: input.request_id },
      },
      { $push: { payments: payment }, $inc: { version: 1 } }
    )
    .catch((error) => {
      if (error.code === 11000) fail('This payment request was already used.', 409);
      throw error;
    });
  if (!result.modifiedCount) {
    plan = await plans.findOne({ _id: plan._id, ...baseFilter(c) });
    const same = plan.payments.find((p) => p.id === input.request_id);
    if (!same || same.signature !== signature)
      fail('Another payment changed this bill. Refresh before collecting more.', 409);
  } else plan = await plans.findOne({ _id: plan._id, ...baseFilter(c) });
  await reconcile(db, c, plan);
  return { ...view(plan, c.options), confirmed: input.request_id };
}
module.exports = { settings, validateSettings, scope, prepare, release, record, reconcile, view };
