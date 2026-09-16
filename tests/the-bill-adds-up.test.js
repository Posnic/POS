'use strict';

/*
 * A bill has to agree with itself.
 *
 * THE PAPER THE OWNER READ
 *
 *   Paneer Starter        2 x 240        480.00
 *   ...
 *   Subtotal                             400.00
 *
 * "paneer starter 2 x 240 its wrong. it supposed to 200. means 200 x 2. then we
 * add tax. its exlusive properly need to be displayed."
 *
 * Two things were wrong at once and they hid each other. The line printed the
 * tax-INCLUSIVE amount (240 a plate, 480 the line) while the subtotal below it
 * added the tax-EXCLUSIVE ones (400), and the unit price was never printed at
 * all - so the only number a customer could check the menu against was the one
 * with tax folded into it, and the two halves of the document disagreed by
 * exactly the tax.
 *
 * On an exclusive-tax bill the line is the pre-tax line. The tax is added once,
 * underneath, where it can be seen being added. Anything else is a bill that
 * charges tax twice on paper even when it collects it once.
 *
 * AND THREE THINGS THE BILL WAS SAYING THAT ARE NOT ITS BUSINESS
 *
 * "No need to print 'Unpaid' near Tax Invoice." / "'From' not required in the
 * bill. only kot fine." / "in the bill Table, order type, covers umber of items
 * not required. KOT fine. not in the bill."
 *
 * Each of those is the restaurant talking to itself. The kitchen ticket needs
 * every one of them and still prints them; the customer's copy carries what is
 * owed and why, and nothing else.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { renderSale } = require(path.join(ROOT, 'src', 'escpos-receipt.js'));
const { buildBillPayload } = require(path.join(ROOT, 'api', 'src', 'helpers', 'bill-payload.js'));

/* The sale off the owner's photograph, with the numbers that produced it. */
const SALE = {
  sales_id: 'SB1D14-000051',
  date: new Date('2026-09-14T11:35:00Z'),
  customer_name: 'Ramesh Kumar',
  table_number: '4',
  dine_type: 'Dine In',
  person_count: 2,
  created_by: 'Sridhar',
  channel: 'tableside',
  items: [
    { name: 'Paneer Starter', item_quantity: 2, item_base_price: 200, item_tax: 20 },
    { name: 'Butter Naan', item_quantity: 3, item_base_price: 45, item_tax: 6.75 },
  ],
  sales_sub_total: 535,
  tax: 26.75,
  sales_total: 561.75,
};
const BRANCH = {
  branch_name: 'Sri Balaji Restaurant',
  branch_gstin_number: '34AAAAA0000A1Z5',
  indian_gst: 'enable',
};

/*
 * What actually comes off the roll, printer commands stripped.
 *
 * The commands have to be PARSED, not filtered by byte range: `ESC a 1` is
 * 0x1b 0x61 0x01, and 0x61 is a perfectly printable lowercase a. Dropping only
 * the control bytes leaves a stray letter glued to the front of the next line,
 * which then measures one character too wide and fails an overflow check that
 * has nothing wrong with it.
 */
const ARGS = { 0x40: 0, 0x74: 1, 0x61: 1, 0x45: 1, 0x64: 1, 0x70: 3 }; // after ESC
const GS_ARGS = { 0x21: 1, 0x56: 2 }; //                                 after GS

function paper(payload) {
  const bytes = renderSale(payload, { paperWidth: '48' });
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x1b || b === 0x1d) {
      const table = b === 0x1b ? ARGS : GS_ARGS;
      const cmd = bytes[i + 1];
      i += 1 + (table[cmd] == null ? 1 : table[cmd]);
      continue;
    }
    if (b === 10) text += '\n';
    else if (b >= 32 && b <= 126) text += String.fromCharCode(b);
  }
  return text;
}

/* ----------------------------------------------------------- the arithmetic */

test('THE LINE MULTIPLIES OUT, and it multiplies out to the subtotal', () => {
  const bill = buildBillPayload(SALE, BRANCH);
  for (const it of bill.items) {
    const rate = Number(it.rate);
    const qty = Number(String(it.qty).split(' ')[0]);
    assert.ok(rate > 0, it.name + ' printed no unit price, the number a customer checks');
    assert.strictEqual(
      Math.round(rate * qty * 100) / 100,
      Number(it.amount),
      it.name + ': ' + rate + ' x ' + qty + ' does not come to ' + it.amount
    );
  }
  const summed = bill.items.reduce((s, it) => s + Number(it.amount), 0);
  assert.strictEqual(
    Math.round(summed * 100) / 100,
    bill.subTotal,
    'the lines do not add up to the subtotal printed under them'
  );
});

