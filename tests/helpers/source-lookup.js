'use strict';

const assert = require('node:assert');

/*
 * Reading assertions out of source files, without quietly reading the wrong one.
 *
 * These tests check behaviour by finding a function or a CSS rule in the shipped
 * source and asserting on its contents. The whole approach turns on locating the
 * RIGHT one, and the obvious implementation - indexOf, take the first hit - is
 * wrong in a way that never announces itself:
 *
 *   - sales.js defines `showDetails: function (id) {` twice, once for quotes and
 *     once for sales history. A first-occurrence lookup tested the wrong module
 *     and passed.
 *   - CSS selectors are not unique either. ".. > #quotes_list_card" appears
 *     first inside a GROUPED rule whose declarations are entirely different, and
 *     again inside a [data-theme] override that merely contains the same text.
 *     Eight assertions in one file were reading rules nobody meant.
 *
 * Every one of those passed. A test that passes for the wrong reason is worse
 * than one that fails, because nobody looks at it again. So ambiguity is an
 * error here: a marker that matches more than once fails and says so, and the
 * caller narrows the search deliberately.
 */

/* All indices of `needle` in `haystack`. */
function occurrences(haystack, needle, from = 0) {
  const out = [];
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    out.push(at);
  }
  return out;
}

/*
 * The balanced { ... } block that opens at or after `marker`, marker included.
 *
 * The marker must identify exactly one place. When a name genuinely repeats -
 * two namespaces with a `showDetails` each - slice the enclosing namespace first
 * and search within that, rather than hoping the first hit is yours.
 */
function blockAt(source, marker) {
  const hits = occurrences(source, marker);
  assert.ok(hits.length > 0, `not found in source: ${marker}`);
  assert.strictEqual(
    hits.length,
    1,
    `"${marker}" appears ${hits.length} times - narrow the search (slice the ` +
      'enclosing namespace first). Taking the first hit reads the wrong one and passes.',
  );

  const start = hits[0];
  const open = source.indexOf('{', start);
  assert.notStrictEqual(open, -1, `no block opens after: ${marker}`);

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        assert.ok(i > start, 'block ends before it begins');
        return source.slice(start, i + 1);
      }
    }
  }
  return assert.fail(`unbalanced block after: ${marker}`);
}

/*
 * A CSS rule reader bound to one stylesheet.
 *
 * Only a selector that STARTS its own line counts as that rule's selector; the
 * same text mid-line belongs to a different rule that merely contains it.
 *
 * `fromMarker` names the rule by what sits immediately above it, which is the
 * one thing that separates two identical selectors. Supplying it IS the
 * disambiguation, so uniqueness is not demanded as well - otherwise a rule and
 * its legitimate @media override could never both be tested.
 */
function cssReader(css) {
  return function cssRule(sel, fromMarker) {
    const from = fromMarker ? css.indexOf(fromMarker) : 0;
    assert.notStrictEqual(from, -1, `anchor not found in css: ${fromMarker}`);

    const hits = occurrences(css, sel, from).filter((at) => {
      const lineStart = css.lastIndexOf('\n', at) + 1;
      return css.slice(lineStart, at).trim() === '';
    });

    assert.ok(hits.length > 0, `no CSS rule mentions: ${sel}`);
    if (!fromMarker) {
      assert.strictEqual(
        hits.length,
        1,
        `"${sel}" matches ${hits.length} places - pass a fromMarker to disambiguate. ` +
          'A first-occurrence match silently reads the wrong rule and passes anyway.',
      );
    }

    const open = css.indexOf('{', hits[0]);
    const close = css.indexOf('}', open);
    assert.ok(close > open, `unbalanced CSS rule for: ${sel}`);
    return css.slice(open + 1, close);
  };
}

/*
 * A CSS rule read by its PURPOSE rather than its selector.
 *
 * cssRule above names a rule by the class it is written on, which is fine
 * until the class is the thing changing. Extracting a pattern renames every
 * selector it touches - so a test suite that finds rules by name has to be
 * rewritten in the same commit as the refactor it exists to police, and the
 * safety net is rebuilt by the fall it is meant to catch.
 *
 * A marker comment names what the rule is FOR, which survives the rename. The
 * test then asserts on declarations, and the extraction becomes a pure edit
 * with the net already in place and untouched.
 *
 * Returns the selector too, so a test that genuinely cares about the name -
 * "this rule must be generic now" - can still say so, deliberately, rather
 * than by accident of how it looked the rule up.
 */
function markerReader(css) {
  return function ruleFor(marker) {
    /*
     * The WHOLE comment, not the name inside it.
     *
     * A bare substring search makes any marker that is a prefix of another
     * ambiguous - "MD:rail" also finds MD:rail-wide, MD:rail-body and
     * MD:rail-scroller, which is four hits for a name that reads as specific.
     * Matching the delimiters removes the hazard instead of relying on nobody
     * ever choosing a name that extends another.
     */
    const comment = `/* ${marker} */`;
    const hits = occurrences(css, comment, 0);
    assert.ok(hits.length > 0, `marker not found in css: ${comment}`);
    assert.strictEqual(
      hits.length,
      1,
      `marker "${marker}" appears ${hits.length} times - a marker that names two ` +
        'rules identifies neither',
    );
    const endComment = css.indexOf('*/', hits[0]);
    assert.notStrictEqual(endComment, -1, `marker is not inside a comment: ${marker}`);
    const open = css.indexOf('{', endComment);
    const close = css.indexOf('}', open);
    assert.ok(open !== -1 && close > open, `no rule follows marker: ${marker}`);
    return {
      selector: css.slice(endComment + 2, open).trim(),
      body: css.slice(open + 1, close),
    };
  };
}

/*
 * Comments are not code.
 *
 * A check for "is this function called anywhere" reported four hits once; three
 * were commented out. And prose that NAMES the thing it removed reads as the
 * thing itself - several assertions matched their own explanatory comment.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at === -1) return line;
      const before = line.slice(0, at);
      // not a comment if it is inside a string, or part of a URL like https://
      if ((before.match(/['"`]/g) || []).length % 2 === 1) return line;
      if (before.endsWith(':')) return line;
      return before;
    })
    .join('\n');
}

module.exports = { blockAt, cssReader, markerReader, stripComments, occurrences };
