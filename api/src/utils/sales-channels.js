'use strict';
/*
 * Where a sale came from, how it reaches the customer, and who owns the
 * customer.
 *
 * THREE QUESTIONS, NOT ONE FIELD.
 *
 * Every sale used to carry a single free-text `sale_method` holding one of
 * `Live-Order`, `Kiosk`, `Table-Order` or `Self-Order`. Those four answer
 * different questions at once and answer none of them completely:
 *
 *   - `Kiosk` says WHERE it was typed but nothing about whether the customer
 *     ate in or took it away.
 *   - `Self-Order` says the customer typed it themselves but not on what, and
 *     not whether it was a table QR code or somebody at home.
 *   - Nothing at all could express a Swiggy order, and the obvious fix -
 *     adding `Swiggy` as a fifth value - makes every new partner a code
 *     change and puts a 25% commission in the same field as a till sale that
 *     has none.
 *
 * So there are three fields:
 *
 *   channel          where the order was captured
 *   channel_partner  which outside business it came through, when one did
 *   fulfilment       how the customer gets it
 *
 * Oracle Simphony calls the first an "order channel" and defines it as "where
 * an order is placed, such as at a kiosk, drive thru window, inside a
 * restaurant, or via a delivery aggregator". Square calls it an order source,
 * Shopify a sales channel. The concept is settled; only the word varies.
 *
 * WHY MARKETPLACE IS ITS OWN CHANNEL AND NOT JUST A PARTNER NAME.
 *
 * Money. A 500 rupee order through an aggregator at 25% commission is 375
 * rupees to the shop. A 500 rupee till sale is 500. Put them in one field with
 * no notion of commission and every revenue report overstates what the shop
 * actually earned, and it overstates it more the more the shop grows on
 * aggregators. The channel type is what tells a report to look for a
 * commission at all.
 *
 * NO DATABASE IMPORTS. This is a vocabulary, so it can be read and tested on
 * its own, the way settings-groups.js is.
 */

/**
 * Where the order was captured.
 *
 * Split by who was holding the device, because that is what actually differs:
 * `pos`, `tableside` and `phone` are the shop's own staff; `kiosk`, `online`
 * and `whatsapp` are the customer; `marketplace` and `ecommerce` are another
 * system entirely.
 */
const CHANNEL = Object.freeze({
  /* Staff, at the till. */
  POS: 'pos',
  /* Staff, on a captain's phone at the table. Produces a kitchen ticket. */
  TABLESIDE: 'tableside',
  /* Staff, writing down a call. */
  PHONE: 'phone',
  /* The customer, on a machine standing in the shop. */
  KIOSK: 'kiosk',
  /* The customer, on their own device, through the shop's own storefront -
     a table QR code, a link in a message, a search listing. */
  ONLINE: 'online',
  /* The customer, by message. Its own channel rather than a flavour of
     `online` because nobody browses a menu: staff read it and key it in. */
  WHATSAPP: 'whatsapp',
  /* Somebody else's storefront, holding somebody else's customer, taking a
     commission. Swiggy, Zomato, ONDC. */
  MARKETPLACE: 'marketplace',
  /* The shop's own webshop, run on another platform. OpenCart, WooCommerce,
     Shopify. The customer is the shop's; only the software is outside. */
  ECOMMERCE: 'ecommerce',
});

const CHANNEL_VALUES = Object.freeze(Object.values(CHANNEL));

/**
 * How the customer gets it.
 *
 * Independent of the channel, which is the whole point: a QR code at a table
 * is `online` + `dine_in`, the same page from somebody's sofa is `online` +
 * `delivery`, and neither needs a channel of its own.
 */
const FULFILMENT = Object.freeze({
  DINE_IN: 'dine_in',
  TAKEAWAY: 'takeaway',
  PICKUP: 'pickup',
  DELIVERY: 'delivery',
});

const FULFILMENT_VALUES = Object.freeze(Object.values(FULFILMENT));

