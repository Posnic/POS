'use strict';
/*
 * The arithmetic a sale must satisfy, expressed once.
 *
 * A till that is wrong by a paisa on every line is wrong by real money by the
 * end of a year, and nobody notices until an accountant does. These are the
 * relationships a correctly recorded sale always holds, written as functions so
 * that the same rules can be run two ways: over invented sales in the test
 * suite before a change ships, and over a shop's actual sales afterwards.
 *
 * That second use is the point. A test proves the code was right about the
 * cases somebody thought of; running the same rules over real data proves the
 * money in the database is right about the cases nobody did.
 *
 * Every rule states what it means in shop terms, because "sales_sub_total" is
 * not self-explanatory at two in the morning when a total is out by 40 paise.
 */

/* Money is compared to the paisa, with a hair of slack for float noise. */
const TOLERANCE = 0.011;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/*
 * One line of a sale.
 *
 * quantity x price, less its percentage discount, less any flat discount, plus
 * tax only when the tax is charged on top. An inclusive tax is already inside
 * the price and adding it would charge the customer twice.
 */
function expectedLineTotal(line = {}) {
  const gross = num(line.item_quantity) * num(line.sale_inline_item_price);
  const percent = num(line.sale_inline_discount_pervalue) || num(line.item_discount_percentage);
  const flat = num(line.sale_inline_discount_value) || num(line.item_discount);
  const exclusiveTax =
    String(line.tax_type).toLowerCase() === 'exclusive' ? num(line.tax_amount) : 0;
  return gross * (1 - percent / 100) - flat + exclusiveTax;
}

/*
 * Everything that must be true of a stored sale.
 *
 * Returns a list of what is wrong, empty when the sale is sound. A list rather
 * than a boolean because "this sale is bad" is not actionable and "line 3 is 40
 * paise light" is.
 */
