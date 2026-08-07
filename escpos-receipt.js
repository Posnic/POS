'use strict';
/*
 * Receipts as ESC/POS commands.
 *
 * The desktop app used to print receipts by handing HTML to the Windows
 * driver. That works in a browser because the print dialog quietly scales the
 * page to fit; a silent print has no such rescue, so the layout had to be
 * exactly right and it never was.
 *
 * A thermal printer does not want a page. It wants characters and a handful of
 * control codes, and it has a fixed number of columns:
 *
 *   58mm roll   32 characters   384 dots
 *   80mm roll   48 characters   576 dots
 *
 * Laying out to columns instead of millimetres removes every question about
 * scaling, driver page sizes and CSS. A line either fits in 48 characters or
 * it does not, and that is decidable here rather than on the paper.
 *
 * The browser keeps printing HTML, which is what its users already have.
 */

const ESC = 0x1b;
const GS = 0x1d;

// Columns at Font A. Font B is narrower but harder to read on a receipt a
// customer has to check at a counter.
const COLUMNS = { '58': 32, '80': 48 };

/*
 * Text a thermal printer can actually render.
 *
 * The printer is set to code page 1252, which has no rupee sign: U+20B9 sent
 * as a byte becomes 0xB9, a superscript one, so "₹ 800.00" prints as
 * "¹ 800.00". Nor does it have the curly quotes and en-dashes that arrive with
 * text pasted into a shop's receipt template from a word processor.
 *
 * So the substitutions happen here, in characters, before anything is laid
 * out. Doing it at the byte stage instead would be too late: "Rs." is three
 * characters where "₹" was one, and pair() has already counted the columns by
 * then, which would push every amount one place off the right margin.
 */
const SUBSTITUTIONS = [
  [/[₹₨]/g, 'Rs.'],   // rupee sign, and the older Rs ligature
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—−]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
];

function ascii(s) {
  let out = String(s == null ? '' : s);
  for (const [pattern, with_] of SUBSTITUTIONS) out = out.replace(pattern, with_);
  // Anything still outside the code page would be sent as a truncated byte and
  // print as an unrelated character, which is worse than printing nothing.
  return out.replace(/[^\x20-\xff\n]/g, '');
}

class Receipt {
  constructor(paperWidth = '80') {
    this.width = COLUMNS[paperWidth] || COLUMNS['80'];
    this.parts = [];
    this.raw(ESC, 0x40);             // initialise: clears any state a previous job left
    this.raw(ESC, 0x74, 0x10);       // code page 16 (WPC1252) so the rupee sign survives
  }

  raw(...bytes) { this.parts.push(Buffer.from(bytes)); return this; }
  /*
   * The last gate before bytes. Callers that lay out columns sanitise first,
   * because they have to count characters; this catches everything else -
   * a bill number, a customer name - that goes straight to the paper.
   */
  text(s) { this.parts.push(Buffer.from(ascii(s), 'latin1')); return this; }

  /* Alignment: 0 left, 1 centre, 2 right. */
  align(n) { return this.raw(ESC, 0x61, n); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }

  /*
   * Character size. ESC/POS packs width and height into one byte, 0-7 each,
   * so a "double" is one step rather than a point size.
   */
  size(w = 0, h = 0) { return this.raw(GS, 0x21, ((w & 7) << 4) | (h & 7)); }

  line(s = '') { return this.text(s).raw(0x0a); }

  /* A row of dashes the exact width of the paper. */
  rule(ch = '-') { return this.line(ch.repeat(this.width)); }

  feed(n = 1) { return this.raw(ESC, 0x64, n); }

  /*
   * Cut the paper, after feeding enough to clear the blade.
   *
   * The cutter sits a couple of centimetres past the print head, so cutting
   * without feeding first takes the last lines of the receipt with it.
   */
  cut() { return this.feed(4).raw(GS, 0x56, 0x42, 0x00); }

  /* Open a drawer wired to the printer, which is how most tills are set up. */
  openDrawer(pin = 0) { return this.raw(ESC, 0x70, pin === 0 ? 0 : 1, 0x19, 0xfa); }

  /*
   * Two columns, the second hard against the right edge.
   *
   * This is what an amount needs: whatever the label, the number ends at the
   * last column. Overlong labels are trimmed rather than wrapped, because a
   * wrapped label pushes the amount onto a line of its own and the receipt
   * stops being readable at a glance.
   */
  pair(left, right, { bold = false } = {}) {
    const r = ascii(right);
    const room = this.width - r.length - 1;
    const left_ = ascii(left);
    const l = left_.length > room ? left_.slice(0, Math.max(0, room - 1)) + '.' : left_;
    const gap = Math.max(1, this.width - l.length - r.length);
    if (bold) this.bold(true);
    this.line(l + ' '.repeat(gap) + r);
    if (bold) this.bold(false);
    return this;
  }

