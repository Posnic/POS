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
 * There is no strike-through in ESC/POS. The HTML version struck out cancelled
 * lines; here the heading carries it - "Item Cancelled", "Items Cancelled",
 * "Order Cancelled" - and every line under such a heading is cancelled, which
 * is what those headings mean.
 */
const { Receipt } = require('./escpos-receipt');

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
 * @param {{paperWidth?: string}} options  '48' for 80mm, '32' for 58mm
 * @returns {Buffer}
 */
function renderKitchenTicket(ticket = {}, options = {}) {
  const r = new Receipt(String(options.paperWidth) === '32' ? '58' : '80');

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
    r.pair(name.toUpperCase(), qty, { bold: true });
    r.bold(false);
    const note = String((item && (item.description || item.item_description)) || '').trim();
    if (note) r.line('   ** ' + note + ' **');
  }
  if (!items.length) r.centre('(no items on this ticket)');

  r.rule();
  r.cut();
  return r.build();
}

module.exports = { renderKitchenTicket };
