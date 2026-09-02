'use strict';

/*
 * The money arithmetic of a customer document - quote or invoice.
 *
 * Lifted out of quote.repository when invoices arrived (INVOICING_MODULE_DESIGN).
 * A quote becomes an invoice becomes a sale, and the one thing a customer will
 * check is that the numbers agree from one document to the next. Two copies
 * of this math would drift - a rounding rule fixed on quotes and forgotten on
 * invoices is a customer holding two documents that disagree by a rupee - so
 * there is one copy and both repositories call it.
 *
 * Nothing here touches a database. Every function takes plain data and hands
 * back plain data; the repositories decide what to store.
 */

const { ObjectId } = require('mongodb');

const round2 = (n) => Math.round(n * 100) / 100;

/* One optional discount, per line or document-level: percent of the gross
   (0-100) or a flat amount capped at the gross. Anything malformed means
   "no discount", never a rejected save. */
function discountOf(raw, gross) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'percent' ? 'percent' : raw.type === 'amount' ? 'amount' : null;
  const value = Number(raw.value);
  if (!type || !Number.isFinite(value) || value <= 0) return null;
  const computed =
    type === 'percent'
      ? round2((gross * Math.min(value, 100)) / 100)
      : round2(Math.min(value, gross));
  return { type, value: round2(value), computed };
}

/*
 * Lines, generalized (QUOTATION_MODULE_DESIGN Q1): a row is either a catalog
 * item snapshot (kind 'item') or free text (kind 'custom'). Edits live on the
 * DOCUMENT - the catalog is never touched. A row with a name but no valid
 * item id heals into a custom row rather than vanishing.
 *
 * `noun` only shapes the error text ("per quote" / "per invoice").
 */
function normalizeLines(rows, noun = 'document') {
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'Add at least one line' };
  if (rows.length > 500) return { error: `At most 500 lines per ${noun}` };
  const lines = [];
  for (const row of rows) {
    if (!row) continue;
    const hasItem = ObjectId.isValid(String(row.item_id));
    const name = String(row.item_name || row.name || '').trim();
    if (!hasItem && !name) continue;
    const qty = Number(row.qty);
    const price = Number(row.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unitPrice = Number.isFinite(price) && price >= 0 ? price : 0;
    const gross = round2(qty * unitPrice);
    const discount = discountOf(row.discount, gross);
    /*
     * Per-line tax (owner: "each line item will have different tax - indian
     * GST like that"), seeded from the item's own configured tax. Inclusive
     * stays inside the price; exclusive adds on top - the same convention the
     * sale runs, so a converted document's tax matches by construction.
     */
    const taxRateRaw = Number(row.tax_value !== undefined ? row.tax_value : row.tax);
    const taxRate = Number.isFinite(taxRateRaw) && taxRateRaw > 0 ? Math.min(taxRateRaw, 100) : 0;
    const taxTypeRaw = String(row.tax_type || '').toLowerCase();
    const taxType = taxRate > 0 ? (taxTypeRaw.indexOf('ex') === 0 ? 'exclusive' : 'inclusive') : '';
    const taxable = round2(gross - (discount ? discount.computed : 0));
    const taxAmount =
      taxRate > 0
        ? taxType === 'exclusive'
          ? round2((taxable * taxRate) / 100)
          : round2(taxable - taxable / (1 + taxRate / 100))
        : 0;
    lines.push({
      kind: hasItem && row.kind !== 'custom' ? 'item' : 'custom',
      item_id: hasItem && row.kind !== 'custom' ? new ObjectId(String(row.item_id)) : null,
      item_name: name.slice(0, 200),
      description: String(row.description || '')
        .trim()
        .slice(0, 500),
      barcode_id: String(row.barcode_id || '').trim(),
      qty,
      unit_price: unitPrice,
      discount,
      tax_name: String(row.tax_name || '')
        .trim()
        .slice(0, 40),
      tax_value: taxRate,
      tax_type: taxType,
      tax_amount: taxAmount,
      line_total: taxType === 'exclusive' ? round2(taxable + taxAmount) : taxable,
    });
  }
  if (!lines.length)
    return { error: 'No valid lines - each needs an item or a name, and a quantity' };
  return { lines };
}

