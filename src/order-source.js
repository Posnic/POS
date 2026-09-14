'use strict';

/*
 * Where an order came from, in words a cook or a customer can read.
 *
 * WHY IT IS ITS OWN FILE
 *
 * The kitchen ticket log has said this for a while, on screen. The owner now
 * wants it on the PAPER, on the kitchen ticket and on the bill: "when order
 * sent kitch show one field order source... captain source: pos source:
 * customer swiggy or online order or qr those i want. in the bill also
 * specify."
 *
 * The ticket is drawn in the desktop shell and the bill payload is built in the
 * API, and those two cannot share a module instance: the API ships OUTSIDE the
 * asar archive as extraResources/server.js while this file lives inside it, so
 * a require would resolve to two different copies or to nothing. The same
 * reason kot-notify.js gives for using `process` as its bus.
 *
 * So the table is written twice, here and in api/src/utils/order-source.js, and
 * a test compares them character by character. Two copies that are checked are
 * safer than one copy that cannot be reached.
 *
 * WHAT IT READS
 *
 * `channel` first, `sale_method` second. Years of sales predate the channel
 * field and carry only the old value, and reading the new one alone would make
 * every one of those rows say "Till" - quietly, and wrongly, which is how a
 * shop's history goes missing at a version boundary. Same rule
 * utils/sales-channels.js follows on the server, for the same reason.
 *
 * A MARKETPLACE ORDER IS NAMED, not called "Marketplace". A shop taking orders
 * from three aggregators needs to read "Swiggy" off the ticket, because that is
 * who is standing at the counter asking for it.
 */

/* The channel, as a cook reads it. */
const WHERE = {
  tableside: 'Captain app',
  pos: 'Till',
  kiosk: 'Kiosk',
  online: 'Customer phone',
  phone: 'Phone order',
  whatsapp: 'WhatsApp',
  marketplace: 'Marketplace',
  ecommerce: 'Webshop',
};

/* Sales written before `channel` existed. There are years of them. */
const LEGACY = {
  'Table-Order': 'Captain app',
  'Self-Order': 'Customer phone',
  'Live-Order': 'Customer phone',
  Kiosk: 'Kiosk',
};

/*
 * A partner id is stored normalised - "Swiggy", "swiggy " and "SWIGGY" are one
 * partner - so it has to be made presentable again before it is printed.
 * Underscores were spaces when somebody typed the name.
 */
function partnerName(id) {
  const raw = String(id == null ? '' : id).replace(/[_-]+/g, ' ').trim();
  if (!raw) return '';
  return raw
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @param {object} sale
 * @returns {string} '' when there is genuinely nothing to say
 */
function orderSource(sale) {
  const method = String((sale && sale.sale_method) || '').trim();
  const channel = String((sale && sale.channel) || '').trim().toLowerCase();

  /* The aggregator's own name beats the word "Marketplace" every time. */
  const partner = partnerName(sale && (sale.channel_partner || sale.partner));
  const named = partner && (channel === 'marketplace' || channel === 'ecommerce' || !channel);

  /* Unknown is said as unknown. A guess reads as fact on a ticket somebody is
     using to work out where an order came from. */
  const where = named ? partner : (WHERE[channel] || LEGACY[method] || (method ? method : 'Till'));

  const who = String((sale && (sale.user_name || sale.userName)) || '').trim();
  return who ? `${where} (${who})` : where;
}

module.exports = { orderSource, partnerName, WHERE, LEGACY };
