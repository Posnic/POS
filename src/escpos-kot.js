'use strict';
/*
 * The kitchen ticket, as bytes.
 *
 * WHY THIS EXISTS
 *
 * The ticket used to be built as HTML, loaded into a hidden BrowserWindow,
 * rendered, converted to PDF and handed to SumatraPDF. Measured end to end on
 * a real till, an order took 2,080 ms to reach paper, and 1,114 ms of that was
 * this one step. A receipt covering the same ground, rendered straight to
 * ESC/POS, took 124 ms.
 *
 * Owner: "prints are very slow. as soon receive order it needs to print...
 * every seconds counts here."
 *
 * So the kitchen ticket is built the way the receipt already is: bytes, sent
 * to the roll. No window, no PDF, no second program. The HTML path stays for
 * anything that is not a thermal roll and as the fallback if this refuses.
 *
 * WHAT THE PAPER SAYS, AND WHY IT IS LAID OUT THIS WAY
 *
 * A cook reads a ticket in this order: what kind of sheet is this, which table,
 * what do I make. So that is the order it prints, and the first two are the
 * only things set large. The serial number is what the pass calls out, so it
 * keeps the biggest type on the sheet.
 *
 * THE CANCELLED LINE IS CROSSED OUT, which is the one thing this path lost
 * when it stopped being HTML. The old page had `text-decoration: line-through`
 * and that was the end of it; ESC/POS has no such command, so for a while the
 * heading carried the whole meaning - "Item Cancelled" at the top, and every
 * line under it cancelled. A cook reading a spike of tickets sideways does not
 * get that. Receipt.strikeLine draws the rule by hand, in 109 bytes, and the
 * heading stays because two signals are better than one.
 */
const { Receipt } = require('./escpos-receipt');

/*
 * HOW HOT, ON THE PAPER.
 *
 * The customer taps one, two or three chillies; the ticket says the word and
 * the count. ASCII, because every character on this path goes through
 * Receipt.text -> ascii() -> latin1, and an emoji arrives as a question mark
 * or as nothing at all. The count is not decoration: a cook who does not read
 * English still reads 2 of 3.
 *
 * WHY THIS IS NOT IMPORTED. The same three words live in
 * api/src/utils/spice-level.js, which is where the server decides them, and
 * the desktop shell cannot require across into the API package. Rather than a
 * byte-copy pipeline for eight lines, tests/the-ticket-says-how-hot.test.js
 * runs BOTH implementations over every level and refuses a commit where they
 * disagree - so the drift this would otherwise invite fails a build instead of
 * misreporting somebody's food.
 */
const SPICE_WORDS = { 1: 'MILD', 2: 'MEDIUM', 3: 'SPICY' };

/** 'SPICE: MEDIUM (2 of 3)', or '' when nobody asked. */
function spiceLine(value) {
  /* A number or the text of one. Number(true) is 1, and a stray boolean must
     not print MILD on a ticket; see levelOf in api/src/utils/spice-level.js. */
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const n = Number(value);
  if (!SPICE_WORDS[n]) return '';
  return 'SPICE: ' + SPICE_WORDS[n] + ' (' + n + ' of 3)';
}

/** A quantity the way a kitchen reads it: x2, never 2x or "qty 2". */
function qtyText(value) {
  const n = Number(value);
  return 'x' + (Number.isFinite(n) && n > 0 ? n : 1);
}

/**
 * One kitchen ticket.
 *
 * @param {object} ticket
 *   title        what kind of sheet: New Order, Additional Order, Item Cancelled...
 *   number       the daily serial the pass calls out
 *   dateText     already formatted, because the caller owns the shop's format
 *   tableNo      may be empty for a takeaway
 *   personCount  may be empty
 *   dineType     Dine in, Take away, and whatever else the shop saved
 *   saleId       the display id, already prefixed
 *   deliverTo    delivery address, when there is one
 *   note         what the customer said about the whole order
 *   items        [{ name, quantity, description }]
 *   source       where the order came from, already worded; '' prints nothing
 *   cancelled    true when this sheet is a cancellation, so the lines are struck
 * @param {{paperWidth?: string, strikeCancelled?: boolean}} options
 *   paperWidth      '48' for 80mm, '32' for 58mm
 *   strikeCancelled false for a printer that will not overprint; see strikeLine
 * @returns {Buffer}
 */
