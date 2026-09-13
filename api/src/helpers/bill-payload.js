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
    return [
      { label: 'CGST', amount: half },
      { label: 'SGST', amount: half },
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
function customerLines(sale) {
  const out = [];
  const name = String((sale && sale.customer_name) || '').trim();
  const phone = String((sale && sale.customer_phone) || '').trim();
  if (name && !/^walk[\s-]?in$/i.test(name)) out.push(name);
  if (phone) out.push(phone);
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
