'use strict';

const { isWalkIn } = require('../utils/walk-in');

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

/*
 * WHAT ELSE THE BILL PRINTS, and it is off unless the shop says otherwise.
 *
 * The owner sent a hotel restaurant's tax invoice carrying SAC codes, session,
 * steward, covers, total quantity, KOT numbers, room number, guest name and the
 * customer's own GST number - and then said what to do with it: "we have those
 * as optional. no need to incluede... based on settings we can add it. like
 * toggle or desgn in one place for printing receipt."
 *
 * So each one is a switch, and ABSENT MEANS OFF. That direction matters: 90
 * shops are printing today, and a default of on would put new rows on every
 * one of their bills the morning this deploys, which is exactly the "new
 * issues" he asked printing not to bring. A shop that wants the hotel bill
 * turns them on and gets it; a shop that says nothing keeps the bill it has.
 *
 * The settings form posts strings, so a stored 'false' is a real value. Only
 * an explicit true, in either shape, counts as on.
 */
function wants(branch, key) {
  const v = branch && branch[key];
  return v === true || v === 'true' || v === 1 || v === '1';
}

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
function itemLines(sale, branch) {
  const rows = Array.isArray(sale && sale.items) ? sale.items : [];
  return rows
    .filter((it) => it && !it.return && String(it.name || it.item_name || '').trim())
    .map((it) => {
      /* Three spellings because three writers exist: a priced online line sets
         both `quantity` and `item_quantity`, the till's own path sets
         `item_quantity`, and `qty` is what a hand-built row reaches for.
         Missing one prints a quantity of nothing beside a real price. */
      const qty = num(
        it.quantity != null ? it.quantity : it.item_quantity != null ? it.item_quantity : it.qty
      );
      /*
       * THE RATE, AND AN AMOUNT THAT AGREES WITH THE SUBTOTAL.
       *
       * The line used to print `it.total`, which for a tax-exclusive item is
       * the price WITH tax already in it. So a 200 rupee starter times two
       * printed as 420 while the subtotal underneath said 400, the tax rows
       * added 20 more, and the bill visibly did not add up. Owner: "paneer
       * starter 2 x 240 its wrong. it supposed to 200 means 200 x 2 then we add
       * tax. its exlusive properly need to be displayed".
       *
       * On a tax-exclusive invoice the line is what the goods cost and the tax
       * is stated separately below. Printing the tax-inclusive figure on the
       * line AND the tax again underneath shows it twice.
       */
      const rate = num(
        it.unit_price != null
          ? it.unit_price
          : it.item_base_price != null
            ? it.item_base_price
            : it.item_price
      );
      return {
        name: String(it.name || it.item_name).trim(),
        /*
         * The HSN or SAC code, when the shop asks for it.
         *
         * Read off the SALE, not the catalogue: a code corrected next month
         * must not change what a reprinted invoice says it charged. Empty on
         * every sale made before the field existed, and the column is dropped
         * entirely when no line carries one - so switching it on does not add a
         * blank stripe down a year of old bills.
         */
        hsn: wants(branch, 'bill_print_hsn') ? String(it.hsncode || '').trim() : '',
        rate: rate > 0 ? rate.toFixed(2) : '',
        qty: qtyText(qty),
        amount: Math.round(rate * qty * 100) / 100,
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

/*
 * A GSTIN is a shape, and the shape is the test.
 *
 * Two digits of state code, a ten-character PAN, one entity digit, the literal
 * Z, and a check character. The customer form already validates it on the way
 * in, so this is the second gate rather than the first - a number that reached
 * an old sale before the form checked anything, or arrived from a device that
 * did not, must not be printed on a tax invoice as though it had been checked.
 *
 * Printing a malformed GSTIN is worse than printing none. The customer files
 * the invoice, claims against it, and finds out months later that the claim
 * fails - and by then the bill is the only record and it looks right.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/*
 * WHO THE BILL IS MADE OUT TO, and for a business that is a legal question.
 *
 * Owner: "some customer ask bill with their GST details to claim or something.
 * we need provision for that. so customer can have field GST as optional. if
 * they given we can print and give."
 *
 * That is input tax credit. A registered business buying a meal for its staff
 * can reclaim the GST on it, but only against an invoice carrying ITS OWN
 * GSTIN - an invoice without one is not a document the claim can be made on,
 * and the customer finds out at filing time, not at the counter.
 *
 * NO SETTING GATES THIS. Every other optional row on the bill is a switch,
 * because a shop decides once whether it wants table numbers on its paper. A
 * GSTIN is not a shop decision: it is a customer who handed one over, once,
 * and asked for it on the bill. Making them wait while somebody finds a
 * settings page is the failure this is fixing. Given means printed.
 *
 * The COMPANY NAME goes above it, because the name on a claimable invoice has
 * to be the registered business and a customer record is often a person -
 * "Ramesh Kumar" against a company GSTIN is a defective invoice. Absent, the
 * customer name stands, which is right for a sole proprietor billing under
 * their own name.
 */
/*
 * The placeholder name, asked about in ONE place.
 *
 * This used to be a regex written here from memory, and it did not match the
 * name the sale repository actually writes - see utils/walk-in.js.
 */
function customerLines(sale) {
  const out = [];
  const name = String((sale && sale.customer_name) || '').trim();
  const phone = String((sale && sale.customer_phone) || '').trim();
  const company = String((sale && sale.customer_company_name) || '').trim();
  const gstin = String((sale && sale.customer_gst_number) || '')
    .trim()
    .toUpperCase();

  if (name && !isWalkIn(name)) out.push(name);
  if (phone && isDialable(phone)) out.push(phone);

  if (GSTIN.test(gstin)) {
    if (company) out.push(company);
    out.push('GSTIN: ' + gstin);
  }
  return out;
}

/*
 * WHICH SERVICE THIS BILL BELONGS TO: lunch, dinner, breakfast.
 *
 * The owner's reference bill prints "Session : Dinner", and a hotel uses it to
 * settle which service a table belongs to when a shift is handed over.
 *
 * Read from the dayparts the shop has ALREADY defined for its menu, rather
 * than from a new list of times. A shop that has said "Lunch is 12 to 3" once
 * should not have to say it again in different words for the bill, and two
 * lists that can disagree is how a bill comes to say Dinner while the kitchen
 * is serving lunch.
 *
 * Absent when the sale falls outside every daypart, or when the shop has
 * defined none. A guess would be worse than a blank.
 */
function sessionName(sale, branch) {
  const parts = Array.isArray(branch && branch.menu_dayparts) ? branch.menu_dayparts : [];
  if (!parts.length) return '';

  const when = sale && (sale.date || sale.created_at);
  const d = when ? new Date(when) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const minutes = d.getHours() * 60 + d.getMinutes();

  for (const part of parts) {
    const hours = Array.isArray(part && part.hours) ? part.hours : [];
    for (const span of hours) {
      const from = toMinutes(span && span.from);
      const to = toMinutes(span && span.to);
      if (from == null || to == null) continue;
      /* A span that ends before it starts crosses midnight - dinner running to
         one in the morning is a real service, not bad data. */
      const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
      if (inside) return String(part.name || '').trim();
    }
  }
  return '';
}

/** "19:30" as minutes past midnight, or null if it is not a time. */
function toMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The rows that are neither items nor totals: which table this is, how many
 * people are at it, who took the order, how many dishes in all.
 *
 * Every one of them is the restaurant talking to itself, which is why none of
 * them prints unless a shop asks. A cook needs the table number to send food
 * anywhere and the kitchen ticket carries all of it regardless; a customer
 * checking what they owe does not. Owner: "in the bill Table, order type,
 * covers umber of items not required. KOT fine. not in the bill."
 *
 * But a hotel restaurant bills differently - his own reference invoice prints
 * table, session, steward and covers - so this is a switch per row rather than
 * a decision taken for every shop at once.
 */
function extraRows(sale, branch, items) {
  const out = [];
  const add = (key, label, value) => {
    const text = String(value == null ? '' : value).trim();
    if (text && wants(branch, key)) out.push({ label, value: text });
  };

  add('bill_print_session', 'Session', sessionName(sale, branch));
  add('bill_print_table', 'Table', sale && sale.table_number);
  add('bill_print_dine_type', 'Order type', sale && sale.dine_type);
  /* Covers is a count, so an explicit zero is as absent as a blank: nobody
     eats at a table of nought. */
  const covers = num(sale && sale.person_count);
  add('bill_print_covers', 'Covers', covers > 0 ? String(covers) : '');
  /*
   * Steward, in the words his reference bill uses. The field is whoever the
   * sale was recorded against, which in a restaurant is the waiter who took
   * it.
   */
  add('bill_print_steward', 'Steward', sale && (sale.created_by || sale.user_name));

  /*
   * Total quantity is NOT here. It is a count of what was bought, so it belongs
   * beside the subtotal where a reader is already adding things up, not in the
   * header with the table number. Every printed bill that carries an item count
   * puts it there. See totalQty on the payload.
   */

  return out;
}

/**
 * How many dishes, as opposed to how many lines.
 *
 * Four parathas and a pulao is five, which is the number a hotel prints and the
 * number a guest counts.
 *
 * @returns {string} the count, or '' when the shop has not asked for it
 */
function totalQuantity(branch, items) {
  if (!wants(branch, 'bill_print_total_qty')) return '';
  const qty = (items || []).reduce(
    (sum, it) => sum + num(String(it.qty == null ? '' : it.qty).split(' ')[0]),
    0
  );
  return qty > 0 ? String(Math.round(qty * 1000) / 1000) : '';
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
  const items = itemLines(sale, branch);
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

    /*
     * FSSAI licence number.
     *
     * A food business in India is expected to show its FSSAI licence on the
     * invoice, and the owner's own reference bill from a hotel restaurant
     * prints it under the GSTIN. A switch rather than automatic, because a
     * shop that is not a food business has no licence to print and a blank
     * label reads as a fault.
     */
    fssai: wants(branch, 'bill_print_fssai') ? String(branch.branch_fssai_number || '').trim() : '',

    /* Not "RECEIPT" and not "TAX INVOICE". Nobody has paid yet, and calling it
       either would be a document this shop has not issued. */
    /* Beside the subtotal, not in the header - see totalQuantity. */
    totalQty: totalQuantity(branch, items),

    /*
     * WHAT THE SHOP ASKED TO SAY AT THE BOTTOM.
     *
     * `footer_print` is a box on the printing settings screen, a shop types its
     * own words into it, and the bill printed the generic thank-you instead.
     * The renderer had supported `sale.footer` all along; nothing ever set it.
     * One restaurant had "Thanking You / Visit Again" saved and handed over a
     * bill saying "Thank you, please visit again" every time.
     *
     * Trimmed and capped: free text on a document a customer keeps, and a paste
     * accident should cost a line rather than a roll of paper.
     */
    footer: String((branch && branch.footer_print) || '')
      .trim()
      .split(String.fromCharCode(10))
      .slice(0, 4)
      .map((line) => line.trim().slice(0, 64))
      .filter(Boolean)
      .join(String.fromCharCode(10)),

    title: 'BILL',
    billNo: String(sale.sales_id || '').trim(),
    date: stamp(sale.date || sale.created_at),
    customer: customerLines(sale),

    /*
     * Where the order came from. OFF by default now, and it used to be on.
     *
     * "From: Captain app" settles which device sent an order when something is
     * disputed, which is a question the kitchen and the shop ask and a customer
     * never does. Owner, reading one off the roll: "'From' not required in the
     * bill. only kot fine." The kitchen ticket still prints it unconditionally.
     */
    source: wants(branch, 'bill_print_source') ? orderSource(sale) : '',

    items,

    subTotal,
    taxes: taxRows(sale, branch),
    discount: num(sale.discount),
    roundOff: num(sale.round_off || sale.sales_round_off),
    total: num(sale.sales_total != null ? sale.sales_total : sale.total),

    /* No payments row: the whole point of this document is that it has not
       been paid. The counter prints the settled receipt afterwards. */
    /*
     * Session, table, order type, covers, steward, total quantity: every one a
     * switch, every one off unless the shop turned it on. See extraRows.
     *
     * Its OWN field, printed in the header before the dishes, because that is
     * where a bill is read: the owner's reference invoice puts Session, Table
     * and Steward beside the bill number at the top, and a waiter carrying it
     * needs the table before anything else. `extras` stays what it was - rows
     * a shop's own template added, which belong after the total.
     */
    serviceRows: extraRows(sale, branch, items),
    extras: [],
  };
}

/*
 * Exported because the SALE has to make the same judgement the BILL makes.
 * An order taken with no dialable number is recorded as the shop's walk-in
 * (see _walkInCustomer in the sale repository); if the two disagreed about
 * what counts as a number, a sale could be filed under a guest whose receipt
 * says there was no guest.
 */
module.exports = { buildBillPayload, isDialable };
