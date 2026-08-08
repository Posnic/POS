'use strict';
/*
 * The guard for endpoints a device reaches without logging in.
 *
 * A kitchen display, a table tablet and the phone ordering app all call the API
 * without a browser session. Those routes ran behind optionalProtect alone,
 * which authenticates when it can and never refuses - so a caller who simply
 * did not authenticate carried on as anonymous, and the handlers, having no
 * session to read the branch from, took it from the request body instead.
 *
 * Anyone able to reach the API could therefore name any branch of any shop and
 * read its live orders, its history, its catalogue and its receipts.
 * updateOrder accepts items, totals and discounts, so an anonymous request
 * could also rewrite what another shop's order said it cost.
 *
 * Kept in its own file, with no service or model imports, for two reasons: an
 * authentication guard should not be reachable only by loading the whole
 * validation layer, and a security rule ought to be testable without standing
 * up a database. Requiring it must never open a connection.
 */

const crypto = require('crypto');
const { currentSecret } = require('../db/tenant-context');

/*
 * Read inside the function, not at module load.
 *
 * main.js sets this while starting up, so a const evaluated at require time
 * would capture nothing - the mistake that has already caused three outages
 * here. It is generated per installation; it was once a constant in the source,
 * which meant every Posnic in the world accepted the same one.
 */
function kioskApiKey() {
  /* Per shop. One process serving several shops must not accept a kiosk key
     issued to a different customer's installation. */
  return currentSecret('KIOSK_API_KEY', process.env.KIOSK_API_KEY) || null;
}

/*
 * Compared in constant time.
 *
 * A plain !== leaks, through how long it takes to fail, roughly how many
 * leading characters were right. That is a slow way to guess a key, but it is a
 * way, and these endpoints face the shop floor network.
 */
function keyMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, and returning early on the
  // length would leak it. Compare b with itself to spend the same time, then
  // refuse.
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function refuse(res, ERROR_MESSAGES) {
  return res.status(401).json({
    type: 'error',
    status: false,
    message: (ERROR_MESSAGES && ERROR_MESSAGES.UNAUTHORIZED) || 'Unauthorized',
    data: null,
  });
}

/**
 * Only a device holding this installation's kiosk key.
 *
 * No key configured means these routes stay shut. Failing open would expose the
 * kiosk and kitchen endpoints on any install that started without one, which is
 * most of them.
 */
function makeEnsureKioskKey(ERROR_MESSAGES) {
  return function ensureKioskKey(req, res, next) {
    const supplied = req.headers['kioskkey'] || req.headers['KIOSKKEY'];
    const expected = kioskApiKey();

    if (!expected || !keyMatches(supplied, expected)) return refuse(res, ERROR_MESSAGES);
    return next();
  };
}

/**
 * A signed-in user, or a device holding the kiosk key. Nobody else.
 *
 * Mount after optionalProtect: a real session passes exactly as before - which
 * is every caller inside the app - and only the anonymous case has to prove it
 * is the shop's own equipment.
 */
function makeProtectOrKioskKey(ERROR_MESSAGES) {
  const ensure = makeEnsureKioskKey(ERROR_MESSAGES);
  return function protectOrKioskKey(req, res, next) {
    if (req.user) return next();
    return ensure(req, res, next);
  };
}

module.exports = {
  kioskApiKey,
  keyMatches,
  makeEnsureKioskKey,
  makeProtectOrKioskKey,
  ensureKioskKey: makeEnsureKioskKey(null),
  protectOrKioskKey: makeProtectOrKioskKey(null),
};
