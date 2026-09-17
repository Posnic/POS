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
   * A line with a stroke drawn THROUGH it.
   *
   * ESC/POS has no strike-through - bold, underline, reverse video and
   * character size is the whole list - so the line is drawn as dots, and it
   * is the only thing that works on the hardware. See src/escpos-raster-text.js
   * for the three cheaper ideas that were printed on a real POS-80C and failed
   * on it, and for the three cuts that took a struck dish from 1,736 bytes to
   * under 200: only the cells with text, only the rows with ink, half the
   * columns with the printer doubling them back.
   *
   * Only a cancelled dish pays for it. A new order, which is nearly every
   * ticket, never comes through here.
   */
  strikeLine(s) {
    const text = ascii(s);
    if (!text) return this.line('');
    const { renderLine } = require('./escpos-raster-text');
    this.parts.push(renderLine(text, { columns: this.width, strike: true }));
    return this.raw(0x0a);
  }

  /*
   * Two columns, the second hard against the right edge.
   *
   * This is what an amount needs: whatever the label, the number ends at the
   * last column. Overlong labels are trimmed rather than wrapped, because a
   * wrapped label pushes the amount onto a line of its own and the receipt
   * stops being readable at a glance.
   */
  /**
   * The service rows, TWO TO A LINE.
   *
   * Owner, reading a printed bill: "Table number, order type, covers, total
   * quantity all these information can organize better as per international
   * standards and may be two column".
   *
   * He is right. Four facts about the table took four lines and pushed the
   * items down the paper, and a bill is read at a glance rather than down a
   * list. Every printed restaurant bill that carries these puts them in a
   * block.
   *
   * ONE TO A LINE ON NARROW PAPER. A 58mm roll is 32 characters; halved, that
   * is sixteen, and "Order type" plus a value does not fit in sixteen without
   * becoming "Order ty.". Losing a word to save a line is the wrong trade on
   * the one document the guest keeps.
   */
  serviceGrid(rows) {
    const list = (rows || []).filter((r) => r && r.label);
    if (!list.length) return this;

    if (this.width < 44) {
      for (const row of list) this.pair(row.label, row.value);
      return this;
    }

    /* Two characters of gutter, or the left value runs straight into the right
       label and prints "6AOrder type". */
    const GUTTER = 2;
    const half = Math.floor(this.width / 2);
    const cell = (row, room) => {
      if (!row) return ' '.repeat(room);
      const value = ascii(String(row.value == null ? '' : row.value));
      const space = room - value.length - 1;
      const label = ascii(String(row.label));
      const cut = label.length > space ? label.slice(0, Math.max(0, space - 1)) + '.' : label;
      const gap = Math.max(1, room - cut.length - value.length);
      return cut + ' '.repeat(gap) + value;
    };

    for (let i = 0; i < list.length; i += 2) {
      const left = cell(list[i], half - GUTTER) + ' '.repeat(GUTTER);
      const right = list[i + 1] ? cell(list[i + 1], this.width - half) : '';
      this.line((left + right).replace(/\s+$/, ''));
    }
    return this;
  }

  /**
   * A label and a value, with the value ending at a GIVEN column rather than
   * at the edge of the paper.
   *
   * Falls back to the ordinary right-aligned pair when there is no column to
   * aim at - a receipt with no item table, or one so narrow the name took a
   * line of its own - because a total printed somewhere odd is worse than a
   * total printed where every other total goes.
   */
  pairAtColumn(left, right, column) {
    const r = ascii(right == null ? '' : String(right));
    const l = ascii(left);
    if (!column || column <= 0 || column > this.width || column < l.length + r.length + 1) {
      return this.pair(left, r);
    }
    return this.line(l + ' '.repeat(column - l.length - r.length) + r);
  }

  pair(left, right, { bold = false, strike = false } = {}) {
    const r = ascii(right);
    const room = this.width - r.length - 1;
    const left_ = ascii(left);
    const l = left_.length > room ? left_.slice(0, Math.max(0, room - 1)) + '.' : left_;
    const gap = Math.max(1, this.width - l.length - r.length);
    /*
     * A struck line is drawn as dots, and dots are paid for by the column -
     * padding the quantity out to the right edge would raster thirty blank
     * cells to carry one digit. So a cancelled dish reads "NAME  2" with the
     * quantity two spaces after the words, and the raster is only as wide as
     * that. Two spaces exactly: that gap is how the stroke knows where the
     * words stop (see wordCells), and one would be mistaken for part of a
     * name like "BARBEQUE - FULL".
     */
    const composed = strike ? l + '  ' + r : l + ' '.repeat(gap) + r;
    if (bold) this.bold(true);
    if (strike) this.strikeLine(composed);
    else this.line(composed);
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
      return {
        name: ascii(r.name),
        /*
         * OPTIONAL, and absent on every receipt that does not ask for it.
         *
         * A tax invoice states what one of a thing costs - it is the number a
         * customer checks against the menu and an accountant checks against
         * anything. A settled counter receipt does not need it, so the column
         * appears only when a row carries a rate and every existing caller is
         * unchanged.
         */
        rate: ascii(r.rate == null ? '' : r.rate),
        /* OPTIONAL, like the rate. A tax invoice in India may need the HSN or
           SAC code per line; a counter receipt never does. */
        hsn: ascii(r.hsn == null ? '' : r.hsn),
        value,
        unit,
        amount: ascii(r.amount == null ? '' : r.amount),
      };
    });

    const measured = header
      ? cells.concat([
          {
            name: ascii(header.name),
            rate: ascii(header.rate == null ? '' : header.rate),
            hsn: ascii(header.hsn == null ? '' : header.hsn),
            ...split(header.qty),
            amount: ascii(header.amount),
          },
        ])
      : cells;
    const widest = (pick) => measured.reduce((w, c) => Math.max(w, pick(c).length), 0);

    /*
     * The header word alone must not open the column. A caller can always pass
     * 'RATE' and still print a receipt with no rates on it; measuring the
     * header would then reserve five characters of a 48-character line to
     * print the word RATE over nothing.
     */
    const anyRate = cells.some((c) => c.rate);
    const rateW = anyRate ? widest((c) => c.rate) : 0;
    const anyHsn = cells.some((c) => c.hsn);
    const hsnW = anyHsn ? widest((c) => c.hsn) : 0;
    const qtyW = widest((c) => c.value);
    const unitW = widest((c) => c.unit);
    const amtW = widest((c) => c.amount);

    /* One gutter before each column that is actually present. */
    const gutters = (hsnW ? 1 : 0) + (rateW ? 1 : 0) + 1 + (unitW ? 1 : 0) + 1;
    const nameW = this.width - hsnW - rateW - qtyW - unitW - amtW - gutters;

    /*
     * If the numbers leave the name no usable room - a narrow roll, or prices
     * in the tens of thousands - the name takes a line of its own and the
     * numbers follow on the next, still in their columns. Squeezing the name to
     * three characters would be worse than spending the paper.
     */
    const MIN_NAME = 8;
    const stacked = nameW < MIN_NAME;
    const nameCol = stacked ? this.width : nameW;

    /*
     * WHERE THE QUANTITY COLUMN ENDS, so a total underneath can line up with
     * the numbers it totals.
     *
     * Owner, on a printed bill: "total quantity just make it same alignment of
     * quantity column. not to the last. i think its better."
     *
     * He is right. A count printed hard against the right edge sits under the
     * AMOUNT column and reads as money at a glance - the one column on a bill
     * where a number must not be mistaken. Under the quantities it is
     * obviously a count of them.
     *
     * Recorded here because here is the only place the widths are known. Every
     * other file would be guessing, and a guess would be wrong the first time
     * a shop sold something by the kilo.
     */
    this.qtyColumn = stacked
      ? 0
      : nameW + 1 + (hsnW ? hsnW + 1 : 0) + (rateW ? rateW + 1 : 0) + qtyW;

    const numbers = (c) => {
      /* Rate before quantity, the way a bill is read: this many, at this
         price, comes to this. */
      const parts = [];
      /* Code, then price, then how many - the order the reference invoice uses
         and the order a line is read in. */
      if (hsnW) parts.push(c.hsn.padStart(hsnW));
      if (rateW) parts.push(c.rate.padStart(rateW));
      parts.push(c.value.padStart(qtyW));
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
      render({
        name: ascii(header.name),
        rate: ascii(header.rate == null ? '' : header.rate),
        hsn: ascii(header.hsn == null ? '' : header.hsn),
        ...split(header.qty),
        amount: ascii(header.amount),
      });
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
  /* A food business in India shows its FSSAI licence on the invoice. Printed
     under the GSTIN, where the owner's own reference bill puts it. */
  if (sale.fssai) r.centre('FSSAI: ' + sale.fssai);
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
  /*
   * Where the order came from, when the shop asks for it.
   *
   * The payload decides: it is a switch that now defaults OFF, because the
   * owner read one off the roll - "'From' not required in the bill. only kot
   * fine." The kitchen ticket is built by escpos-kot.js and still prints it
   * every time, which is where it was always earning its space.
   *
   * Absent prints nothing rather than an empty line.
   */
  if (sale.source) r.line('From: ' + sale.source);
  // A walk-in sale has no customer, and a blank name line reads as a fault.
  for (const c of sale.customer || []) r.line(c);

  /*
   * Which service, which table, who took it - in the header, where a bill is
   * read. Each one is a per-shop switch and the list is empty unless a shop
   * turned something on, so nothing moves for anybody who has not asked.
   */
  r.serviceGrid(sale.serviceRows);
  r.rule();

  /*
   * Header and items are laid out together, so the column widths are measured
   * across every row of the table at once - including the header. Printing the
   * header separately is what let "QTY AMOUNT" sit over columns the items did
   * not actually use.
   */
  /*
   * RATE is what one of the thing costs, before tax.
   *
   * The owner, reading a printed bill: "paneer starter 2 x 240 its wrong. it
   * supposed to 200. means 200 x 2. then we add tax. its exlusive properly
   * need to be displayed."
   *
   * The line used to print the tax-inclusive amount against the quantity with
   * no unit price at all, so 2 of a 200 rupee dish read as 480 sitting beside
   * a subtotal of 400 and the paper contradicted itself. Rate x quantity now
   * equals the amount, the amount adds up to the subtotal, and the tax is
   * added underneath where an exclusive tax belongs.
   *
   * The column is omitted entirely when the payload carries no rates, so a
   * counter receipt is unchanged.
   */
  r.itemTable(
    (sale.items || []).map((it) => ({
      name: it.name,
      hsn: it.hsn,
      rate: it.rate,
      qty: it.qty,
      amount: money(it.amount),
    })),
    { name: 'ITEM', hsn: 'HSN', rate: 'RATE', qty: 'QTY', amount: 'AMOUNT' },
    { afterHeader: (rec) => rec.rule() },
  );

  r.rule();
  /*
   * How many dishes, immediately above what they came to. It used to sit in the
   * header beside the table number, which is where a restaurant looks and not
   * where a guest does - a count belongs with the arithmetic it is part of.
   */
  if (sale.totalQty) r.pairAtColumn('Total Qty', String(sale.totalQty), r.qtyColumn);
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
