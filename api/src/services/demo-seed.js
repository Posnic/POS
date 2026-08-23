'use strict';

/*
 * Sample sales and quotes, so a demo shop looks like a shop.
 *
 * Owner ask: "Demo data filled. few sample sales, sample quote, all sample
 * include with demo data module."
 *
 * A catalogue on its own demonstrates nothing. Every report opens empty, the
 * dashboard shows zero, the quote list says there is nothing here - so the
 * parts of the product somebody is deciding about are exactly the parts they
 * cannot see. A handful of sales fixes that.
 *
 * THE OBJECTION, AND WHY IT IS ANSWERED RATHER THAN IGNORED
 *
 * Fake money in a real shop's reports is a genuine cost: for the first week
 * every figure the owner reads is wrong, and they have no way to know which
 * part is theirs. That is why:
 *
 *   - every row is tagged `demo_pack`, so it can be found and removed exactly,
 *   - the sales are DATED IN THE PAST, over the fortnight before the shop was
 *     created, so today's takings - the number anybody actually watches - are
 *     the shop's own from the first sale they ring up,
 *   - the amounts are small and ordinary, not round showroom numbers,
 *   - and removing demo data removes these too.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not invent stock movements or touch item quantities. A demo sale
 * that decremented stock would leave a shop whose counts are wrong before they
 * have sold anything, and stock is the one number a shopkeeper checks against
 * the shelf.
 */

const { ObjectId } = require('mongodb');

/* Enough to fill a report, few enough to scan and recognise as samples. */
const SALE_COUNT = 12;
const QUOTE_COUNT = 3;

/* Deterministic, so a re-seed produces the same shop rather than a different
   one each time - and so a test can assert amounts. Seeded from the branch id
   so two shops do not look identical. */