/* Channels that mean nothing without naming the outside business involved.
   A marketplace sale with no partner cannot be reconciled against a payout. */
const PARTNER_CHANNELS = Object.freeze([CHANNEL.MARKETPLACE, CHANNEL.ECOMMERCE]);

/*
 * Partners we know the name of.
 *
 * NOT a closed list. A shop can add its own, because the whole reason partner
 * is a separate field is that adding one must be data rather than a release.
 * These are here so the settings screen can offer the common ones already
 * spelled correctly, and so `swiggy`, `Swiggy` and `SWIGGY` cannot become
 * three partners in one report.
 */
const KNOWN_PARTNERS = Object.freeze({
  swiggy: { label: 'Swiggy', channel: CHANNEL.MARKETPLACE },
  zomato: { label: 'Zomato', channel: CHANNEL.MARKETPLACE },
  ondc: { label: 'ONDC', channel: CHANNEL.MARKETPLACE },
  magicpin: { label: 'magicpin', channel: CHANNEL.MARKETPLACE },
  opencart: { label: 'OpenCart', channel: CHANNEL.ECOMMERCE },
  woocommerce: { label: 'WooCommerce', channel: CHANNEL.ECOMMERCE },
  shopify: { label: 'Shopify', channel: CHANNEL.ECOMMERCE },
});

/**
 * The four values `sale_method` has actually held, and what they meant.
 *
 * Kept because they are written across live sales going back years, and a
 * report that reads only the new field would show a shop its history as
 * though it had no sales. Nothing writes these any more; everything READS
 * through `channelOf`.
 */
const LEGACY_SALE_METHOD = Object.freeze({
  'Live-Order': CHANNEL.POS,
  Kiosk: CHANNEL.KIOSK,
  'Table-Order': CHANNEL.TABLESIDE,
  'Self-Order': CHANNEL.ONLINE,
});

/* The other direction, so `sale_method` keeps being written truthfully while
   anything still reads it. */
const SALE_METHOD_OF = Object.freeze({
  [CHANNEL.POS]: 'Live-Order',
  [CHANNEL.KIOSK]: 'Kiosk',
  [CHANNEL.TABLESIDE]: 'Table-Order',
  [CHANNEL.ONLINE]: 'Self-Order',
  [CHANNEL.PHONE]: 'Phone-Order',
  [CHANNEL.WHATSAPP]: 'WhatsApp-Order',
  [CHANNEL.MARKETPLACE]: 'Marketplace-Order',
  [CHANNEL.ECOMMERCE]: 'Ecommerce-Order',
});

/*
 * The channels where the customer served themselves.
 *
 * This is the set the self-service report counts, and it is TWO things: a
 * machine in the shop and a customer's own phone. Naming that report after
 * either one alone loses the other, which has happened.
 */
const SELF_SERVICE_CHANNELS = Object.freeze([CHANNEL.KIOSK, CHANNEL.ONLINE]);

/** A known channel, or null. Never a guess. */
function normalizeChannel(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return CHANNEL_VALUES.includes(v) ? v : null;
}

/** A known fulfilment type, or null. */
function normalizeFulfilment(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return FULFILMENT_VALUES.includes(v) ? v : null;
}

/**
 * A partner id: lowercase, no spaces, stable.
 *
 * "Swiggy", "swiggy " and "SWIGGY" are one partner. Without this they are
 * three rows in a report and none of them is the real total.
 */
function normalizePartner(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return v || null;
}

/** Does this channel need a partner named before it means anything? */
function requiresPartner(channel) {
  return PARTNER_CHANNELS.includes(normalizeChannel(channel));
}

/**
 * The channel a sale belongs to, new field or old.
 *
 * ONE READER, so that history and today answer the same way. Every report
 * goes through this rather than testing `sale_method` itself, because the day
 * one of them forgets is the day a channel quietly stops being counted.
 */