test('the rate is the price BEFORE tax, not the price with tax folded in', () => {
  /* The regression exactly. 240 is 200 plus 5% GST; printing 240 as the rate
     is how the line came to 480 against a subtotal of 400. */
  const bill = buildBillPayload(SALE, BRANCH);
  const paneer = bill.items.find((i) => i.name === 'Paneer Starter');
  assert.strictEqual(paneer.rate, '200.00', 'the rate has tax in it');
  assert.strictEqual(paneer.amount, 400, 'the line has tax in it');
});

test('and the tax is added once, underneath, where it can be seen', () => {
  const bill = buildBillPayload(SALE, BRANCH);
  const tax = bill.taxes.reduce((s, t) => s + Number(t.amount), 0);
  assert.strictEqual(
    Math.round((bill.subTotal + tax) * 100) / 100,
    bill.total,
    'subtotal plus tax is not the total, so the bill contradicts itself'
  );
  /* Still carrying the rate it was charged at, which was the previous fix and
     must survive this one. */
  assert.deepStrictEqual(
    bill.taxes.map((t) => t.label),
    ['CGST 2.5%', 'SGST 2.5%']
  );
});

test('the rate reaches the paper, under a column that says what it is', () => {
  const text = paper({ ...buildBillPayload(SALE, BRANCH), title: 'TAX INVOICE' });
  assert.match(text, /ITEM\s+RATE\s+QTY\s+AMOUNT/, 'the rate column is not headed');
  assert.match(
    text,
    /Paneer Starter\s+200\.00\s+2\s+400\.00/,
    'the line does not read as rate, quantity, amount'
  );
  assert.match(text, /Subtotal\s+535\.00/);
});

/* ------------------------------------------------- what it no longer prints */

test('it does not say UNPAID', () => {
  assert.ok(!/UNPAID/.test(paper({ ...buildBillPayload(SALE, BRANCH), title: 'TAX INVOICE' })));
});

test('it does not say where the order came from', () => {
  const bill = buildBillPayload(SALE, BRANCH);
  assert.strictEqual(bill.source, '', 'the payload still carries a source');
  assert.ok(!/From:/.test(paper({ ...bill, title: 'TAX INVOICE' })));
});

test('it does not carry the table, the order type, the covers or the item count', () => {
  const bill = buildBillPayload(SALE, BRANCH);
  const text = paper({ ...bill, title: 'TAX INVOICE' });
  assert.deepStrictEqual(bill.serviceRows, [], 'the bill still carries the shop rows');
  assert.strictEqual(bill.itemCount, undefined);
  for (const gone of [/Table/, /Order type/, /Covers/, /No\. of items/, /Steward/]) {
    assert.ok(!gone.test(text), 'the bill still prints ' + gone);
  }
});

/* ---------------------------------------------------- but every one is a switch */

test('NONE OF IT IS DELETED - a shop that wants the hotel bill switches it on', () => {
  /*
   * The owner sent a hotel restaurant's invoice carrying table, session,
   * steward and covers: "we have those as optional. no need to incluede...
   * based on settings we can add it."
   *
   * So the removal is a DEFAULT, not a decision. Deleting the rows would have
   * been the easy read of "not required in the bill" and would have left that
   * shop unable to bill the way it bills.
   */
  const on = buildBillPayload(SALE, {
    ...BRANCH,
    bill_print_source: true,
    bill_print_table: true,
    bill_print_dine_type: true,
    bill_print_covers: true,
    bill_print_steward: true,
    bill_print_total_qty: true,
  });
  assert.strictEqual(on.source, 'Captain app');
  assert.deepStrictEqual(on.serviceRows, [
    { label: 'Table', value: '4' },
    { label: 'Order type', value: 'Dine In' },
    { label: 'Covers', value: '2' },
    { label: 'Steward', value: 'Sridhar' },
  ]);

  /*
   * Total Qty is NOT a service row, deliberately. Owner, on a printed bill:
   * "moving total quantity to bottom". It is a count of what was bought, so it
   * belongs beside the subtotal where a reader is already adding up, not in the
   * header with the table number. Still switched by the same toggle, still
   * dishes rather than lines - 2 paneer and 3 naan is 5.
   */
  assert.strictEqual(on.totalQty, '5');
  assert.ok(
    !on.serviceRows.some((r) => /Total Qty/i.test(r.label)),
    'the count is back in the header, where the restaurant looks and the guest does not'
  );

  const text = paper({ ...on, title: 'TAX INVOICE' });
  assert.match(text, /From: Captain app/);
  assert.match(text, /Table\s+4/);
  assert.match(text, /Steward\s+Sridhar/);
  assert.match(text, /Total Qty\s+5/, 'the count stopped printing anywhere at all');
});

