'use strict';

/*
 * A SALE, TURNED INTO SOMETHING A PRINTER CAN ACTUALLY PRINT.
 *
 * This exists because of a bug that printed perfectly blank paper.
 *
 * The till renders bills with src/escpos-receipt.js, and that takes a VIEW
 * MODEL - `{ storeName, items: [{ name, qty, amount }], total, ... }` - not a
 * sale document. On the counter's own screen the view model is scraped out of
 * the shop's rendered receipt template by frontend/.../receipt-data.js, which
 * is fine there because a browser is holding the template.
 *
 * Nothing is holding a template when a waiter asks for a bill from the floor.
 * The queued job was handing the raw Mongo document straight to the renderer,
 * whose field names are all different - `item_name` against `name`,
 * `sales_total` against `total` - so every lookup missed, and what came out of
 * the printer was a header, an empty item table and a total of 0.00. It looked
 * like a printer fault and it was not.
 *
 * Built HERE, on the server, at the moment the job is queued, for two reasons:
 *
 *   1. The shop's name, address and GSTIN live in the shop's database. A till
 *      paired to a cloud tenant does not have that database, so anything the
 *      till would have to look up is something it cannot look up.
 *   2. The job then carries everything. No sync, no second round trip, and a
 *      till that is handed a job can print it with the network already gone.
 *
 * This is the BILL - what a guest is asked to pay. The fiscal receipt is a
 * different document, printed at the counter when the table actually settles,
 * and it still goes through the shop's own template.
 */

const { orderSource } = require('../utils/order-source');

