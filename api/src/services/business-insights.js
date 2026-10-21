'use strict';
const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const { businessDate, saleContribution, minorUnits } = require('./business-metrics');
const { itemSaleContribution } = require('./business-item-metrics');
const businessSalesOwner = require('../helpers/business-sales-owner');
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const sum = (a, b) => {
  const n = a + b;
  if (!Number.isSafeInteger(n)) fail('summary_unavailable', 503);
  return n;
};
const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;

/** One bounded indexed read, never N daily top-list merges or an unbounded scan. */
async function readBusinessInsights(db, context, query, { now = Date.now } = {}) {
  if (!context.capabilities.includes('overview.read')) fail('access_denied', 403);
  const branch = context.branches.find((b) => b.id === query.branchId);
  if (!branch) fail('access_denied', 403);
  const today = businessDate(new Date(now()), branch.timezone);
  const all = query.period === 'all';
  const from = all ? null : query.from,
    to = all ? today : query.to;
  if ((!all && (!validDate(from) || from > to)) || !validDate(to) || to > today)
    fail('invalid_request');
  const start = from ? moment.tz(from, branch.timezone) : null;
  const end = moment.tz(to, branch.timezone).add(1, 'day');
  const dates = { ...(start ? { $gte: start.toDate() } : {}), $lt: end.toDate() };
  const strings = {
    ...(start ? { $gte: start.clone().subtract(2, 'days').format('YYYY-MM-DD') } : {}),
    $lt: end.clone().add(2, 'days').format('YYYY-MM-DD'),
  };
  const scope = {
    license: { $in: [new ObjectId(context.businessId), context.businessId] },
    branch_id: { $in: [new ObjectId(branch.id), branch.id] },
  };
  const queries = [
    ['business_sales_day', { ...scope, $or: [{ date: dates }, { date: strings }] }],
    [
      'business_returns_day',
      {
        ...scope,
        $or: [dates, strings].map((range) => ({
          items_return: { $elemMatch: { 'returnArray.returnDate': range } },
        })),
      },
    ],
  ];
  const sales = [],
    seen = new Set(),
    started = Date.now();
  let scanned = 0;
  for (const [hint, filter] of queries) {
    const remaining = 2500 - (Date.now() - started);
    if (remaining <= 0) fail('summary_unavailable', 503);
    const cursor = db
      .collection('sales')
      .find(filter, {
        hint,
        maxTimeMS: remaining,
        projection: {
          _id: 1,
          license: 1,
          branch_id: 1,
          date: 1,
          updated_date: 1,
          sale_process: 1,
          payment_status: 1,
          sales_total: 1,
          items_return_total: 1,
          items_return: 1,
          training: 1,
          is_training: 1,
          deleted: 1,
          is_deleted: 1,
          items: 1,
          business_item_origin: 1,
          return_refund_transactions: 1,
          created_by: 1,
          created_by_id: 1,
          channel: 1,
          'client.staff_id': 1,
          'client.staff_name': 1,
          user_id: 1,
          user_name: 1,
          'origin.actor_id': 1,
          'origin.actor_name': 1,
          sales_id: 1,
          discount: 1,
          sale_extra_discount: 1,
          payment_pending: 1,
          paid_amount: 1,
          multi_payment: 1,
          payment_mode: 1,
          table_id: 1,
          table_number: 1,
          venue: 1,
        },
      })
      .batchSize(100)
      .limit(10001);
    try {
      for await (const sale of cursor) {
        if (++scanned > 10000 || Date.now() - started > 2500) fail('summary_unavailable', 503);
        if (!seen.has(String(sale._id))) {
          seen.add(String(sale._id));
          sales.push(sale);
        }
      }
    } finally {
      await cursor.close();
    }
  }
  try {
    return summarizeInsights(
      sales,
      context,
      branch,
      { from, to },
      new Date(now()).toISOString(),
      started + 3000
    );
  } catch (error) {
    if (error.status) throw error;
    fail('summary_unavailable', 503);
  }
}

