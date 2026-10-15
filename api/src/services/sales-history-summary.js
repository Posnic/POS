'use strict';
const Money = require('../utils/currency');
const payments = require('../helpers/sale-payment-summary');

// Stream only summary fields: pagination must never limit the totals, and a
// large All time selection must not materialize whole sale/item documents.
async function historySummary(Model, filter) {
  const cursor = Model.find(filter)
    .select(
      'sale_process status payment_status sales_total total items_total paid_amount partial_check partial_balance multi_payment captain_payments payment_mode currency currencyCode currency_code currencyDigits currency_digits currencySymbol currency_symbol'
    )
    .lean()
    .maxTimeMS(15000)
    .cursor({ batchSize: 500 });
  const groups = new Map();
  let count = 0,
    cancelled = 0;
  try {
    for await (const sale of cursor) {
      if (
        [sale.sale_process, sale.status, sale.payment_status].some((v) =>
          /^(cancel|cancelled|canceled)$/i.test(String(v || '').trim())
        )
      ) {
        cancelled++;
        continue;
      }
      count++;
      const policy = Money.snapshot(sale);
      const key = JSON.stringify([
        policy.currencyCode || policy.currencySymbol,
        policy.currencyDigits,
      ]);
      if (!groups.has(key)) groups.set(key, { ...policy, totalMinor: 0, methods: new Map() });
      const group = groups.get(key);
      const total = sale.sales_total ?? sale.total ?? sale.items_total ?? 0;
      group.totalMinor += Money.toMinor(total, policy);
      if (!Number.isSafeInteger(group.totalMinor))
        throw new Error('Sales summary exceeds supported amount');
      // The same tender precedence used by receipt details prevents counting
      // Captain journals and their projected multi_payment amounts twice.
      for (const row of payments.rows({ ...sale, items_total: total })) {
        const method = row.method.toLowerCase();
        const entry = group.methods.get(method) || { method: row.method, minor: 0 };
        entry.minor += Money.toMinor(row.amount, policy);
        if (!Number.isSafeInteger(entry.minor))
          throw new Error('Payment summary exceeds supported amount');
        group.methods.set(method, entry);
      }
    }
  } finally {
    await cursor.close();
  }
  return {
    count,
    cancelled,
    currencies: [...groups.values()].map((g) => ({
      currencyCode: g.currencyCode,
      currencySymbol: g.currencySymbol,
      currencyDigits: g.currencyDigits,
      total: Money.fromMinor(g.totalMinor, g),
      payments: [...g.methods.values()]
        .sort((a, b) => a.method.localeCompare(b.method))
        .map((p) => ({ method: p.method, amount: Money.fromMinor(p.minor, g) })),
    })),
  };
}
module.exports = historySummary;