/** A number, from a field that may be null, '' or the string 'null'. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** DD/MM/YYYY HH:mm, which is how a bill reads in the shops that use this. */
function stamp(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Quantity as it should read on paper.
 *
 * Whole numbers stay whole: "2", not "2.000". Anything sold by weight keeps
 * its decimals, because 0.3 of a kilo is the thing that was ordered and
 * rounding it to zero would be worse than ugly.
 */
function qtyText(value) {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/**
 * The lines of the bill.
 *
 * A returned line is skipped: it is not something the guest is being asked to
 * pay for, and printing it under "ITEM" with a positive amount would overstate
 * the bill. Anything with no name is skipped too - it cannot be read on paper
 * and its amount is already inside the total.
 */
function itemLines(sale) {
  const rows = Array.isArray(sale && sale.items) ? sale.items : [];
  return rows
    .filter((it) => it && !it.return && String(it.name || it.item_name || '').trim())
    .map((it) => {
      const qty = num(it.quantity != null ? it.quantity : it.qty);
      const amount =
        it.total != null && it.total !== ''
          ? num(it.total)
          : num(it.unit_price != null ? it.unit_price : it.item_price) * qty;
      return {
        name: String(it.name || it.item_name).trim(),
        qty: qtyText(qty),
        amount,
      };
    });
}

/*
 * The one rate this sale was charged at, or null if there is not exactly one.
 *
 * Worked out per line - tax divided by what the tax was charged on - rather
 * than from the totals, because the totals of a mixed-rate bill divide into a
 * number that is nobody's rate. Five percent and eighteen percent together
 * average to something that was never charged on anything, and printing it
 * would be a tax document stating a rate that did not happen.
 *
 * Rounded to two decimals before comparing, so the ordinary rounding inside
 * each line does not read as two different rates.
 */
function gstRate(sale) {
  const lines = Array.isArray(sale && sale.items) ? sale.items : [];
  const rates = new Set();
  for (const line of lines) {
    if (!line || line.return) continue;
    const taxOn = num(line.item_tax != null ? line.item_tax : line.tax_amount);
    if (taxOn <= 0) continue;
    const qty = num(line.item_quantity != null ? line.item_quantity : line.quantity) || 1;
    const base = num(line.item_base_price != null ? line.item_base_price : line.unit_price) * qty;
    if (base <= 0) return null;
    rates.add(Math.round((taxOn / base) * 10000) / 100);
    if (rates.size > 1) return null;
  }
  if (rates.size !== 1) return null;
  const only = [...rates][0];
  /* A rate outside what a GST regime actually charges means the arithmetic
     found something that is not a rate. Say nothing rather than invent one. */
  return only > 0 && only <= 50 ? only : null;
}

/* 2.5 rather than 2.50, and 12 rather than 12.00 - the way a rate is written. */
function trimRate(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * The tax rows.
 *
 * An Indian shop's paper shows CGST and SGST as two halves, which is what an
 * intra-state bill is, and that is very nearly every table in a restaurant -
 * the guest is sitting in the same state as the kitchen. An inter-state sale
 * is not something that happens at a table, and it settles at the counter
 * where the shop's own template runs and knows better than this does.
 */
function taxRows(sale, branch) {
  const tax = num(sale && sale.tax);
  if (tax <= 0) return [];
  const indian = String((branch && branch.indian_gst) || '').toLowerCase();
  if (indian && indian !== 'disable' && indian !== 'false' && indian !== '0') {
    const half = tax / 2;
    const rate = gstRate(sale);
    /*
     * THE RATE, BESIDE THE AMOUNT.
     *
     * Owner, holding one of ours next to the bill the shop printed before:
     * "bill i can see CGST and CSGT. but dont see percentage." The old paper
     * read `CGST :2.50 % 36.00`, and a GST bill is expected to say the rate it
     * was charged at - it is the number a customer checks and an accountant
     * asks for.
     *
     * It is DERIVED, not stored. A sale line records the tax as an amount and
     * never recorded the rate, so storing one now would put the percentage on
     * new bills and leave every reprint of an older sale without it. Dividing
     * the tax by what it was charged on gives the same answer for a sale
     * printed today and one reprinted from last year.
     *
     * Half each, because CGST and SGST split the rate as well as the money: a
     * 5% dish is 2.5 and 2.5, which is exactly what the shop's old bill said.
     *
     * Absent when it cannot be worked out - a mixed-rate bill, or one whose
     * numbers do not divide cleanly. A wrong rate on a tax document is worse
     * than no rate, and the amount is still right either way.
     */
    const shown = rate === null ? '' : ' ' + trimRate(rate / 2) + '%';
    return [
      { label: 'CGST' + shown, amount: half },
      { label: 'SGST' + shown, amount: half },
    ];
  }
  return [{ label: 'Tax', amount: tax }];
}

/**
 * Who this is for, when it is for somebody.
 *
 * A walk-in has no name, and a blank "Customer:" line reads as a receipt that
 * failed rather than as a guest nobody asked the name of.
 */
/*
 * Is this a telephone number, or a box somebody had to fill in?
 *
 * A bill came back with `+910000000000` printed under the customer line, for a
 * walk-in who had never given a number. Owner: "+9100000 comes from where? if
 * cstomer is walking customer we show like this? not make sense."
 *
 * He is right, and the fix belongs here rather than only at the sender. A
 * placeholder can arrive from any device that needs the field populated, and a
 * bill is a document somebody keeps: printing a number nobody can ring is worse
 * than printing nothing, because it looks like information.
 *
 * Judged the way E.164 judges one. A subscriber number is between 7 and 15
 * digits, so anything outside that cannot be dialled. And a long run of one
 * repeated digit is how every placeholder in the world is written - 0000000000,
 * 9999999999 - while a real number does not do it: eight in a row is already
 * far beyond any real dialling plan's appetite for repetition.
 *
 * Deliberately NOT a country-by-country validation. This has to be right for a
 * shop in Puducherry and a shop anywhere else, and refusing a real customer's
 * number because it did not match a pattern we guessed at would be the worse
 * mistake - the test is "could this be dialled", not "is this Indian".
 */
function isDialable(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  if (/(\d)\1{7,}/.test(digits)) return false;
  return true;
}

function customerLines(sale) {
  const out = [];
  const name = String((sale && sale.customer_name) || '').trim();
  const phone = String((sale && sale.customer_phone) || '').trim();
  if (name && !/^walk[\s-]?in$/i.test(name)) out.push(name);
  if (phone && isDialable(phone)) out.push(phone);
  return out;
}

/**
 * The rows that are neither totals nor items: which table this is, how many
 * people are at it, who took the order.
 *
 * This is the part a waiter reads to know whose bill they are carrying, so it
 * matters more here than it would on a counter receipt handed straight over.
 */
function extraRows(sale) {
  const out = [];
  const table = String((sale && sale.table_number) || '').trim();
  const dine = String((sale && sale.dine_type) || '').trim();
  const covers = sale && sale.person_count;
  if (table) out.push({ label: 'Table', value: table });
  if (dine) out.push({ label: 'Order type', value: dine });
  if (covers != null && String(covers).trim() && num(covers) > 0) {
    out.push({ label: 'Covers', value: String(covers).trim() });
  }
  const waiter = String((sale && (sale.created_by || sale.user_name)) || '').trim();
  if (waiter) out.push({ label: 'Taken by', value: waiter });
  return out;
}

/**
 * Everything src/escpos-receipt.js needs, and nothing it does not.
 *
 * @param {object} sale   one sale document, lean
 * @param {object} branch the shop, for the header. Optional: a bill with no
 *                        letterhead is still a bill, and refusing to print one
 *                        because a branch row could not be read would lose the
 *                        guest their bill over a cosmetic failure.
 */
function buildBillPayload(sale = {}, branch = {}) {
  const items = itemLines(sale);
  const subTotal =
    sale.sales_sub_total != null && sale.sales_sub_total !== ''
      ? num(sale.sales_sub_total)
      : items.reduce((sum, it) => sum + num(it.amount), 0);

  const phones = [branch.store_telephone, branch.store_alternativephone]
    .map((p) => String(p || '').trim())
    .filter(Boolean);

  return {
    storeName: String(branch.branch_name || sale.branch_name || '').trim(),
    storeAddress: String(branch.store_address || '').trim(),
    storePhone: phones.join(' / '),
    storeEmail: String(branch.store_email || '').trim(),
    gstin: String(branch.branch_gstin_number || '').trim(),

    /* Not "RECEIPT" and not "TAX INVOICE". Nobody has paid yet, and calling it
       either would be a document this shop has not issued. */
    title: 'BILL',
    billNo: String(sale.sales_id || '').trim(),
    date: stamp(sale.date || sale.created_at),
    customer: customerLines(sale),

    /*
     * Where the order came from, in the same words the kitchen ticket uses.
     *
     * The table lives in utils/order-source.js, copied from src/order-source.js
     * because the API ships outside the asar archive and cannot require it. A
     * test compares the two, so they cannot drift into printing different words
     * for the same order.
     *
     * Off only if the shop says so, and absent means on: a restaurant that took
     * the trouble to sell through an aggregator wants to see which one on the
     * bill it files.
     */
    source:
      branch.bill_print_source === false || branch.bill_print_source === 'false'
        ? ''
        : orderSource(sale),

    items,

    subTotal,
    taxes: taxRows(sale, branch),
    discount: num(sale.discount),
    roundOff: num(sale.round_off || sale.sales_round_off),
    total: num(sale.sales_total != null ? sale.sales_total : sale.total),

    /* No payments row: the whole point of this document is that it has not
       been paid. The counter prints the settled receipt afterwards. */
    extras: extraRows(sale),
    itemCount: items.length,
  };
}

module.exports = { buildBillPayload };