function channelOf(sale) {
  if (!sale) return null;
  const direct = normalizeChannel(sale.channel);
  if (direct) return direct;
  return LEGACY_SALE_METHOD[String(sale.sale_method || '').trim()] || null;
}

/** What to write into `sale_method` for a channel, so old readers stay true. */
function saleMethodFor(channel) {
  return SALE_METHOD_OF[normalizeChannel(channel)] || null;
}

/**
 * A Mongo filter matching sales in these channels, old documents included.
 *
 * The `$or` is not defensive clutter: every sale written before this existed
 * carries only `sale_method`, and there are years of them. A filter on
 * `channel` alone would show a shop an empty report and no error.
 */
function channelFilter(channels) {
  const wanted = (Array.isArray(channels) ? channels : [channels])
    .map(normalizeChannel)
    .filter(Boolean);
  if (!wanted.length) return {};

  const legacy = Object.entries(LEGACY_SALE_METHOD)
    .filter(([, ch]) => wanted.includes(ch))
    .map(([method]) => method);

  const clauses = [{ channel: { $in: wanted } }];
  if (legacy.length) {
    /* Only where `channel` is absent, so a sale that has been given a channel
       is never counted by its legacy value as well. */
    clauses.push({ channel: { $in: [null, ''] }, sale_method: { $in: legacy } });
  }
  return { $or: clauses };
}

/**
 * What a sale should record about where it came from.
 *
 * Returns the three fields plus the legacy `sale_method`, so a caller writes
 * one object and cannot leave the old field disagreeing with the new ones.
 *
 * @param {object} input
 * @param {string} input.channel
 * @param {string} [input.partner]
 * @param {string} [input.fulfilment]
 * @param {string} [input.sale_method]  a legacy value, when that is all a
 *                                      caller has
 */
function describeSale(input = {}) {
  let channel = normalizeChannel(input.channel);

  /* A caller that still speaks the old language is understood rather than
     recorded as nothing. */
  if (!channel && input.sale_method) {
    channel = LEGACY_SALE_METHOD[String(input.sale_method).trim()] || null;
  }

  const partner = requiresPartner(channel) ? normalizePartner(input.partner) : null;
  const fulfilment = normalizeFulfilment(input.fulfilment);

  return {
    channel,
    channel_partner: partner,
    fulfilment,
    /* Written for as long as anything reads it. Falls back to whatever the
       caller sent so an unrecognised legacy value is preserved rather than
       replaced with null. */
    sale_method: saleMethodFor(channel) || input.sale_method || null,
  };
}

/**
 * What the shop actually keeps, after an aggregator takes its cut.
 *
 * @param {number} total     the order total
 * @param {number} percent   the partner's commission rate
 * @returns {{commission: number, net: number}}
 */
function commissionOn(total, percent) {
  const amount = Number(total) || 0;
  const rate = Number(percent) || 0;
  if (!(rate > 0)) return { commission: 0, net: Math.round(amount * 100) / 100 };
  const commission = Math.round(amount * (rate / 100) * 100) / 100;
  return { commission, net: Math.round((amount - commission) * 100) / 100 };
}

/* ------------------------------------------------------- delivery and fees
 *
 * What a customer pays on top of the food.
 *
 * THE AXIS IS FULFILMENT, NOT CHANNEL. This is the part that is easy to get
 * wrong and expensive to change later.
 *
 * A delivery fee is not a property of "online". The same online storefront
 * charges for delivery, charges nothing for pickup, and charges nothing again
 * when the customer is sitting at a table. Put the fee on the channel and a
 * shop taking dine-in QR orders starts adding a delivery fee to food carried
 * six feet.
 *
 * It is not a property of the fulfilment alone either. `delivery` through the
 * shop's own storefront is the shop's own rider and the shop's own fee;
 * `delivery` through an aggregator is their rider, their fee, charged to the
 * customer by them - the shop must add nothing or the customer is billed
 * twice, once by each of us.
 *
 * So charges live at the intersection: a shop-wide table keyed by fulfilment,
 * and any partner may override it. A marketplace partner overriding delivery
 * to zero is the normal case and the reason the override exists.
 *
 * THREE NUMBERS, which is what every system a customer has used already has:
 *
 *   fee          flat charge for this fulfilment
 *   free_above   order value at which the fee is waived, 0 for never
 *   min_order    below which this fulfilment is refused, 0 for no minimum
 *
 * Deliberately not distance bands. They need an address, a map and a
 * geocoding bill, and a shop that needs them has outgrown a flat fee anyway.
 */

