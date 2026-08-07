/**
 * Turn something a person typed into something safe to hand Mongo as $regex.
 *
 * Two separate problems, and the code that had one usually had the other.
 *
 * A value from a request is not necessarily a string. Express parses
 * ?q[]=a&q[]=b into an array and ?q[$ne]=x into an object, and both sail past
 * the guards people write - `q.length < 2` is a length check on an array and
 * `undefined < 2` on an object, which is false. Whatever arrives then lands in
 * { $regex: q }, where an operator is not a pattern.
 *
 * And a string is not a pattern. Left unescaped, a shop's own search box
 * accepts an arbitrary regular expression: `.*` reads rows the query was meant
 * to narrow, and `(a+)+$` holds the database open on one request until it
 * gives up. CodeQL reports the first as NoSQL injection and the second as
 * ReDoS; they are the same missing line.
 *
 * A non-string returns a pattern that cannot match anything, rather than an
 * empty string. Empty is the dangerous default: { $regex: '' } matches every
 * document, so the failure mode of a bad input would be returning everything.
 */

/* Negative lookahead on nothing: always fails, matches no document. */
const MATCHES_NOTHING = '(?!)';

/* The characters that make a regular expression a program rather than text. */
const RESERVED = /[.*+?^${}()|[\]\\]/g;

/**
 * @param   {unknown} value  anything, including whatever a request supplied
 * @returns {string}         a pattern safe to place in { $regex: ... }
 */
function searchPattern(value) {
  if (typeof value !== 'string') return MATCHES_NOTHING;
  const trimmed = value.trim();
  if (!trimmed) return MATCHES_NOTHING;
  return trimmed.replace(RESERVED, '\\$&');
}

/**
 * Is this worth searching for at all?
 *
 * Kept separate so a caller can still decide to omit the clause entirely
 * rather than search for nothing - which is usually the better answer for an
 * optional filter, where "no term" should mean "no restriction".
 *
 * @param   {unknown} value
 * @param   {number}  min    shortest term worth querying on
 * @returns {boolean}
 */
function isSearchable(value, min = 1) {
  return typeof value === 'string' && value.trim().length >= min;
}

module.exports = { searchPattern, isSearchable, MATCHES_NOTHING };