  /*
   * The item table, in columns measured once for the whole receipt.
   *
   * This is the part that has to be exact. The previous version sized the name
   * column per row, from the width of that row's own amount - so a line of
   * 188.00 and a line of 40.00 put their quantities one character apart, and
   * the "kg" of one row sat under the space of the next. Nothing was wrong with
   * any single line; they simply were not the same table.
   *
   * Columns, from the right:
   *
   *   AMOUNT  right-aligned. Money is always two decimals, so right-aligning
   *           equal-width strings lines the decimal points up as a consequence
   *           rather than as a special case.
   *   UNIT    left-aligned, its own column, so kg sits under kg and pcs under
   *           pcs even on a receipt that mixes them.
   *   QTY     right-aligned, so 0.250 and 2 line up on the decimal too.
   *   ITEM    whatever is left, wrapping rather than truncating.
   *
   * Every width is the longest cell in that column across the whole table,
   * header included, so the widths are known before the first line is printed
   * and no row can push another out of true. The four columns plus their single
   * -space gutters add up to exactly the paper width - the line is built to fill
   * it, never to overflow it, because a line one character too long wraps on the
   * printer and takes the column with it.
   */
  itemTable(rows, header, { afterHeader } = {}) {
    const split = (qty) => {
      const q = ascii(qty == null ? '' : qty).trim();
      const at = q.indexOf(' ');
      return at === -1
        ? { value: q, unit: '' }
        : { value: q.slice(0, at), unit: q.slice(at + 1).trim() };
    };

    const cells = rows.map((r) => {
      const { value, unit } = split(r.qty);
      return { name: ascii(r.name), value, unit, amount: ascii(r.amount == null ? '' : r.amount) };
    });

    const measured = header
      ? cells.concat([{ name: ascii(header.name), ...split(header.qty), amount: ascii(header.amount) }])
      : cells;
    const widest = (pick) => measured.reduce((w, c) => Math.max(w, pick(c).length), 0);

    const qtyW = widest((c) => c.value);
    const unitW = widest((c) => c.unit);
    const amtW = widest((c) => c.amount);

    /* One gutter before each column that is actually present. */
    const gutters = 1 + (unitW ? 1 : 0) + 1;
    const nameW = this.width - qtyW - unitW - amtW - gutters;

    /*
     * If the numbers leave the name no usable room - a narrow roll, or prices
     * in the tens of thousands - the name takes a line of its own and the
     * numbers follow on the next, still in their columns. Squeezing the name to
     * three characters would be worse than spending the paper.
     */
    const MIN_NAME = 8;
    const stacked = nameW < MIN_NAME;
    const nameCol = stacked ? this.width : nameW;

    const numbers = (c) => {
      const parts = [c.value.padStart(qtyW)];
      if (unitW) parts.push(c.unit.padEnd(unitW));
      parts.push(c.amount.padStart(amtW));
      return parts.join(' ');
    };

    const render = (c) => {
      const n = c.name || '';

      /*
       * A name that fits takes its numbers alongside.
       *
       * One that does not is printed whole, across the full width, and its
       * numbers follow on the next line - indented by exactly the name column
       * so they land in the same places as every other row. Splitting the name
       * around the numbers would keep the table tidy at the cost of the one
       * thing a customer checking their bill reads: "Rice 5kg 1 qty 480.00
       * premium sona masoori basmati" is not a product anybody sold.
       */
      if (!stacked && n.length <= nameW) {
        this.line(n.padEnd(nameW) + ' ' + numbers(c));
        return;
      }

      for (const l of wrap(n, this.width)) this.line(l);
      this.line(' '.repeat(stacked ? Math.max(0, this.width - numbers(c).length) : nameW + 1)
        + numbers(c));
    };

    if (header) {
      this.bold(true);
      render({ name: ascii(header.name), ...split(header.qty), amount: ascii(header.amount) });
      this.bold(false);
      if (afterHeader) afterHeader(this);
    }
    for (const c of cells) render(c);
    return this;
  }

  /* A single item line, laid out as a one-row table. */
  item(name, qty, amount) {
    return this.itemTable([{ name, qty, amount }]);
  }

  /* Centre a line without padding it, so the printer does the centring. */
  centre(s, { bold = false, size = 0 } = {}) {
    this.align(1);
    if (size) this.size(size, size);
    if (bold) this.bold(true);
    /*
     * Centred text is wrapped here rather than left to the printer, which
     * would break it at whatever character reached the last column. Double
     * width halves how much fits, so the store name wraps at 24 on an 80mm
     * roll, not 48.
     */
    for (const w of wrap(ascii(s), size ? Math.floor(this.width / (size + 1)) : this.width)) {
      this.line(w);
    }
    if (size) this.size(0, 0);
    this.align(0);
    return this;
  }

