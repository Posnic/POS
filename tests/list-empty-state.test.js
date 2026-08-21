const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * An empty list means two different things, and the row count cannot tell them
 * apart.
 *
 * "No items yet - add your first item with the New button above" was shown for
 * BOTH of them. A shop with five thousand items, whose search happened to match
 * none of them, was told its catalogue was empty and invited to start it. An
 * answer that is confidently wrong is worse than no answer: it sends somebody
 * looking for missing DATA instead of fixing their SEARCH.
 *
 * This is the quotes bug on the two most-used lists in the product. That one
 * was caused by a selector reading an input that had been removed; this one is
 * the same lie reached a different way, which is why the fix is a shared
 * question - hasActiveFilters - rather than a message tweak on one screen.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const core = read('frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');
const LISTS = [
  {
    module: 'items',
    html: read('frontend', 'modules', 'items.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
    empty: 'item_img_hide',
    noMatch: 'item_no_match',
  },
  {
    module: 'customers',
    html: read('frontend', 'modules', 'customers.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'customers.js'),
    empty: 'customer_img_hide',
    noMatch: 'customer_no_match',
  },
];

test('a filtered list has its own empty state', () => {
  for (const l of LISTS) {
    assert.match(
      l.html,
      new RegExp(`id="${l.noMatch}"`),
      `${l.module}: no separate "nothing matched" state - the "none yet" message covers both`,
    );
    /* The two must be distinct elements. One element with swapped text would
       work, but the ACTIONS differ and that is the point: "add your first"
       when there is nothing, "clear the filter" when the rows are hidden. */
    assert.match(l.html, new RegExp(`id="${l.empty}"`), `${l.module}: the "none yet" state is gone`);
    assert.notStrictEqual(
      l.html.indexOf(`id="${l.noMatch}"`),
      l.html.indexOf(`id="${l.empty}"`),
      `${l.module}: the two empty states are the same element`,
    );
  }
});

test('the two states are chosen by whether a filter is active', () => {
  for (const l of LISTS) {
    const at = l.js.indexOf('rowTotal === 0');
    assert.notStrictEqual(at, -1, `${l.module}: the empty branch is gone`);
    const body = l.js.slice(at, at + 700);
    assert.match(
      body,
      /hasActiveFilters\(/,
      `${l.module}: the empty branch still guesses - it cannot tell an empty shop from a filtered view`,
    );
    assert.match(body, new RegExp(l.noMatch), `${l.module}: the no-match state is never shown`);
    /* and the non-empty branch must hide BOTH, or one lingers over a full list */
    const after = l.js.slice(at, at + 900);
    assert.ok(
      new RegExp(`${l.empty}[^\\n]*${l.noMatch}|${l.noMatch}[^\\n]*${l.empty}`).test(after),
      `${l.module}: the rows-present branch does not hide both empty states`,
    );
  }
});

test('the no-match state offers to clear the filter, not to create a record', () => {
  /* Offering "add your first item" to somebody whose search failed is what
     made the original message wrong; offering it again in the new state would
     keep the bug and only change its wording. */
  for (const l of LISTS) {
    const at = l.html.indexOf(`id="${l.noMatch}"`);
    const block = l.html.slice(at, l.html.indexOf('</div>', at));
    assert.match(
      block,
      new RegExp(`clearListFilters\\('${l.module}'\\)`),
      `${l.module}: the no-match state does not offer a way back to the full list`,
    );
    assert.ok(
      !/importTableFile/.test(block),
      `${l.module}: the no-match state offers a CSV import, which is the other case's answer`,
    );
  }
});

test('hasActiveFilters reads what search() wrote, not the input boxes', () => {
  /* A date sitting in the picker that was never applied is not a filter.
     Reading the inputs would count it as one and show "nothing matched" over
     a list that is not filtered at all. */
  const at = core.indexOf('hasActiveFilters: function');
  assert.notStrictEqual(at, -1, 'hasActiveFilters is gone');
  const body = core.slice(at, core.indexOf('\n    },', at));
  assert.match(body, /data\('filters'\)/, 'it does not read the applied filter state');
  assert.ok(
    !/_input'\)\.val\(\)|_daterange'\)\.val\(\)/.test(body),
    'it inspects the input boxes - an unapplied date would read as a filter',
  );
  /* An empty object is not a filter: search() always writes something. */
  assert.match(body, /Object\.keys\(/, 'an empty filter object would count as active');
  assert.match(body, /catch/, 'unparseable filter state would throw inside a render');
});

test('clearing from the empty state actually reloads the list', () => {
  /* dateRangefilterClear empties the INPUTS but leaves data('filters') and
     never reloads, so on its own it leaves the controls disagreeing with the
     rows until Apply is pressed again. An empty state offering to clear the
     search has to really clear it. */
  const at = core.indexOf('clearListFilters: function');
  assert.notStrictEqual(at, -1, 'clearListFilters is gone');
  const body = core.slice(at, core.indexOf('\n    },', at));
  assert.match(body, /data\('filters', ''\)/, 'the applied filter is not reset');
  assert.match(body, /current_page', 1/, 'it stays on a page that no longer exists');
  /* The INVOCATION, not the name. A first version matched `module + 'Table'`,
     which also appears in the typeof guard beside it - deleting the actual
     call left the test green. */
  assert.match(
    body,
    /mod\[module \+ 'Table'\]\(/,
    'nothing reloads - the rows would not come back',
  );
});

test('the dead placeholder those states replaced is gone', () => {
  /* .item_norecord / .customer_norecord were empty divs nothing referenced. */
  for (const l of LISTS) {
    assert.ok(
      !new RegExp(`${l.module.replace(/s$/, '')}_norecord`).test(l.html),
      `${l.module}: the unused no-record placeholder is still in the markup`,
    );
  }
});