test('and the switch is read as the settings form stores it, a string', () => {
  /* 'false' is a real stored value; reading it as a boolean is how a switched
     -off setting silently stays on, which this codebase has been bitten by. */
  const off = buildBillPayload(SALE, { ...BRANCH, bill_print_table: 'false' });
  assert.deepStrictEqual(off.serviceRows, []);
  const on = buildBillPayload(SALE, { ...BRANCH, bill_print_table: 'true' });
  assert.deepStrictEqual(on.serviceRows, [{ label: 'Table', value: '4' }]);
});

test('a switch turned on for something the sale does not have prints nothing', () => {
  /* A takeaway has no table. An empty row with a label and no value is worse
     than no row: it reads as a fault on the paper. */
  const bill = buildBillPayload(
    { ...SALE, table_number: '', person_count: 0, created_by: '' },
    { ...BRANCH, bill_print_table: true, bill_print_covers: true, bill_print_steward: true }
  );
  assert.deepStrictEqual(bill.serviceRows, []);
});

test('BUT THE KITCHEN TICKET KEEPS ALL OF IT', () => {
  /*
   * The whole argument for removing them is that the kitchen has them. If this
   * ever fails, the removal stopped being a tidy-up and started being a loss:
   * a cook who cannot see the table number cannot send the food anywhere.
   */
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'escpos-kot.js'), 'utf8');
  for (const kept of ['table', 'source']) {
    assert.ok(new RegExp(kept, 'i').test(kot), 'the kitchen ticket lost its ' + kept);
  }
});

/* ------------------------------------------------ and receipts are untouched */

test('a receipt with no rates prints exactly as it did, no empty column', () => {
  /*
   * itemTable is shared. A counter receipt passes no rate, and reserving five
   * characters of a 48-character line to head a column of blanks would be a
   * regression paid for by every shop that is not a restaurant.
   */
  const text = paper({
    title: 'RECEIPT',
    billNo: 'SB1D14-000052',
    items: [{ name: 'Sona Masoori Rice', qty: '5 kg', amount: 480 }],
    subTotal: 480,
    total: 480,
  });
  assert.ok(!/RATE/.test(text), 'a receipt with no rates grew a rate column');
  assert.match(text, /Sona Masoori Rice\s+5 kg\s+480/, 'the receipt line stopped laying out');
});

test('no line is wider than the paper', () => {
  /* A line one character too long wraps on the printer and takes the column
     with it, which is how a tidy table becomes unreadable on real paper. */
  const text = paper({ ...buildBillPayload(SALE, BRANCH), title: 'TAX INVOICE' });
  for (const line of text.split('\n')) {
    assert.ok(line.length <= 48, 'overflows the roll: ' + JSON.stringify(line));
  }
});

/* ------------------------------- the rest of the hotel bill, as configuration */

/*
 * Owner, sent the remaining fields off his reference invoice: "extra bill field
 * keep it as configuration."
 *
 * Session, HSN/SAC and the FSSAI licence. Off by default like every other row,
 * and each one absent rather than blank when the shop has not got the data -
 * a labelled empty line on a tax invoice reads as a fault.
 *
 * KOT numbers and Room No are NOT here. Neither exists as data: the server
 * records no kitchen ticket number and there is no room concept. Printing a
 * label with nothing behind it would have been the easy half of the job and
 * the useless one.
 */

const HOTEL = {
  branch_name: 'Virundu Restaurant',
  branch_gstin_number: '33AABCM9561A1ZS',
  branch_fssai_number: '12415013000025',
  indian_gst: 'enable',
  menu_dayparts: [
    { id: 'lunch', name: 'Lunch', hours: [{ from: '12:00', to: '15:00' }] },
    { id: 'dinner', name: 'Dinner', hours: [{ from: '19:00', to: '01:00' }] },
  ],
};

const AT = (h, m = 0) => ({
  ...SALE,
  date: new Date(2026, 8, 14, h, m),
  items: [{ name: 'Malabar Paratha', item_quantity: 4, item_base_price: 100, hsncode: '996332' }],
  sales_sub_total: 400,
  tax: 72,
  sales_total: 472,
});

test('THE SESSION COMES FROM THE SERVING TIMES THE SHOP ALREADY SET', () => {
  /*
   * Reusing menu_dayparts rather than asking for the times again. Two lists
   * that can disagree is how a bill comes to say Dinner while the kitchen is
   * serving lunch.
   */
  const on = { ...HOTEL, bill_print_session: true };
  const rows = (h) => buildBillPayload(AT(h), on).serviceRows;
  assert.deepStrictEqual(rows(13), [{ label: 'Session', value: 'Lunch' }]);
  assert.deepStrictEqual(rows(20), [{ label: 'Session', value: 'Dinner' }]);
});