/* Named charge/adjustment rows - "tax in any name" (CGST 9%, Freight,
   Installation), percent-of-base or flat, sign -1 for named deductions.
   `computed` is filled by computeTotals. */
function normalizeCharges(rows) {
  if (!Array.isArray(rows)) return [];
  const charges = [];
  for (const row of rows.slice(0, 20)) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name || '')
      .trim()
      .slice(0, 60);
    const type = row.type === 'percent' ? 'percent' : row.type === 'amount' ? 'amount' : null;
    const value = Number(row.value);
    if (!name || !type || !Number.isFinite(value) || value < 0) continue;
    charges.push({
      name,
      type,
      value: round2(value),
      sign: Number(row.sign) === -1 ? -1 : 1,
      computed: 0,
    });
  }
  return charges;
}

function normalizeBlocks(rows) {
  if (!Array.isArray(rows)) return [];
  const blocks = [];
  for (const row of rows.slice(0, 10)) {
    if (!row || typeof row !== 'object') continue;
    const title = String(row.title || '')
      .trim()
      .slice(0, 80);
    const text = String(row.text || '')
      .trim()
      .slice(0, 2000);
    if (!title && !text) continue;
    blocks.push({ title, text });
  }
  return blocks;
}

const LAYOUT_TOKENS = ['billto', 'items', 'charges', 'payment', 'bank', 'terms', 'notes', 'custom'];

function normalizeLayout(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const v of value) {
    const t = String(v || '').trim();
    if (LAYOUT_TOKENS.includes(t) && !out.includes(t)) out.push(t);
  }
  return out.length ? out : null;
}

function dateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/*
 * The totals block, from normalized lines and charges.
 *
 * Money authority (QUOTATION_MODULE_DESIGN rule 4): the moment any of the
 * document-level money fields is used (charges, a document discount, line
 * discounts), the server's arithmetic is the stored truth and the client's
 * total is advisory. The legacy sale-screen path - plain lines plus the cart's
 * own grand total - keeps its behavior, which is why `clientTotal` and
 * `clientTaxTotal` are still consulted at all.
 *
 * Mutates `charges[i].computed` in place, which is what the callers store.
 */
function computeTotals({ lines, charges, discount, clientTotal, clientTaxTotal }) {
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const docDiscount = discountOf(discount, subtotal);
  const chargeBase = round2(subtotal - (docDiscount ? docDiscount.computed : 0));
  let chargesTotal = 0;
  for (const c of charges) {
    c.computed = c.type === 'percent' ? round2((chargeBase * c.value) / 100) : c.value;
    chargesTotal += c.sign * c.computed;
  }
  chargesTotal = round2(chargesTotal);
  const computedTotal = Math.max(0, round2(chargeBase + chargesTotal));
  const hasNewMoney = charges.length > 0 || docDiscount !== null || lines.some((l) => l.discount);
  /* Lines carrying their own tax make the tax total OURS to compute; the
     legacy path (sale-screen carts) keeps sending its own figure. */
  const linesCarryTax = lines.some((l) => l.tax_value > 0);
  const computedTaxTotal = round2(lines.reduce((s, l) => s + (l.tax_amount || 0), 0));
  const taxTotal = Number(clientTaxTotal);
  const total = Number(clientTotal);
  return {
    subtotal,
    discount: docDiscount,
    charges,
    charges_total: chargesTotal,
    tax_total: linesCarryTax
      ? computedTaxTotal
      : Number.isFinite(taxTotal) && taxTotal >= 0
        ? taxTotal
        : 0,
    total: hasNewMoney ? computedTotal : Number.isFinite(total) && total > 0 ? total : subtotal,
  };
}

module.exports = {
  round2,
  discountOf,
  normalizeLines,
  normalizeCharges,
  normalizeBlocks,
  normalizeLayout,
  dateOrNull,
  computeTotals,
  LAYOUT_TOKENS,
};
