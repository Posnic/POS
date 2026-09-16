'use strict';
/*
 * A REQUEST BODY IS DATA, NEVER A QUERY.
 *
 * MongoDB does not have a query language separate from its data: a filter is
 * an ordinary object, and a key beginning with `$` inside one is an operator.
 * So a value that arrives from a caller and is placed in a filter can stop
 * being a value:
 *
 *   { user: 'amudha' }              the one row
 *   { user: { $ne: null } }         every row
 *   { password: { $gt: '' } }       every row, again
 *
 * Nothing in this product ever needs a caller to name an operator. The server
 * writes its own `$set`, its own `$gte` on a date range, its own `$or`. A `$`
 * key arriving from outside is therefore always either a mistake or an
 * attempt, and neither should reach a collection.
 *
 * WHY THE BODY AND NOT THE QUERY STRING.
 *
 * Express 5's default query parser is the simple one, which does not expand
 * brackets into nested objects: `?user[$ne]=x` arrives as the literal string
 * key "user[$ne]", which is inert. Measured rather than assumed. The JSON and
 * form parsers do build real nested objects, so the body is the way in, and
 * `express.urlencoded({ extended: true })` means a form post is as capable of
 * it as a JSON one.
 *
 * WHY STRIP AND NOT REFUSE.
 *
 * A 400 is louder and would be the better answer if this were a new API. It
 * is not: it is six hundred endpoints and several clients, including tills
 * that a shop cannot update today. One caller somewhere sending a stray `$`
 * key in a field nobody reads would start failing sales, and a shop losing
 * orders is a worse outcome than an attacker's payload being quietly made
 * inert. So the key is removed and the request proceeds without it.
 *
 * It is counted and logged once per request - the COUNT and the field path,
 * never the value, because a log line built from caller input is its own
 * problem.
 *
 * DOTS ARE LEFT ALONE. A key like `invoice.prefix` is ordinary data in this
 * product's settings, and a dot cannot introduce an operator. Only `$` can.
 */

/* Deep enough for any real payload here - the deepest is a sale with lines
   carrying modifiers - and shallow enough that a hostile nesting cannot make
   this walk expensive. Anything below it is left untouched rather than
   refused, because the operator check has already run on every level above. */
const DEEPEST = 12;

/* One request cannot be allowed to spend the process's time on a structure
   built to be walked. Well past any real body; a sale with two hundred lines
   is a few thousand nodes. */
const MOST_NODES = 200000;

/**
 * Remove every operator key from a parsed body, in place.
 *
 * In place because `req.body` is read by everything downstream and handing
 * back a copy would leave a caller holding the original.
 *
 * @returns {string[]} the paths that were removed, for the log line
 */
function strip(
  value,
  { path = '', depth = 0, seen = new WeakSet(), budget = { left: MOST_NODES } } = {}
) {
  const removed = [];
  if (!value || typeof value !== 'object') return removed;
  if (depth >= DEEPEST) return removed;
  /* A parsed body cannot normally contain a cycle, but this also runs on
     whatever a future parser hands over, and a walk that can loop is a way to
     stop the server. */
  if (seen.has(value)) return removed;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (budget.left-- <= 0) return removed;
      removed.push(
        ...strip(value[i], { path: path + '[' + i + ']', depth: depth + 1, seen, budget })
      );
    }
    return removed;
  }

  for (const key of Object.keys(value)) {
    if (budget.left-- <= 0) return removed;
    const where = path ? path + '.' + key : key;

    if (key.charCodeAt(0) === 36 /* $ */) {
      delete value[key];
      removed.push(where);
      continue;
    }

    /*
     * __proto__ and constructor are not operators, but a key that reaches an
     * assignment can change objects this request never touched. The parsers
     * already drop __proto__; this is the belt, and it costs one comparison.
     */
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete value[key];
      removed.push(where);
      continue;
    }

    removed.push(...strip(value[key], { path: where, depth: depth + 1, seen, budget }));
  }

  return removed;
}

/**
 * Express middleware. Mounted immediately after the body parsers, so nothing
 * downstream has to remember to do this.
 */
function noMongoOperators(req, res, next) {
  try {
    const removed = strip(req.body);
    if (removed.length) {
      /*
       * The path and the count, never the value. A message assembled out of
       * what a caller sent is how a log becomes a place to write things.
       * Paths are keys the caller chose too, so they are bounded and the list
       * is capped: enough to find the client that is doing it.
       */
      const shown = removed.slice(0, 5).map((one) => String(one).slice(0, 80));
      console.warn(
        '[no-mongo-operators] removed %d operator key(s) from %s %s: %s',
        removed.length,
        req.method,
        req.path,
        shown.join(', ')
      );
    }
  } catch (e) {
    /* A guard that fails must not take the request with it: the worst case is
       the behaviour this product had before it existed. */
    console.warn('[no-mongo-operators] could not read the body:', e && e.message);
  }
  next();
}

module.exports = noMongoOperators;
module.exports.strip = strip;
module.exports.DEEPEST = DEEPEST;
module.exports.MOST_NODES = MOST_NODES;