function renderKitchenTicket(ticket = {}, options = {}) {
  const r = new Receipt(String(options.paperWidth) === '32' ? '58' : '80');
  /* Absent means on. A shop only ever sets this to turn it off, and that is
     for a printer that will not overprint - see Receipt.strikeLine. */
  const strikeThem = Boolean(ticket.cancelled) && options.strikeCancelled !== false;

  /* What kind of sheet. Double height, because a cook glancing at a spike of
     tickets is looking for exactly this word. */
  if (ticket.title) r.centre(String(ticket.title), { bold: true, size: 1 });

  /* The serial, in the biggest type the roll has. This is what the pass
     shouts and what the cook matches an amendment against. */
  if (ticket.number !== undefined && ticket.number !== null && String(ticket.number) !== '') {
    r.centre('#' + String(ticket.number), { bold: true, size: 2 });
  }

  if (ticket.dateText) r.centre(String(ticket.dateText));
  if (ticket.dineType) r.centre(String(ticket.dineType), { bold: true });
  if (ticket.saleId) r.centre(String(ticket.saleId));

  /*
   * Where it came from.
   *
   * Owner: "when order sent kitch show one field order source". The log has
   * said this on screen for a while; a cook holding the paper could not see it,
   * and on a floor with handsets, a QR code and an aggregator, "who sent this"
   * is the question a disputed ticket turns on.
   *
   * Under the bill number rather than at the top, because the top belongs to
   * the three things a cook reads first - what kind of sheet, which table, what
   * to make - and this is the fourth. Bold, because on a spike of tickets it is
   * what the eye scans for when something is wrong.
   */
  if (ticket.source) r.centre('From: ' + String(ticket.source), { bold: true });

  /*
   * The table, which used to print at the size of the date sharing a line with
   * the pax count inside square brackets. Owner: "with table number clearly
   * mentioned." A takeaway says it has no table rather than printing an empty
   * pair of brackets.
   */
  if (ticket.tableNo) r.centre('TABLE ' + String(ticket.tableNo), { bold: true, size: 1 });
  else r.centre('NO TABLE', { bold: true });

  const pax = ticket.personCount;
  if (pax !== '' && pax !== null && pax !== undefined) r.centre('Pax: ' + String(pax));

  if (ticket.deliverTo) {
    r.rule();
    r.centre('DELIVER TO', { bold: true });
    r.line(String(ticket.deliverTo));
  }
  if (ticket.note) {
    r.rule();
    r.centre('NOTE', { bold: true });
    r.line(String(ticket.note));
  }

  r.rule();

  /*
   * The food. The name is what matters and gets the width; the quantity sits
   * hard right so a column of them can be read down without reading the names.
   * A long dish name wraps rather than being cut, because half a dish name is
   * a wrong dish.
   */
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  for (const item of items) {
    const name = String((item && (item.name || item.item_name)) || '').trim() || 'Item';
    const qty = qtyText(item && (item.quantity !== undefined ? item.quantity : item.item_quantity));
    r.bold(true);
    r.pair(name.toUpperCase(), qty, { bold: true, strike: strikeThem });
    r.bold(false);
    /*
     * The level BEFORE the note, and on its own line rather than folded into
     * it. A level is the same three words on every ticket in every language;
     * the note is whatever somebody typed. Printing them as one line would
     * make the reliable half as hard to trust as the unreliable half.
     */
    /*
     * THE PRICE, WHERE THE PRICE IS THE SPECIFICATION.
     *
     * Owner: "lets customer wants to have fish for rs500 so that kitchen will
     * prepare according to that."
     *
     * Five hundred rupees of fish is a particular fish, and the kitchen cannot
     * pick one from the name alone. Same for anything a waiter typed in at the
     * table. The till marks only those lines - see priced_at_table - so an
     * ordinary biryani still prints without money on it. A ticket with a price
     * on every line is one where the line that matters stops standing out.
     *
     * "Rs" rather than the rupee sign: a kitchen printer that lacks the glyph
     * prints a box or a random character, and a wrong number on a ticket is
     * worse than a plain one.
     */
    const worth = item && item.priced_at_table;
    if (worth !== undefined && worth !== null && Number(worth) > 0) {
      const amount = Number(worth);
      const shown = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
      /* Bold like the name, because on these lines the amount IS part of what
         to cook. r.line takes no options - bold is set around it, the way the
         name line above does it. */
      r.bold(true);
      r.line('   Rs ' + shown);
      r.bold(false);
    }

    const hot = spiceLine(item && (item.spice_level != null ? item.spice_level : item.spice));
    if (hot) r.line('   ' + hot);
    const note = String((item && (item.description || item.item_description)) || '').trim();
    if (note) r.line('   ** ' + note + ' **');
  }
  if (!items.length) r.centre('(no items on this ticket)');

  /*
   * HOW MANY PLATES ARE ON THIS TICKET.
   *
   * Owner: "KOT total items also print and voice read please. so that chef's
   * can hear well."
   *
   * A cook counts what they have plated against what the ticket asked for, and
   * a long ticket is exactly where one line gets missed. The number at the foot
   * is what makes that check possible without re-reading every line.
   *
   * PLATES, not lines: one biryani and two naan is three things to cook and two
   * lines above. A kitchen works in plates, and so does the voice that reads
   * this out - see src/kitchen-call.js, which counts it the same way.
   */
  if (items.length) {
    const plates = items.reduce((sum, item) => {
      const qty = Number(
        (item && (item.quantity !== undefined ? item.quantity : item.item_quantity)) || 0
      );
      return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0);

    if (plates > 0) {
      r.rule();
      r.bold(true);
      r.pair('TOTAL ITEMS', String(plates), { bold: true });
      r.bold(false);
    }
  }

  r.rule();
  r.cut();
  return r.build();
}

module.exports = { renderKitchenTicket, spiceLine };