function rng(seedText) {
  let h = 2166136261;
  const s = String(seedText || 'demo');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Build (but do not insert) the demo sales for a branch.
 *
 * Exported separately so the shape can be tested without a database.
 */
function buildSales({ items, customers, customer, branch, pack, now, count = SALE_COUNT }) {
  if (!Array.isArray(items) || !items.length) return [];
  const rand = rng(String(branch.branch_id || 'demo'));
  const sales = [];

  for (let i = 0; i < count; i++) {
    /* Spread across the previous fortnight, oldest first, and never today.
       Today's takings must be the shop's own. */
    const daysAgo = 14 - Math.floor((i / count) * 13);
    const when = new Date(now.getTime() - daysAgo * 864e5);
    /* Shop hours, so the hourly report is not a flat line at midnight. */
    when.setHours(9 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);

    const lineCount = 1 + Math.floor(rand() * 3);
    const lines = [];
    let subtotal = 0;

    for (let j = 0; j < lineCount; j++) {
      const item = items[Math.floor(rand() * items.length)];
      const price = Number(item.selling_price) || 0;
      if (price <= 0) continue;
      const qty = 1 + Math.floor(rand() * 3);
      const lineTotal = round2(price * qty);
      subtotal += lineTotal;
      lines.push({
        item_id: String(item._id),
        item_name: item.name,
        name: item.name,
        quantity: qty,
        unit_price: price,
        price,
        subtotal: lineTotal,
        total: lineTotal,
        unit: item.unit || 'qty',
        tax_rate: 0,
        tax_amount: 0,
      });
    }
    if (!lines.length) continue;

    subtotal = round2(subtotal);
    /* Spread across the sample customers when there are any, so the customer
       list and its purchase history mean something. Falls back to whatever
       single customer was passed, and then to the walk-in. */
    const pool =
      Array.isArray(customers) && customers.length ? customers : customer ? [customer] : [];
    const buyer = pool.length ? pool[i % pool.length] : null;
    sales.push({
      demo_pack: pack,
      demo_seeded_at: now,
      branch_id: branch.branch_id,
      branch_name: branch.branch_name,
      license: branch.license,
      customer_id: buyer ? buyer._id : null,
      customer_name: buyer ? buyer.name : 'Walk-in Customer',
      items: lines,
      number_of_items: lines.length,
      sales_total: subtotal,
      total_amount: subtotal,
      paid_amount: subtotal,
      /* Cash and card in a believable mix, so the payment-mode report has
         something to show. */
      payment_mode: rand() > 0.35 ? 'cash' : 'card',
      payment_status: 'paid',
      sales_status: 'completed',
      created_date: when,
      date: when,
      updated_date: when,
      created_by: 'Demo data',
    });
  }
  return sales;
}

/**
 * Build (but do not insert) the demo quotes for a branch.
 */
function buildQuotes({ items, branch, pack, now, count = QUOTE_COUNT }) {
  if (!Array.isArray(items) || !items.length) return [];
  const rand = rng(String(branch.branch_id || 'demo') + 'q');
  const names = ['Anand Traders', 'Meera Enterprises', 'Sunrise Stores'];
  const quotes = [];

  for (let i = 0; i < count; i++) {
    const lineCount = 2 + Math.floor(rand() * 3);
    const lines = [];
    let subtotal = 0;

    for (let j = 0; j < lineCount; j++) {
      const item = items[Math.floor(rand() * items.length)];
      const price = Number(item.selling_price) || 0;
      if (price <= 0) continue;
      const qty = 2 + Math.floor(rand() * 8);
      const total = round2(price * qty);
      subtotal += total;
      lines.push({
        item_id: String(item._id),
        name: item.name,
        quantity: qty,
        unit_price: price,
        tax_rate: 0,
        tax_amount: 0,
        total,
      });
    }
    if (!lines.length) continue;

    subtotal = round2(subtotal);
    const when = new Date(now.getTime() - (7 - i * 2) * 864e5);
    quotes.push({
      demo_pack: pack,
      demo_seeded_at: now,
      branch_id: branch.branch_id,
      branch_name: branch.branch_name,
      license: branch.license,
      /* Prefixed so a demo quote can never take a number a real one wants. */
      quote_id: `QUO-DEMO-${i + 1}`,
      customer_id: null,
      customer_name: names[i % names.length],
      customer_phone: '',
      items: lines,
      charges: [],
      charges_total: 0,
      discount: 0,
      subtotal,
      tax_total: 0,
      total: subtotal,
      /* One of each, so the list demonstrates its own statuses. */
      status: i === 0 ? 'accepted' : i === 1 ? 'sent' : 'draft',
      notes: 'Sample quotation - part of the demo data.',
      created_date: when,
      date: when,
      updated_date: when,
      created_by: 'Demo data',
    });
  }
  return quotes;
}

/*
 * Sample customers and suppliers.
 *
 * Owner report: "supplier list or customer list not filled."
 *
 * A new shop was given exactly one of each - Walk-in Customer and General
 * Supplier - because the demo packs carry products and nothing else. So two of
 * the six things in the main menu opened looking broken, and the sample sales
 * all belonged to the same walk-in, which is not what a customer list is for.
 *
 * Kept small. Eight customers and five suppliers are enough to show what the
 * screens do - search, balances, a purchase history - without burying the
 * shop's own first real entry among strangers.
 *
 * No balances owed. A demo customer carrying an outstanding amount would put
 * money into the credit report that nobody owes, and that number is read as
 * fact. They exist to be sold to, not to be chased.
 */
const DEMO_CUSTOMERS = [
  { name: 'Anand Kumar', phone: '9840012345', city: 'Chennai' },
  { name: 'Meera Raghavan', phone: '9840023456', city: 'Chennai' },
  { name: 'Suresh Babu', phone: '9840034567', city: 'Madurai' },
  { name: 'Lakshmi Narayanan', phone: '9840045678', city: 'Coimbatore' },
  { name: 'Fatima Sheikh', phone: '9840056789', city: 'Hyderabad' },
  { name: 'Joseph Mathew', phone: '9840067890', city: 'Kochi' },
  { name: 'Priya Desai', phone: '9840078901', city: 'Pune' },
  { name: 'Ravi Shankar', phone: '9840089012', city: 'Bengaluru' },
];

const DEMO_SUPPLIERS = [
  { name: 'Sunrise Wholesale', phone: '9445011223', city: 'Chennai' },
  { name: 'Balaji Distributors', phone: '9445022334', city: 'Madurai' },
  { name: 'Green Valley Foods', phone: '9445033445', city: 'Coimbatore' },
  { name: 'Metro Supply Co', phone: '9445044556', city: 'Bengaluru' },
  { name: 'Anitha Traders', phone: '9445055667', city: 'Salem' },
];

function buildPeople({ branch, pack, now, base }) {
  const common = (row) => ({
    demo_pack: pack,
    demo_seeded_at: now,
    branch_id: branch.branch_id,
    branch_name: branch.branch_name,
    license: branch.license,
    name: row.name,
    email: '',
    phone: row.phone,
    address: '',
    city: row.city,
    sortname: base.sortname || '',
    country: base.country || '',
    country_id: base.country_id || '',
    state: base.state || '',
    gst: 'disable',
    gst_number: '',
    gst_type: 'consumer',
    date: now,
    partial_balance: false,
    /* Nobody owes anything. An invented balance lands in the credit report as
       money the shop is waiting for. */
    balance: 0.0,
    created_date: now,
    updated_date: now,
    created_by: 'Demo data',
    updated_by: 'Demo data',
  });

  return {
    customers: DEMO_CUSTOMERS.map(common),
    suppliers: DEMO_SUPPLIERS.map(common),
  };
}

module.exports = {
  SALE_COUNT,
  QUOTE_COUNT,
  buildSales,
  buildQuotes,
  buildPeople,
  DEMO_CUSTOMERS,
  DEMO_SUPPLIERS,
  _rng: rng,
};
