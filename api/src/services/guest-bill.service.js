'use strict';
const crypto = require('node:crypto');
const Money = require('../utils/currency');
const { buildBillPayload } = require('../helpers/bill-payload');
const { allocate, split } = require('../utils/guest-bill-split');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const amountMinor = (value, policy) => {
  const n = Money.toMinor(value || 0, policy);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw problem('Invalid bill amount.', 422);
  return n;
};
function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function snapshotFrom(sales, branch, table) {
  const monetary = Money.policy(branch);
  const minor = (value) => amountMinor(value, monetary);
  const lines = [],
    labels = { base: 'Subtotal', discount: 'Discount', adjustment: 'Adjustments' };
  let totalMinor = 0;
  for (const sale of sales) {
    const live = (sale.items || []).filter(
      (it) =>
        it &&
        !it.return &&
        !it.cancelled &&
        !['cancelled', 'canceled'].includes(String(it.status || '').toLowerCase()) &&
        Number(it.quantity ?? it.item_quantity ?? it.qty) > 0 &&
        String(it.name || it.item_name || '').trim()
    );
    const payload = buildBillPayload({ ...sale, items: live }, branch);
    if (!payload.items.length) continue;
    const bases = payload.items.map((it) => Math.max(0, minor(it.amount)));
    const weights = bases.some(Boolean) ? bases : bases.map(() => 1);
    const taxWeights = live.map((it) => Math.max(0, minor(it.item_tax ?? it.tax_amount ?? 0)));
    const taxBasis = taxWeights.some(Boolean) ? taxWeights : weights;
    const components = [
      { key: 'base', amount: minor(payload.subTotal), weights },
      { key: 'discount', amount: -minor(payload.discount), weights },
    ];
    for (const tax of payload.taxes || []) {
      const key = 'tax:' + tax.label;
      labels[key] = tax.label;
      components.push({ key, amount: minor(tax.amount), weights: taxBasis });
    }
    const total = minor(payload.total);
    if (total < 0) throw problem('Refunds cannot be split as unpaid guest bills.', 422);
    components.push({
      key: 'adjustment',
      amount: total - components.reduce((n, c) => n + c.amount, 0),
      weights,
    });
    const distributed = components.map((c) => ({ ...c, parts: allocate(c.amount, c.weights) }));
    payload.items.forEach((item, i) => {
      const parts = distributed.map((c) => ({ key: c.key, minor: c.parts[i] }));
      lines.push({
        id: String(sale._id) + ':' + i,
        name: item.name,
        ...require('../utils/item-localization').snapshot(item),
        quantity: Number(item.qty),
        seat: Number(live[i]?.seat) || 0,
        components: parts,
        amountMinor: parts.reduce((n, c) => n + c.minor, 0),
      });
    });
    totalMinor += total;
  }
  if (!lines.length || totalMinor <= 0)
    throw problem('There is no unpaid bill to split on this table.', 409);
  const revision = hash(
    sales
      .map((s) => ({
        id: String(s._id),
        updated: s.updated_date || s.updated_at,
        items: s.items,
        total: s.sales_total,
        sub: s.sales_sub_total,
        discount: s.discount,
        tax: s.sales_tax,
        round: s.round_off,
        payment: s.payment_status,
      }))
      .concat([{ lines, totalMinor, ...monetary }])
  );
  return {
    table,
    revision,
    ...monetary,
    totalMinor,
    labels,
    lines,
    guests: Math.max(2, Math.min(20, Number(sales[0].person_count) || 2)),
  };
}
function billForGuest(snapshot, guest, branch, sale, batchId) {
  const base = buildBillPayload(sale, branch);
  const monetary = Money.snapshot(snapshot);
  const factor = monetary.factor;
  const value = (key) => (guest.components[key] || 0) / factor;
  return {
    ...base,
    currency: monetary.currencySymbol,
    currencyCode: monetary.currencyCode,
    currencyDigits: monetary.currencyDigits,
    title: 'GUEST BILL',
    billNo: batchId.slice(-8) + '-' + (guest.index + 1),
    customer: '',
    serviceRows: [
      { label: 'Table', value: snapshot.table },
      { label: 'Guest', value: guest.name },
    ],
    items: guest.lines.map((line) => ({
      name: line.name,
      ...require('../utils/item-localization').snapshot(line),
      qty:
        line.weight === line.weightTotal
          ? String(line.quantity)
          : `${line.weight}/${line.weightTotal} x ${line.quantity}`,
      rate: '',
      amount: (line.components.base || 0) / factor,
    })),
    subTotal: value('base'),
    discount: -value('discount'),
    roundOff: value('adjustment'),
    total: guest.totalMinor / factor,
    taxes: Object.entries(guest.components)
      .filter(([key]) => key.startsWith('tax:'))
      .map(([key, n]) => ({ label: snapshot.labels[key], amount: n / factor })),
    extras: [
      { label: 'Payment', value: 'Pay at counter' },
      {
        label: 'Table total',
        value: (snapshot.totalMinor / factor).toFixed(monetary.currencyDigits),
      },
    ],
    footer: 'Guest share of the table bill. Not a payment receipt.',
    footerImage: null,
    footerImageCaption: '',
    totalQty: '',
  };
}
function createService(deps = {}) {
  const models = () => ({
    Sale: deps.Sale || require('../models/sale.model'),
    Branch: deps.Branch || require('../models/branch.model'),
    Jobs: deps.Jobs || require('../models/print-job.model'),
  });
  function scope(input) {
    const branchId = String(input.branchId || '').toLowerCase(),
      table = String(input.table_number || '').trim();
    if (
      !/^[a-f\d]{24}$/i.test(branchId) ||
      !table ||
      table.length > 40 ||
      Array.from(table).some((character) => character.charCodeAt(0) < 32)
    )
      throw problem('Choose a branch and table.');
    return { branchId, table };
  }
  async function read(input) {
    const { branchId, table } = scope(input),
      { Sale, Branch } = models();
    const sales = await Sale.find({
      branch_id: branchId,
      table_number: table,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    })
      .sort({ _id: 1 })
      .limit(201)
      .lean();
    if (sales.length > 200)
      throw problem('This table has too many open orders. Ask the cashier for help.', 422);
    const branch = await Branch.findById(branchId).lean();
    if (!branch) throw problem('Shop not found.', 404);
    return { sales, branch, snapshot: snapshotFrom(sales, branch, table) };
  }
  async function send(input) {
    const { branchId, table } = scope(input),
      { Jobs } = models();
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.request_id || ''))
      throw problem('Invalid bill request.');
    const ticket = 'guest-batch:' + input.request_id;
    const requestHash = hash({
      table,
      revision: input.revision,
      plan: input.plan,
      copies: input.copies || 1,
    });
    let batch = await Jobs.findOne({ branch_id: branchId, ticket_key: ticket }).lean();
    if (!batch) {
      const { sales, branch, snapshot } = await read(input);
      if (snapshot.revision !== input.revision)
        throw problem('The table changed. Refresh the bill before splitting.', 409);
      let guests;
      try {
        guests = split(snapshot, input.plan || {});
      } catch (e) {
        throw problem(e.message, 422);
      }
      const copies = Math.max(
        1,
        Math.min(3, Math.floor(Number(input.copies) || Number(branch.bill_print_copies) || 1))
      );
      const batchId = hash([branchId, input.request_id]);
      const data = {
        requestHash,
        table,
        revision: snapshot.revision,
        snapshot,
        guests,
        copies,
        queued: false,
        bills: guests.map((g) => billForGuest(snapshot, g, branch, sales[0], batchId)),
      };
      try {
        batch = await Jobs.findOneAndUpdate(
          { branch_id: branchId, ticket_key: ticket },
          {
            $setOnInsert: {
              _id: hash([branchId, ticket]).slice(0, 24),
              branch_id: branchId,
              ticket_key: ticket,
              kind: 'bill',
              status: 'shadow',
              payload: data,
              label: 'Guest bill plan',
              created_at: new Date(),
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).lean();
      } catch (e) {
        if (e.code !== 11000) throw e;
        batch = await Jobs.findOne({ branch_id: branchId, ticket_key: ticket }).lean();
      }
    }
    if (batch.payload.requestHash !== requestHash)
      throw problem('This request was already used for a different split.', 409);
    const data = batch.payload;
    const queue = deps.queue || require('../repositories/print-job.repository').queuePrintJob;
    for (let guest = 0; guest < data.bills.length; guest++)
      for (let copy = 1; copy <= data.copies; copy++) {
        const result = await queue({
          branchId,
          kind: 'bill',
          ticketKey: `${ticket}:${guest}:${copy}`,
          payload: data.bills[guest],
          label: `Table ${table} · ${data.guests[guest].name} (${copy}/${data.copies})`,
        });
        if (!result.status)
          throw problem(
            'The bills could not all be queued. Retry to finish the same request.',
            503
          );
      }
    await Jobs.updateOne({ _id: batch._id }, { $set: { 'payload.queued': true } });
    (deps.notify || require('../helpers/bill-notify').notifyBillRequested)({
      branchId,
      table: table,
      count: data.bills.length * data.copies,
    });
    return {
      request_id: input.request_id,
      guests: data.guests.map((g) => ({ name: g.name, totalMinor: g.totalMinor })),
      totalMinor: data.snapshot.totalMinor,
      queued: true,
    };
  }
  async function latest(input) {
    const { branchId, table } = scope(input),
      { Jobs } = models();
    const batch = await Jobs.findOne({
      branch_id: branchId,
      status: 'shadow',
      kind: 'bill',
      'payload.table': table,
      'payload.queued': true,
    })
      .sort({ created_at: -1 })
      .lean();
    if (!batch) return null;
    let snapshot;
    try {
      ({ snapshot } = await read(input));
    } catch (error) {
      if (error.status === 409) return null;
      throw error;
    }
    return {
      guests: batch.payload.guests.map((g) => ({ name: g.name, totalMinor: g.totalMinor })),
      totalMinor: batch.payload.snapshot.totalMinor,
      ...Money.snapshot(batch.payload.snapshot),
      stale: snapshot.revision !== batch.payload.revision,
    };
  }
  return { read, send, latest };
}
module.exports = { createService, snapshotFrom, billForGuest };
