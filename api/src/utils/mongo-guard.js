'use strict';

/*
 * Operators that run code, or read the whole collection to answer.
 *
 * WHY THIS IS NEEDED ON TOP OF THE APP-LEVEL SANITISER
 *
 * app.js mounts a middleware that walks req.query and req.body and drops any
 * key beginning with '$'. That covers the normal case and is genuinely load
 * bearing - but it walks OBJECTS, and list endpoints take their filter as a
 * JSON STRING:
 *
 *     GET /api/items?filters={"$where":"sleep(5000)"}
 *
 * To the sanitiser `filters` is one string value with an ordinary name, so it
 * is copied across untouched. The controller then JSON.parses it back into an
 * object with its '$' keys intact and spreads the result into a live query.
 * The guard is not bypassed by cleverness; it simply never sees inside.
 *
 * WHY NOT JUST STRIP EVERY '$' KEY HERE TOO
 *
 * Because the filters are a real query language and the app uses it: Sales
 * History sends { sale_process: { $ne: 'KOT' } } to keep kitchen tickets out
 * of the list, and the item list relies on { created_date: { $gte, $lte } }
 * for its date window. Stripping those would not harden anything, it would
 * silently un-filter lists - and a list quietly showing rows it was told to
 * hide is its own kind of bug.
 *
 * So the line is drawn at CODE EXECUTION rather than at the '$' character.
 * $where and $function evaluate JavaScript inside the database, which at best
 * occupies a connection for as long as the caller likes and at worst is a way
 * to reach documents the query was never scoped to. $accumulator is the same
 * class. $expr does not execute JS but compares fields across the document and
 * defeats indexes, turning any list into a collection scan.
 *
 * Checked RECURSIVELY: these are exactly as dangerous nested inside $and or
 * $or as at the top level, and a guard that only checked the top would be one
 * that looks present. The depth cap stops a hostile deeply-nested payload from
 * costing more to inspect than to run.
 *
 * This is the rule easy-tables.controller.js already applied to its own `where`
 * parameter. It was right there and wrong everywhere else, which is the usual
 * shape of a guard that lives in the file that first needed it.
 */
const CODE_OPERATORS = new Set(['$where', '$function', '$accumulator', '$expr']);

function findCodeOperator(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findCodeOperator(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, v] of Object.entries(value)) {
    if (CODE_OPERATORS.has(key)) return key;
    const hit = findCodeOperator(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/*
 * Parse a client-supplied filter string and refuse the dangerous shapes.
 *
 * Returns { filters, rejected }. `rejected` is the operator's name when one was
 * found, so the caller can answer 400 and say which - a filter silently
 * emptied would look like "no results" and send someone hunting for missing
 * data instead of fixing their request.
 *
 * Unparseable input is NOT an error: that is the behaviour every one of these
 * endpoints already had, and tightening it here would change what a malformed
 * request does on eight screens at once. Only the code operators are new.
 */
function parseFilterParam(raw) {
  let parsed = {};
  if (raw && typeof raw === 'string') {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value;
    } catch (e) {
      return { filters: {}, rejected: null };
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw;
  }

  const rejected = findCodeOperator(parsed);
  if (rejected) return { filters: {}, rejected };
  return { filters: parsed, rejected: null };
}

module.exports = { CODE_OPERATORS, findCodeOperator, parseFilterParam };