/** One fulfilment's charges, cleaned up. */
function normalizeCharge(input) {
  const money = (v) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);
  return {
    fee: money(input && input.fee),
    free_above: money(input && input.free_above),
    min_order: money(input && input.min_order),
  };
}

/** The whole table, one entry per fulfilment type the shop offers. */
function normalizeCharges(input) {
  const out = {};
  for (const type of FULFILMENT_VALUES) {
    out[type] = normalizeCharge((input && input[type]) || {});
  }
  return out;
}

/**
 * What this order owes on top of the food, and whether it may be placed.
 *
 * @param {string} fulfilment   dine_in, takeaway, pickup, delivery
 * @param {number} subtotal     the food, at whatever price the customer sees
 * @param {object} charges      the shop's table
 * @param {object} [override]   a partner's table, where one exists
 * @returns {{fee: number, waived: boolean, allowed: boolean, minimum: number}}
 */
function chargesFor(fulfilment, subtotal, charges, override) {
  const type = normalizeFulfilment(fulfilment);
  const amount = Number(subtotal) || 0;

  /*
   * A partner's table replaces the shop's for that fulfilment, rather than
   * merging into it. Merging would mean a partner could not set a fee of zero
   * without it reading as "not configured, use the shop's" - and zero is
   * exactly what an aggregator needs to say.
   */
  const table = override && override[type] ? normalizeCharges(override) : normalizeCharges(charges);
  const rule = table[type] || normalizeCharge({});

  if (!type) return { fee: 0, waived: false, allowed: true, minimum: 0 };

  /* Refused before anything is charged: a minimum the order does not meet
     means this fulfilment is not on offer, not that it costs more. */
  if (rule.min_order > 0 && amount < rule.min_order) {
    return { fee: rule.fee, waived: false, allowed: false, minimum: rule.min_order };
  }

  const waived = rule.free_above > 0 && amount >= rule.free_above;
  return {
    fee: waived ? 0 : rule.fee,
    waived,
    allowed: true,
    minimum: rule.min_order,
  };
}

/**
 * What to tell a customer who is short of a free-delivery threshold.
 *
 * "Add 120 more for free delivery" is worth more to a shop than the 40 it
 * would have charged, and every system the customer has used says it.
 * Returns 0 when there is nothing to say.
 */
function amountToFreeDelivery(fulfilment, subtotal, charges, override) {
  const type = normalizeFulfilment(fulfilment);
  if (!type) return 0;
  const table = override && override[type] ? normalizeCharges(override) : normalizeCharges(charges);
  const rule = table[type];
  if (!rule || !(rule.free_above > 0) || !(rule.fee > 0)) return 0;
  const short = rule.free_above - (Number(subtotal) || 0);
  return short > 0 ? Math.round(short * 100) / 100 : 0;
}

module.exports = {
  CHANNEL,
  CHANNEL_VALUES,
  FULFILMENT,
  FULFILMENT_VALUES,
  KNOWN_PARTNERS,
  LEGACY_SALE_METHOD,
  PARTNER_CHANNELS,
  SALE_METHOD_OF,
  SELF_SERVICE_CHANNELS,
  channelFilter,
  channelOf,
  amountToFreeDelivery,
  chargesFor,
  commissionOn,
  normalizeCharge,
  normalizeCharges,
  describeSale,
  normalizeChannel,
  normalizeFulfilment,
  normalizePartner,
  requiresPartner,
  saleMethodFor,
};