test('and a service that runs past midnight is still that service', () => {
  /* Dinner to one in the morning is a real shift, not bad data. A naive
     from <= now < to would call half of it nothing. */
  const on = { ...HOTEL, bill_print_session: true };
  assert.deepStrictEqual(buildBillPayload(AT(0, 30), on).serviceRows, [
    { label: 'Session', value: 'Dinner' },
  ]);
});

test('a sale outside every serving time prints no session, rather than guessing', () => {
  const on = { ...HOTEL, bill_print_session: true };
  assert.deepStrictEqual(buildBillPayload(AT(17), on).serviceRows, []);
  /* And a shop that has defined no serving times at all. */
  assert.deepStrictEqual(
    buildBillPayload(AT(20), { bill_print_session: true }).serviceRows,
    []
  );
});

test('THE HSN COLUMN APPEARS ONLY WHERE THERE ARE CODES', () => {
  const on = { ...HOTEL, bill_print_hsn: true };
  assert.strictEqual(buildBillPayload(AT(20), on).items[0].hsn, '996332');
  /* Off by default. */
  assert.strictEqual(buildBillPayload(AT(20), HOTEL).items[0].hsn, '');

  const text = paper({ ...buildBillPayload(AT(20), on), title: 'TAX INVOICE' });
  assert.match(text, /ITEM\s+HSN\s+RATE\s+QTY\s+AMOUNT/, 'the column is not headed');
  assert.match(text, /Malabar Paratha\s+996332\s+100\.00\s+4\s+400\.00/);
});

test('a sale from before the code was stored prints no empty stripe', () => {
  /*
   * Every sale made before hsncode existed has none. Switching the column on
   * must not draw a blank column down a year of old bills, so it is dropped
   * when no line carries a code - the same rule the rate column follows.
   */
  const old = { ...AT(20), items: [{ name: 'Malabar Paratha', item_quantity: 4, item_base_price: 100 }] };
  const text = paper({ ...buildBillPayload(old, { ...HOTEL, bill_print_hsn: true }), title: 'TAX INVOICE' });
  assert.ok(!/HSN/.test(text), 'an empty HSN column was printed anyway');
  assert.match(text, /ITEM\s+RATE\s+QTY\s+AMOUNT/);
});

test('the FSSAI licence prints under the GSTIN, where a food invoice carries it', () => {
  const on = { ...HOTEL, bill_print_fssai: true };
  assert.strictEqual(buildBillPayload(AT(20), on).fssai, '12415013000025');
  assert.strictEqual(buildBillPayload(AT(20), HOTEL).fssai, '', 'it printed without being asked');

  const text = paper({ ...buildBillPayload(AT(20), on), title: 'TAX INVOICE' });
  const gstinAt = text.indexOf('GSTIN: 33AABCM9561A1ZS');
  const fssaiAt = text.indexOf('FSSAI: 12415013000025');
  assert.ok(gstinAt > -1 && fssaiAt > gstinAt, 'the licence is not under the GSTIN');
});

test('a shop with the switch on but no licence prints no label', () => {
  /* A labelled empty line on a tax invoice reads as a fault. */
  const bill = buildBillPayload(AT(20), { ...HOTEL, branch_fssai_number: '', bill_print_fssai: true });
  assert.strictEqual(bill.fssai, '');
  assert.ok(!/FSSAI/.test(paper({ ...bill, title: 'TAX INVOICE' })));
});

test('THE SHOP ROWS ARE IN THE HEADER, not stranded after the total', () => {
  /*
   * Where a bill is read. The reference invoice puts Session, Table and Steward
   * beside the bill number at the top, and a waiter carrying it needs the table
   * before anything else. They were printing after the TOTAL, which is where
   * template extras belong and these do not.
   */
  const bill = buildBillPayload(AT(20), {
    ...HOTEL, bill_print_session: true, bill_print_table: true, bill_print_steward: true,
  });
  const text = paper({ ...bill, title: 'TAX INVOICE' });
  const sessionAt = text.indexOf('Session');
  const itemsAt = text.indexOf('ITEM');
  const totalAt = text.indexOf('TOTAL');
  assert.ok(sessionAt > -1, 'the session never printed');
  assert.ok(sessionAt < itemsAt, 'the shop rows print below the dishes');
  assert.ok(sessionAt < totalAt);
});

test('none of it reaches a counter receipt that asked for nothing', () => {
  /* renderSale is shared. A shop that is not a restaurant must see no change. */
  const text = paper({
    title: 'RECEIPT',
    billNo: 'SB1D15-000100',
    items: [{ name: 'Sona Masoori Rice', qty: '5 kg', amount: 480 }],
    subTotal: 480,
    total: 480,
  });
  for (const gone of [/HSN/, /FSSAI/, /Session/]) {
    assert.ok(!gone.test(text), 'a plain receipt grew ' + gone);
  }
});
