'use strict';

const { findCodeOperator } = require('../utils/mongo-guard');

/*
 * The gap the app-level '$' sanitiser cannot see into.
 *
 * app.js walks req.query and req.body and drops any key beginning with '$'.
 * That is right for ordinary parameters and genuinely load bearing. But the
 * list endpoints take their filter as a JSON STRING:
 *
 *     GET /api/items?filters={"$where":"sleep(5000)"}
 *
 * To that walk, `filters` is one string value with an ordinary name, so it is
 * copied across untouched. The controller then JSON.parses it back into an
 * object with its operators intact and spreads the result into a live query.
 * The sanitiser is not defeated by cleverness - it simply never sees inside.
 *
 * Eight controllers parse a filter string this way (items, sales, customers,
 * categories, customer-categories, customerCategory, branches, receivings), so
 * this belongs in one place rather than eight, and it covers the ninth
 * whenever somebody writes it.
 *
 * NOT a '$' strip, deliberately. These filters are a real query language and
 * the app uses it: Sales History sends { sale_process: { $ne: 'KOT' } } to keep
 * kitchen tickets out of the list, and date windows are $gte/$lte. Removing
 * those would not harden anything - it would silently un-filter lists, and a
 * list quietly showing rows it was told to hide is its own kind of bug. The
 * line is drawn at CODE EXECUTION instead.
 *
 * Rejected loudly rather than emptied. A filter silently dropped reads as "no
 * results", which sends somebody hunting for missing data instead of fixing
 * the request that was refused.
 */
function filterGuard(req, res, next) {
  const sources = [req.query, req.body];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string') continue;
      const head = value.trim()[0];
      /* Only things that could be an object or an array. Parsing every string
         parameter on every request would be real work for no answer. */
      if (head !== '{' && head !== '[') continue;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch (e) {
        continue; /* not JSON - every endpoint here already tolerates that */
      }
      const bad = findCodeOperator(parsed);
      if (bad) {
        console.warn(`Blocked code operator '${bad}' in parameter '${key}'`);
        return res.status(400).json({
          type: 'error',
          message: `Filter operator "${bad}" is not allowed`,
          data: null,
        });
      }
    }
  }
  return next();
}

module.exports = { filterGuard };
