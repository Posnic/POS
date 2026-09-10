'use strict';
/*
 * Hotels, offices and anywhere else that is not the restaurant's own floor.
 *
 * A restaurant with nine tables puts a QR code on each. The hotel down the
 * road puts one in every room, and those orders arrive through the same
 * storefront - but they are not the same orders. The hotel expects a cut, the
 * customer is charged more to cover it, and at the end of the month somebody
 * has to work out what is owed.
 *
 * THE VENUE IS IN THE URL, NOT INFERRED FROM THE CODE.
 *
 *   /order/AZ100/table/5          the restaurant's own table five
 *   /order/AZ100/venue/RC/123     Royal Club Hotel, room 123
 *
 * The first design read the venue out of a prefix on the code - `RCroom123`
 * meant Royal Club because it started with `RC`. It worked, and it carried a
 * quiet failure: a restaurant that named a table `RC1` would have started
 * billing that table's orders to the hotel, and nobody would notice until an
 * invoice was too big. It needed a conflict checker, a longest-prefix rule,
 * and a warning on the settings screen, all to defend a guess.
 *
 * Naming the venue in the path removes the guess. There is nothing to
 * collide, nothing to check, and a printed QR code says plainly which
 * building it belongs to.
 *
 * MARKUP AND COMMISSION ARE TWO NUMBERS, NOT ONE.
 *
 * The obvious model gives a venue one percentage and uses it for both: mark
 * the menu up 10%, pay the hotel 10%. That is one common deal and not the only
 * one. A restaurant may mark up 12 and pay 10, keeping two points for the
 * trouble; it may mark up nothing and pay 8 out of its own margin to win the
 * tie-up; it may pass 15 straight through because the hotel insists. Folding
 * them into one field decides that negotiation on the restaurant's behalf.
 *
 * So `price_adjust_percent` is what the CUSTOMER pays on top, and
 * `commission_percent` is what the RESTAURANT owes the venue. Either can be
 * zero, and they are unrelated by design.
 *
 * NO DATABASE IMPORTS. Vocabulary and arithmetic, testable on its own.
 */

/** Percentages, clamped to something a shop could actually mean. */
function clampPercent(value, min = -100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(100, Math.round(n * 100) / 100));
}

/** A venue code as it appears in a URL: short, and safe in a path. */
function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Everything a venue needs, normalised. */
function normalizeVenue(input) {
  const code = normalizeCode(input && (input.code || input.id));
  const name = String((input && input.name) || '').trim();
  if (!code || !name) return null;

  return {
    /* The code IS the identity: it is what a printed QR carries, so it has to
       survive a rename of the hotel. */
    code,
    name,
    price_adjust_percent: clampPercent(input.price_adjust_percent),
    /* Owing a venue less than nothing is not a deal, it is a typo. */
    commission_percent: clampPercent(input.commission_percent, 0),
    enabled: input.enabled !== false,
  };
}

/** A shop's venues, without duplicates or half-filled rows. */
function normalizeVenues(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const venue = normalizeVenue(raw);
    if (!venue || seen.has(venue.code)) continue;
    seen.add(venue.code);
    out.push(venue);
  }
  return out;
}

/**
 * The venue a URL names, or null.
 *
 * An exact match on the code, not a prefix: the path said which venue this is,
 * so there is nothing to work out.
 */
function venueByCode(code, venues) {
  const wanted = normalizeCode(code);
  if (!wanted) return null;
  return normalizeVenues(venues).find((v) => v.enabled && v.code === wanted) || null;
}

/**
 * Where an order is coming from, from the parts of the URL.
 *
 * @param {object} parts
 * @param {string} [parts.table]  the shop's own table, from /table/5
 * @param {string} [parts.venue]  a venue code, from /venue/RC/123
 * @param {string} [parts.unit]   the room or desk within it
 * @param {Array}  venues
 * @returns {{venue: object|null, label: string, code: string}}
 */
function resolveServicePoint(parts = {}, venues = []) {
  const table = String(parts.table || '').trim();
  const unit = String(parts.unit || '').trim();
  const venue = venueByCode(parts.venue, venues);

  if (venue) {
    /* The ticket is read by a person, so it says the hotel and the room
       rather than a code neither building says out loud. */
    return {
      venue,
      unit,
      label: unit ? `${venue.name} - ${unit}` : venue.name,
      code: unit ? `${venue.code}/${unit}` : venue.code,
    };
  }

  /*
   * A venue code nobody recognises falls back to the shop's own floor rather
   * than being honoured as a discount nobody agreed. If the settings have
   * changed since a code was printed, the safe direction is house prices and
   * no commission - a customer charged the normal price is a bad QR code, a
   * customer charged a phantom markup is a complaint.
   */
  return { venue: null, unit: '', label: table, code: table };
}

/**
 * The price a customer at this service point is shown, and pays.
 *
 * Rounded to whole currency, because a menu reading 308.00 beside a house
 * price of 280 looks like a mistake and invites an argument at the table.
 */
function priceFor(basePrice, venue) {
  const base = Number(basePrice) || 0;
  const percent = venue ? Number(venue.price_adjust_percent) || 0 : 0;
  if (!percent) return Math.round(base * 100) / 100;
  return Math.round(base * (1 + percent / 100));
}

/**
 * What the restaurant owes the venue on an order.
 *
 * Taken on the amount the customer actually paid, which is the marked-up
 * total. That is the number printed on the bill and the only one both sides
 * can check; a commission computed on a house price the hotel never sees is a
 * commission nobody can verify.
 */
function commissionFor(total, venue) {
  const amount = Number(total) || 0;
  const percent = venue ? Number(venue.commission_percent) || 0 : 0;
  if (!(percent > 0)) return 0;
  return Math.round(amount * (percent / 100) * 100) / 100;
}

module.exports = {
  clampPercent,
  commissionFor,
  normalizeCode,
  normalizeVenue,
  normalizeVenues,
  priceFor,
  resolveServicePoint,
  venueByCode,
};