function summarizeInsights(sales, context, branch, range, checkedAt, deadline = Infinity) {
  const within = (day) => (!range.from || day >= range.from) && day <= range.to;
  const config = { ...branch, license: context.businessId };
  const result = {
    schemaVersion: 1,
    businessId: context.businessId,
    branchId: branch.id,
    from: range.from,
    to: range.to,
    currency: branch.currency,
    currencyDigits: branch.currencyDigits,
    timezone: branch.timezone,
    billedSalesMinor: 0,
    refundsMinor: 0,
    salesAfterReturnsMinor: 0,
    bills: 0,
    checkedAt,
    complete: false,
    items: null,
    staff: null,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, billedSalesMinor: 0, bills: 0 })),
    discounts: { amountMinor: 0, bills: 0 },
    returns: { amountMinor: 0, transactions: 0 },
    payments: null,
    restaurant: null,
    details: [],
  };
  const items = new Map(),
    tables = new Map(),
    staff = new Map(),
    methods = new Map();
  let itemValid = true,
    paymentValid = true,
    discountValid = true,
    received = 0,
    unpaid = 0;
  for (const sale of sales) {
    if (Date.now() > deadline) fail('summary_unavailable', 503);
    const canonical = saleContribution(sale, config);
    const entries = canonical.entries.filter((e) => within(e.businessDate));
    if (!entries.length) continue;
    if (!range.from)
      for (const e of entries)
        if (!result.from || e.businessDate < result.from) result.from = e.businessDate;
    const billed = entries.reduce((s, e) => sum(s, e.billedSalesMinor), 0),
      returned = entries.reduce((s, e) => sum(s, e.refundsMinor), 0);
    result.billedSalesMinor = sum(result.billedSalesMinor, billed);
    result.refundsMinor = sum(result.refundsMinor, returned);
    const sold = entries.some((e) => e.completedSales > 0);
    if (sold) result.bills++;
    if (branch.restaurantEnabled === true) {
      // Rooms/partner venues can also have a table_number label; never rank them as tables.
      const label =
        !sale.venue && ['string', 'number'].includes(typeof sale.table_number)
          ? String(sale.table_number).trim().slice(0, 100)
          : '';
      const tableId = label
        ? String(sale.table_id || `label:${label}`).slice(0, 254)
        : 'unrecorded';
      if (!tables.has(tableId))
        tables.set(tableId, {
          id: tableId,
          name: label || 'No recorded table',
          bills: 0,
          billedSalesMinor: 0,
          refundsMinor: 0,
          salesAfterReturnsMinor: 0,
        });
      const table = tables.get(tableId);
      if (sold) table.bills++;
      table.billedSalesMinor = sum(table.billedSalesMinor, billed);
      table.refundsMinor = sum(table.refundsMinor, returned);
      table.salesAfterReturnsMinor = sum(table.billedSalesMinor, -table.refundsMinor);
    }
    // Use recorded ownership, never the device approver or latest payment/handover actor.
    if (context.capabilities.includes('reporting.manage')) {
      const { id: key, name: author } = businessSalesOwner(sale);
      if (!staff.has(key))
        staff.set(key, {
          id: key,
          name: author,
          billedSalesMinor: 0,
          refundsMinor: 0,
          salesAfterReturnsMinor: 0,
        });
      const s = staff.get(key);
      s.billedSalesMinor = sum(s.billedSalesMinor, billed);
      s.refundsMinor = sum(s.refundsMinor, returned);
      s.salesAfterReturnsMinor = sum(s.billedSalesMinor, -s.refundsMinor);
    }
    if (sold) {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hourCycle: 'h23',
          timeZone: branch.timezone,
        }).format(new Date(sale.date))
      );
      result.hours[hour].billedSalesMinor = sum(result.hours[hour].billedSalesMinor, billed);
      result.hours[hour].bills++;
      try {
        const discount = sum(
          minorUnits(sale.discount ?? 0, branch.currencyDigits),
          minorUnits(sale.sale_extra_discount ?? 0, branch.currencyDigits)
        );
        result.discounts.amountMinor = sum(result.discounts.amountMinor, discount);
        if (discount) result.discounts.bills++;
      } catch {
        discountValid = false;
      }
      if (context.capabilities.includes('tenders.read')) {
        try {
          // Invoice-date tender snapshot. Legacy bills do not have a complete payment-event ledger.
          const pending = minorUnits(sale.payment_pending ?? 0, branch.currencyDigits);
          unpaid = sum(unpaid, pending);
          if (pending > billed) throw Error();
          const paid =
            sale.paid_amount == null
              ? billed - pending
              : minorUnits(sale.paid_amount, branch.currencyDigits);
          if (sale.payment_status === 'Unpaid') {
            if (paid !== 0) throw Error();
          } else {
            let split = sale.multi_payment;
            if (typeof split === 'string') split = JSON.parse(split);
            const parts =
              split && !Array.isArray(split) && Object.keys(split).length
                ? Object.entries(split)
                : [[sale.payment_mode, paid / 10 ** branch.currencyDigits]];
            let total = 0;
            const values = [];
            for (const [method, amount] of parts) {
              if (
                typeof method !== 'string' ||
                !method.trim() ||
                method.length > 80 ||
                /[,;+]|mixed|split/i.test(method)
              )
                throw Error();
              const value = minorUnits(amount, branch.currencyDigits);
              total = sum(total, value);
              const trimmed = method.trim();
              const canonical =
                { cash: 'Cash', card: 'Card', upi: 'UPI' }[trimmed.toLowerCase()] || trimmed;
              values.push([canonical, value]);
            }
            if (total !== paid || paid + pending !== billed) throw Error();
            received = sum(received, paid);
            for (const [method, value] of values)
              methods.set(method, sum(methods.get(method) || 0, value));
          }
        } catch {
          paymentValid = false;
        }
      }
    }
    for (const block of sale.items_return || [])
      if (within(businessDate(block.returnArray.returnDate, branch.timezone)))
        result.returns.transactions++;
    if (context.capabilities.includes('items.read') && itemValid)
      try {
        for (const e of itemSaleContribution(sale, config).entries) {
          if (!within(e.businessDate)) continue;
          if (!items.has(e.itemId))
            items.set(e.itemId, {
              itemId: e.itemId,
              name: e.name,
              billedSalesMinor: 0,
              refundsMinor: 0,
              salesAfterReturnsMinor: 0,
              quantities: [],
            });
          if (items.size > 10000) throw Error();
          const item = items.get(e.itemId);
          item.billedSalesMinor = sum(item.billedSalesMinor, e.billedSalesMinor);
          item.refundsMinor = sum(item.refundsMinor, e.refundsMinor);
          item.salesAfterReturnsMinor = sum(item.billedSalesMinor, -item.refundsMinor);
          for (const q of e.quantities) {
            let dest = item.quantities.find((x) => x.unit === q.unit);
            if (!dest) {
              dest = { unit: q.unit, soldMilli: 0, returnedMilli: 0 };
              item.quantities.push(dest);
            }
            dest.soldMilli = sum(dest.soldMilli, q.soldMilli);
            dest.returnedMilli = sum(dest.returnedMilli, q.returnedMilli);
          }
        }
      } catch {
        itemValid = false;
        items.clear();
      }
    if (result.details.length < 50)
      result.details.push({
        id: String(sale._id),
        number: String(sale.sales_id || sale._id),
        date: new Date(sale.date).toISOString(),
        billedSalesMinor: billed,
        refundsMinor: returned,
      });
  }
  result.salesAfterReturnsMinor = sum(result.billedSalesMinor, -result.refundsMinor);
  result.returns.amountMinor = result.refundsMinor;
  if (!discountValid) result.discounts = null;
  if (context.capabilities.includes('items.read') && itemValid) {
    const all = [...items.values()];
    if (
      all.reduce((s, i) => sum(s, i.billedSalesMinor), 0) !== result.billedSalesMinor ||
      all.reduce((s, i) => sum(s, i.refundsMinor), 0) !== result.refundsMinor
    )
      fail('summary_unavailable', 503);
    // Both rankings are derived before truncation. Quantity comparison is only meaningful within one unit.
    const units = [...new Set(all.flatMap((i) => i.quantities.map((q) => q.unit)))].sort();
    result.items = {
      bySales: all
        .sort(
          (a, b) =>
            b.salesAfterReturnsMinor - a.salesAfterReturnsMinor || a.itemId.localeCompare(b.itemId)
        )
        .slice(0, 20),
      byQuantity: units.slice(0, 16).map((unit) => ({
        unit,
        items: all
          .filter((i) => i.quantities.some((q) => q.unit === unit))
          .sort((a, b) => {
            const net = (i) => {
              const q = i.quantities.find((q) => q.unit === unit);
              return q.soldMilli - q.returnedMilli;
            };
            return net(b) - net(a) || a.itemId.localeCompare(b.itemId);
          })
          .slice(0, 20),
      })),
    };
  }
  if (context.capabilities.includes('reporting.manage'))
    result.staff = [...staff.values()]
      .sort((a, b) => b.salesAfterReturnsMinor - a.salesAfterReturnsMinor)
      .slice(0, 20);
  if (branch.restaurantEnabled === true) {
    const rows = [...tables.values()].filter((t) => t.id !== 'unrecorded');
    const bySales = (a, b) =>
      b.salesAfterReturnsMinor - a.salesAfterReturnsMinor || a.id.localeCompare(b.id);
    result.restaurant = {
      basis: 'recorded-bill-table',
      bySales: [...rows].sort(bySales).slice(0, 20),
      byBills: [...rows].sort((a, b) => b.bills - a.bills || bySales(a, b)).slice(0, 20),
      tableCount: rows.length,
      withoutTable: tables.get('unrecorded') || null,
    };
  }
  if (context.capabilities.includes('tenders.read') && paymentValid)
    result.payments = {
      basis: 'invoice-date',
      receivedMinor: received,
      outstandingMinor: unpaid,
      methods: [...methods].map(([name, amountMinor]) => ({ name, amountMinor })),
    };
  if (Date.now() > deadline || Buffer.byteLength(JSON.stringify(result), 'utf8') > 240000)
    fail('summary_unavailable', 503);
  return result;
}
module.exports = { readBusinessInsights, summarizeInsights };
