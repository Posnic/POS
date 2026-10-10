/* One presentation of recorded tender amounts for sale details and receipts. */
/* global window */
(function (root) {
  'use strict';
  function rows(sale) {
    function parse(value) {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch (_) {
        return null;
      }
    }
    function collect(value) {
      const result = new Map();
      function add(method, amount) {
        method = String(method || '').trim();
        amount = Number(amount);
        if (!method || !Number.isFinite(amount) || amount <= 0) return;
        const key = method.toLowerCase();
        const label = { cash: 'Cash', card: 'Card', upi: 'UPI' }[key] || method;
        const entry = result.get(key) || { method: label, amount: 0 };
        entry.amount += amount;
        result.set(key, entry);
      }
      function visit(value) {
        value = parse(value);
        if (Array.isArray(value))
          value.forEach(function (entry) {
            if (!entry || typeof entry !== 'object') return;
            if (Array.isArray(entry.tenders) && entry.tenders.length) visit(entry.tenders);
            else add(entry.method || entry.payment_mode || entry.label, entry.amount);
          });
        else if (value && typeof value === 'object')
          Object.keys(value).forEach(function (method) {
            const entry = value[method];
            add(method, entry && typeof entry === 'object' ? entry.amount : entry);
          });
      }
      visit(value);
      return Array.from(result.values());
    }
    let result = collect(sale.multi_payment);
    if (!result.length) result = collect(sale.captain_payments);
    if (result.length) return result;
    const method = String(sale.payment_mode || '').trim();
    // A legacy mixed label does not contain enough information to invent a split.
    if (!method || /[,;+]|\bmixed\b|\bsplit\b/i.test(method)) return [];
    let amount = sale.paid_amount;
    if (amount == null && (sale.partial_check === true || sale.partial_check === 'true'))
      amount = sale.partial_balance;
    if (amount == null && /^paid$/i.test(String(sale.payment_status || '')))
      amount = sale.items_total == null ? sale.sales_total : sale.items_total;
    return collect([{ method: method, amount: amount }]);
  }
  const api = { rows: rows };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PosnicSalePayments = api;
})(typeof window !== 'undefined' ? window : globalThis);
