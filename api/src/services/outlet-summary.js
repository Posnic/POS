'use strict';
const { businessDate, saleContribution, minorUnits } = require('./business-metrics');
const invalid = (message) => {
  throw Object.assign(new Error(message), { statusCode: 422 });
};
function summarize(sales, branch, day) {
  const result = {
    day,
    timezone: branch.timezone,
    currency: branch.currency,
    currencyDigits: branch.currencyDigits,
    outlets: [],
    payments: [],
    bills: 0,
    sales: 0,
    refunds: 0,
    outstanding: 0,
    received: 0,
    settlementBasis:
      'Recorded payments against bills dated in this report; not a cash-drawer reconciliation.',
    unresolved: [],
  };
  const groups = new Map(),
    payments = new Map();
  const add = (row, key, value) => {
    row[key] += value;
    if (!Number.isSafeInteger(row[key])) invalid('Report amount exceeds supported range.');
  };
  for (const sale of sales) {
    const entries = saleContribution(sale, branch).entries.filter((e) => e.businessDate === day);
    if (!entries.length) continue;
    const id = String(sale.outlet_id || 'unassigned');
    if (!groups.has(id))
      groups.set(id, {
        id,
        name: sale.outlet_snapshot?.name || 'General / unassigned',
        bills: 0,
        sales: 0,
        refunds: 0,
        outstanding: 0,
        received: 0,
      });
    const row = groups.get(id);
    for (const e of entries) {
      add(row, 'sales', e.billedSalesMinor);
      add(result, 'sales', e.billedSalesMinor);
      add(row, 'refunds', e.refundsMinor);
      add(result, 'refunds', e.refundsMinor);
    }
    if (businessDate(sale.date, branch.timezone) !== day) continue;
    row.bills++;
    result.bills++;
    const pending = minorUnits(Number(sale.payment_pending || 0), branch.currencyDigits);
    add(row, 'outstanding', pending);
    add(result, 'outstanding', pending);
    if (sale.payment_status === 'Unpaid') continue;
    let split = sale.multi_payment;
    if (typeof split === 'string') {
      try {
        split = JSON.parse(split);
      } catch {
        split = null;
      }
    }
    const amount =
      sale.paid_amount == null
        ? minorUnits(sale.sales_total, branch.currencyDigits) - pending
        : minorUnits(sale.paid_amount, branch.currencyDigits);
    if (amount < 0) invalid('Outstanding balance exceeds the bill total.');
    const pairs =
      split && !Array.isArray(split) && typeof split === 'object' && Object.keys(split).length
        ? Object.entries(split)
        : [[String(sale.payment_mode || '').trim(), amount / 10 ** branch.currencyDigits]];
    let sum = 0;
    const validated = [];
    for (const [method, value] of pairs) {
      const minor = minorUnits(Number(value), branch.currencyDigits);
      if (!method || method.includes(',') || minor < 0) {
        validated.length = 0;
        break;
      }
      sum += minor;
      validated.push([method, minor]);
    }
    if (!validated.length || sum !== amount) {
      result.unresolved.push(String(sale.sales_id || sale._id));
      continue;
    }
    add(row, 'received', amount);
    add(result, 'received', amount);
    for (const [method, minor] of validated) {
      const key = method.toLowerCase();
      if (!payments.has(key)) payments.set(key, { name: method, amount: 0 });
      add(payments.get(key), 'amount', minor);
    }
  }
  result.outlets = [...groups.values()];
  result.payments = [...payments.values()];
  return result;
}
async function read(db, scope, branch, day) {
  const parsed = new Date(day + 'T12:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  )
    invalid('Choose a valid report date.');
  const config = {
    ...require('./business-access').branchInfo(branch),
    license: String(scope.license),
  };
  const mid = Date.parse(day + 'T00:00:00Z');
  const range = { $gte: new Date(mid - 86400000), $lt: new Date(mid + 172800000) };
  const readScope = {
    branch_id: { $in: [scope.branch_id, String(scope.branch_id)] },
    license: { $in: [scope.license, String(scope.license)] },
  };
  const projection = {
    _id: 1,
    branch_id: 1,
    license: 1,
    outlet_id: 1,
    'outlet_snapshot.name': 1,
    date: 1,
    sale_process: 1,
    payment_status: 1,
    sales_id: 1,
    sales_total: 1,
    paid_amount: 1,
    payment_pending: 1,
    multi_payment: 1,
    payment_mode: 1,
    training: 1,
    is_training: 1,
    deleted: 1,
    is_deleted: 1,
    items_return_total: 1,
    'items_return.returnArray.returnObjId': 1,
    'items_return.returnArray.itemsTotalAmount': 1,
    'items_return.returnArray.returnDate': 1,
  };
  const sales = await db
    .collection('sales')
    .find(
      { ...readScope, $or: [{ date: range }, { 'items_return.returnArray.returnDate': range }] },
      { projection }
    )
    .limit(20001)
    .maxTimeMS(10000)
    .toArray();
  if (sales.length > 20000) invalid('This report is too large. Use the detailed sales export.');
  const result = summarize(sales, config, day);
  const sessions = await db
    .collection('cashregister')
    .find(
      { ...readScope, register_closedate: range },
      {
        projection: {
          register_name: 1,
          register_closedate: 1,
          closing_expected: 1,
          closing_counted: 1,
          over_short: 1,
          countedAmount: 1,
        },
      }
    )
    .limit(1001)
    .maxTimeMS(5000)
    .toArray();
  if (sessions.length > 1000) invalid('Too many register closings for one report.');
  const signedMinor = (value) =>
    Math.sign(Number(value)) * minorUnits(Math.abs(Number(value)), config.currencyDigits);
  const closings = sessions
    .filter((s) => businessDate(s.register_closedate, config.timezone) === day)
    .map((s) => ({
      id: String(s._id),
      name: s.register_name || 'Register',
      closedAt: s.register_closedate,
      expected: s.closing_expected == null ? null : signedMinor(s.closing_expected),
      counted:
        s.closing_counted == null ? null : minorUnits(s.closing_counted, config.currencyDigits),
    }));
  const cashExpected = closings.every((c) => c.expected !== null)
    ? closings.reduce((n, c) => n + c.expected, 0)
    : null;
  const cashCounted = closings.every((c) => c.counted !== null)
    ? closings.reduce((n, c) => n + c.counted, 0)
    : null;
  if (
    (cashExpected !== null && !Number.isSafeInteger(cashExpected)) ||
    (cashCounted !== null && !Number.isSafeInteger(cashCounted))
  )
    invalid('Register totals exceed the supported range.');
  const counted = new Map();
  for (const session of sessions.filter(
    (s) => businessDate(s.register_closedate, config.timezone) === day
  )) {
    const seen = new Set();
    for (const entry of session.countedAmount || []) {
      const name = String(entry.paymenttype || '').trim(),
        key = name.toLowerCase();
      if (!name || seen.has(key)) invalid('A register contains an ambiguous payment count.');
      seen.add(key);
      if (!counted.has(key)) counted.set(key, { name, amount: 0 });
      const row = counted.get(key);
      row.amount += minorUnits(entry.value, config.currencyDigits);
      if (!Number.isSafeInteger(row.amount)) invalid('Register totals exceed the supported range.');
    }
  }
  return {
    ...result,
    closings,
    cashExpected,
    cashCounted,
    countedPayments: [...counted.values()],
    branch: branch?.branch_name || '',
    generatedAt: new Date().toISOString(),
  };
}
module.exports = { summarize, read };