  build() { return Buffer.concat(this.parts); }
}

/*
 * Break text on word boundaries at a given width.
 *
 * A word longer than the paper - a URL, usually - is cut, because there is no
 * boundary to break it on and the printer would otherwise wrap it anywhere.
 */
function wrap(text, width) {
  const out = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) { out.push(line); line = ''; }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/*
 * A sale, as bytes.
 *
 * Everything optional is absent rather than blank: a receipt with an empty
 * GSTIN line looks broken, where one without the line simply does not mention
 * tax.
 */
function renderSale(sale, options = {}) {
  const r = new Receipt(options.paperWidth || '80');
  const money = (n) => Number(n || 0).toFixed(2);

  if (sale.storeName) r.centre(sale.storeName, { bold: true, size: 1 });
  if (sale.storeAddress) String(sale.storeAddress).split('\n').forEach((l) => r.centre(l));
  if (sale.storePhone) r.centre(sale.storePhone);
  if (sale.storeEmail) r.centre(sale.storeEmail);
  if (sale.gstin) r.centre('GSTIN: ' + sale.gstin);
  r.rule();

  /*
   * What kind of document this is.
   *
   * A sale, a sale return, a purchase and a purchase return all come through
   * here, and on a roll of paper with no letterhead the title is the only
   * thing telling them apart. It is configurable per shop, so it is printed
   * rather than assumed.
   */
  if (sale.title) r.centre(sale.title, { bold: true });

  if (sale.billNo || sale.date) {
    if (sale.billNo && sale.date) r.pair(sale.billNo, sale.date);
    else r.line(sale.billNo || sale.date);
  }
  if (sale.cashier) r.pair('Cashier: ' + sale.cashier, sale.branch || '');
  // A walk-in sale has no customer, and a blank name line reads as a fault.
  for (const c of sale.customer || []) r.line(c);
  r.rule();

  /*
   * Header and items are laid out together, so the column widths are measured
   * across every row of the table at once - including the header. Printing the
   * header separately is what let "QTY AMOUNT" sit over columns the items did
   * not actually use.
   */
  r.itemTable(
    (sale.items || []).map((it) => ({ name: it.name, qty: it.qty, amount: money(it.amount) })),
    { name: 'ITEM', qty: 'QTY', amount: 'AMOUNT' },
    { afterHeader: (rec) => rec.rule() },
  );

  r.rule();
  if (sale.subTotal != null) r.pair('Subtotal', money(sale.subTotal));
  for (const t of sale.taxes || []) r.pair(t.label, money(t.amount));
  if (sale.discount) r.pair('Discount', '-' + money(sale.discount));
  if (sale.roundOff) r.pair('Round off', money(sale.roundOff));

  /*
   * The total, twice the height and fenced by rules.
   *
   * It is the one number the customer looks for, so it is the one thing on the
   * receipt that does not have to be searched for.
   */
  r.rule('=');
  r.size(0, 1).pair('TOTAL', money(sale.total), { bold: true }).size(0, 0);
  r.rule('=');

  for (const p of sale.payments || []) r.pair(p.label, money(p.amount));
  if (sale.change != null) r.pair('Change', money(sale.change));

  /*
   * Rows the shop's own template carried that this code does not know by name.
   *
   * The receipt template is editable, so a shop can add a line - a loyalty
   * balance, a vehicle number, a delivery slot - and it would silently vanish
   * if only the recognised totals were printed. These keep their label and
   * their text exactly as the template produced them.
   */
  for (const e of sale.extras || []) r.pair(e.label, e.value);

  if (sale.itemCount != null || sale.totalWeight != null) {
    r.rule();
    if (sale.itemCount != null) r.pair('No. of items', String(sale.itemCount));
    if (sale.totalWeight != null) r.pair('Total weight', sale.totalWeight);
  }

  r.feed(1);
  /*
   * The footer is free text - a return policy, an offer, a website - so unlike
   * every other line here its length is unbounded. Wrapping on words keeps it
   * readable; letting the printer wrap it would break mid-word at column 48.
   */
  if (sale.footer) {
    for (const line of String(sale.footer).split('\n')) {
      for (const w of wrap(line, r.width)) r.centre(w);
    }
  }
  if (sale.showThanks !== false) r.centre('Thank you, please visit again');

  if (options.openDrawer) r.openDrawer(options.drawerPin);
  if (options.cut !== false) r.cut();

  return r.build();
}

module.exports = { Receipt, renderSale, COLUMNS };