function checkSale(sale = {}) {
  const problems = [];
  const items = Array.isArray(sale.items) ? sale.items : [];
  const id = sale.sales_id || String(sale._id || '(unsaved)');

  // 1. Each line is its own arithmetic.
  items.forEach((line, index) => {
    const expected = expectedLineTotal(line);
    const stored = num(line.total_amount);
    if (Math.abs(expected - stored) > TOLERANCE) {
      problems.push({
        sale: id,
        rule: 'line-total',
        detail:
          `line ${index + 1} (${line.item_sku || line.item_id || '?'}): ` +
          `expected ${expected.toFixed(4)}, stored ${stored}`,
        difference: stored - expected,
      });
    }
  });

  const sumLines = items.reduce((a, i) => a + num(i.total_amount), 0);
  const gross = items.reduce((a, i) => a + num(i.item_quantity) * num(i.sale_inline_item_price), 0);

  // 2. The lines, plus whatever rounding the shop applied, are the item total.
  const withRounding = sumLines + num(sale.round_off);
  if (Math.abs(withRounding - num(sale.items_total)) > TOLERANCE) {
    problems.push({
      sale: id,
      rule: 'lines-vs-items-total',
      detail:
        `lines ${sumLines.toFixed(4)} + rounding ${num(sale.round_off)} ` +
        `= ${withRounding.toFixed(4)}, stored items_total ${sale.items_total}`,
      difference: num(sale.items_total) - withRounding,
    });
  }

  // 3. The subtotal is the gross, before any discount.
  if (num(sale.sales_sub_total) > 0 && Math.abs(gross - num(sale.sales_sub_total)) > TOLERANCE) {
    problems.push({
      sale: id,
      rule: 'gross-vs-subtotal',
      detail: `gross ${gross.toFixed(4)}, stored sales_sub_total ${sale.sales_sub_total}`,
      difference: num(sale.sales_sub_total) - gross,
    });
  }

  // 4. What the customer owes is what the items came to.
  if (Math.abs(num(sale.items_total) - num(sale.sales_total)) > TOLERANCE) {
    problems.push({
      sale: id,
      rule: 'items-vs-sales-total',
      detail: `items_total ${sale.items_total}, sales_total ${sale.sales_total}`,
      difference: num(sale.sales_total) - num(sale.items_total),
    });
  }

  // 5. Split payments add up to the sale.
  if (Array.isArray(sale.multi_payment) && sale.multi_payment.length) {
    const paid = sale.multi_payment.reduce((a, p) => a + num(p.amount), 0);
    if (Math.abs(paid - num(sale.sales_total)) > TOLERANCE) {
      problems.push({
        sale: id,
        rule: 'payments-vs-total',
        detail: `payments ${paid.toFixed(2)}, sales_total ${sale.sales_total}`,
        difference: paid - num(sale.sales_total),
      });
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Purchases
 *
 * The same money arriving from the other direction. A purchase recorded for
 * more than was paid overstates stock value and understates profit, and it is
 * the number a supplier dispute is settled with.
 * ------------------------------------------------------------------ */

function expectedPurchaseLineTotal(line = {}) {
  const gross = num(line.item_quantity) * num(line.item_price);
  const percent = num(line.item_discount_percentage) || num(line.discount_percentage);
  const flat = num(line.item_discount) || num(line.discount);
  /*
   * The tax in rupees, not the tax rate.
   *
   * A purchase line stores  as the percentage - 5 means five per cent -
   * and the money in the GST components. Reading  as an amount turns a
   * 5% tax on 45 rupees into 5 rupees instead of 2.25, and reports a correct
   * purchase as broken. It cost this audit two false alarms before anybody
   * looked at the document.
   */
  const taxMoney =
    num(line.tax_amount) || num(line.igst_tax) + num(line.cgst_tax) + num(line.sgst_tax);
  const exclusiveTax = String(line.tax_type).toLowerCase() === 'exclusive' ? taxMoney : 0;
  return gross * (1 - percent / 100) - flat + exclusiveTax;
}

function checkPurchase(receiving = {}) {
  const problems = [];
  const items = Array.isArray(receiving.items) ? receiving.items : [];
  const id = receiving.receiving_id || String(receiving._id || '(unsaved)');

  items.forEach((line, index) => {
    const expected = expectedPurchaseLineTotal(line);
    const stored = num(line.total_amount);
    if (Math.abs(expected - stored) > TOLERANCE) {
      problems.push({
        doc: id,
        kind: 'purchase',
        rule: 'line-total',
        detail:
          `line ${index + 1} (${line.item_name || line.item_id || '?'}): ` +
          `expected ${expected.toFixed(4)}, stored ${stored}`,
        difference: stored - expected,
      });
    }
  });

  const sumLines = items.reduce((a, i) => a + num(i.total_amount), 0);
  if (Math.abs(sumLines - num(receiving.items_total)) > TOLERANCE) {
    problems.push({
      doc: id,
      kind: 'purchase',
      rule: 'lines-vs-items-total',
      detail: `lines ${sumLines.toFixed(4)}, stored items_total ${receiving.items_total}`,
      difference: num(receiving.items_total) - sumLines,
    });
  }

  /*
   * What is owed to the supplier: the goods, less anything sent back.
   *
   * Purchase returns sit on the same document rather than as their own record,
   * so a return that is not subtracted here is an invoice paid twice.
   */
  /*
   * A return-only document is not a purchase with a return on it.
   *
   * A FullReturn carries no items at all and its total is the value going back
   * to the supplier, so subtracting the return from an empty purchase produces
   * a negative expectation and three confident, wrong complaints.
   */
  const status = String(receiving.receiving_status || '').toLowerCase();
  const returnOnly =
    status.includes('fullreturn') || (!items.length && num(receiving.items_return_total) > 0);
  const expectedTotal = returnOnly
    ? num(receiving.items_return_total)
    : num(receiving.items_total) - num(receiving.items_return_total);
  if (Math.abs(expectedTotal - num(receiving.total_amount)) > TOLERANCE) {
    problems.push({
      doc: id,
      kind: 'purchase',
      rule: 'items-vs-total',
      detail:
        `items ${receiving.items_total} - returns ${receiving.items_return_total} ` +
        `= ${expectedTotal.toFixed(4)}, stored total_amount ${receiving.total_amount}`,
      difference: num(receiving.total_amount) - expectedTotal,
    });
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Returns
 *
 * Goods coming back, on a sale or on a purchase. The lines obey the same
 * arithmetic as the ones going out; what differs is that the total has to be
 * subtracted rather than added, and a return worth more than the sale it came
 * from is money leaving the till for goods that were never bought.
 * ------------------------------------------------------------------ */

function checkReturns(
  doc = {},
  {
    linesKey = 'items_return',
    totalKey = 'items_return_total',
    soldTotalKey = 'items_total',
    kind = 'sale',
  } = {}
) {
  const problems = [];
  /*
   * A purchase return nests its lines one level deeper.
   *
   * items_return holds wrappers - one per return event, each with a returnArray
   * whose returnValue is the actual lines. Read flat, every line looks like it
   * has no value at all and the return appears to have lost its entire total.
   */
  const raw = Array.isArray(doc[linesKey]) ? doc[linesKey] : [];
  const lines = raw.flatMap((entry) => {
    const nested = entry && entry.returnArray && entry.returnArray.returnValue;
    return Array.isArray(nested) ? nested : [entry];
  });
  if (!lines.length) return problems;

  const id = doc.sales_id || doc.receiving_id || String(doc._id || '(unsaved)');
  const lineTotal = kind === 'purchase' ? expectedPurchaseLineTotal : expectedLineTotal;

  lines.forEach((line, index) => {
    const expected = lineTotal(line);
    const stored = num(line.total_amount);
    if (Math.abs(expected - stored) > TOLERANCE) {
      problems.push({
        doc: id,
        kind: kind + '-return',
        rule: 'line-total',
        detail: `return line ${index + 1}: expected ${expected.toFixed(4)}, stored ${stored}`,
        difference: stored - expected,
      });
    }
  });

  const sum = lines.reduce((a, i) => a + num(i.total_amount), 0);
  if (Math.abs(sum - num(doc[totalKey])) > TOLERANCE) {
    problems.push({
      doc: id,
      kind: kind + '-return',
      rule: 'lines-vs-return-total',
      detail: `return lines ${sum.toFixed(4)}, stored ${totalKey} ${doc[totalKey]}`,
      difference: num(doc[totalKey]) - sum,
    });
  }

  // More came back than went out - meaningless on a return-only document,
  // which has nothing recorded as having gone out in the first place.
  const returnOnlyDoc =
    String(doc.receiving_status || '')
      .toLowerCase()
      .includes('fullreturn') ||
    (!(doc.items || []).length && num(doc[totalKey]) > 0);
  if (!returnOnlyDoc && num(doc[totalKey]) - num(doc[soldTotalKey]) > TOLERANCE) {
    problems.push({
      doc: id,
      kind: kind + '-return',
      rule: 'return-exceeds-original',
      detail: `returned ${doc[totalKey]} against ${soldTotalKey} ${doc[soldTotalKey]}`,
      difference: num(doc[totalKey]) - num(doc[soldTotalKey]),
    });
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Stock
 *
 * Stock is money that has not been sold yet, and a quantity that drifts is a
 * loss nobody can attribute. Every movement is written to stocklogs with the
 * balance before and after, which makes the whole history checkable rather
 * than merely recorded.
 * ------------------------------------------------------------------ */

/* One movement: the closing balance is the opening balance, moved. */
function checkStockEntry(entry = {}) {
  const problems = [];
  const opening = num(entry.opening_balance);
  const closing = num(entry.closing_balance);
  const count = Math.abs(num(entry.count));
  const adding = String(entry.action).toLowerCase() === 'add';
  const expected = adding ? opening + count : opening - count;

  if (Math.abs(expected - closing) > TOLERANCE) {
    problems.push({
      doc: String(entry._id),
      kind: 'stock',
      rule: 'movement',
      detail:
        `${entry.item_name || entry.view_item_id}: ${opening} ` +
        `${adding ? '+' : '-'} ${count} = ${expected}, recorded closing ${closing}` +
        ` (${entry.process || '?'})`,
      difference: closing - expected,
    });
  }
  return problems;
}

/*
 * A whole item's history, in order.
 *
 * Each movement must start where the last one finished. A gap means stock
 * changed without a movement being written - which is the case worth finding,
 * because it is invisible in every report and is what shrinkage looks like in
 * a database.
 */
function checkStockChain(entries = [], currentQuantity = null, label = '') {
  const problems = [];
  /*
   * Ordered by time, then by id.
   *
   * Several movements can share a timestamp - a sale of three lines writes
   * three in the same second - and comparing them in an arbitrary order
   * invents gaps that were never there. ObjectIds increase with creation, so
   * they settle the tie in the order the movements were actually written.
   */
  const ordered = [...entries].sort((a, b) => {
    const at = new Date(a.created_date || a.date || 0).getTime();
    const bt = new Date(b.created_date || b.date || 0).getTime();
    if (at !== bt) return at - bt;
    return String(a._id).localeCompare(String(b._id));
  });

  for (const entry of ordered) problems.push(...checkStockEntry(entry));

  for (let i = 1; i < ordered.length; i++) {
    const previousClose = num(ordered[i - 1].closing_balance);
    const thisOpen = num(ordered[i].opening_balance);
    if (Math.abs(previousClose - thisOpen) > TOLERANCE) {
      problems.push({
        doc: String(ordered[i]._id),
        kind: 'stock',
        rule: 'chain-break',
        detail:
          `${label || ordered[i].item_name}: previous movement closed at ` +
          `${previousClose}, next opened at ${thisOpen} - ` +
          `${(thisOpen - previousClose).toFixed(3)} unaccounted for`,
        difference: thisOpen - previousClose,
      });
    }
  }

  // And the last movement should be where the item stands today.
  if (currentQuantity !== null && ordered.length) {
    const lastClose = num(ordered[ordered.length - 1].closing_balance);
    if (Math.abs(lastClose - num(currentQuantity)) > TOLERANCE) {
      problems.push({
        doc: String(ordered[ordered.length - 1]._id),
        kind: 'stock',
        rule: 'balance-vs-item',
        detail: `${label}: last movement closed at ${lastClose}, item now holds ${currentQuantity}`,
        difference: num(currentQuantity) - lastClose,
      });
    }
  }

  return problems;
}

module.exports = {
  checkSale,
  checkPurchase,
  checkReturns,
  checkStockEntry,
  checkStockChain,
  expectedLineTotal,
  expectedPurchaseLineTotal,
  TOLERANCE,
};
