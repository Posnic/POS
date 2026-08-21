const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The shared filter bar on the three busiest lists.
 *
 * list-filter.js was written "because it is going on every list - quotes,
 * items, sales, purchases" and for a long time only quotes had it. The five
 * controls it replaces worked, but could not say a filter was ON: the panel
 * closes and takes them with it, so a list narrowed to one supplier looks
 * exactly like a shop with one supplier, and the next person reports the list
 * as broken.
 *
 * Nine other lists still use the old pattern. That is deliberate and recorded -
 * these three carry the traffic, and a migration is worth doing in one piece
 * per screen rather than half-done across twelve.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const lf = read('frontend', 'static', 'script', 'js', 'core', 'list-filter.js');

const SCREENS = [
  {
    key: 'items',
    html: read('frontend', 'modules', 'items.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
  },
  {
    key: 'sales',
    html: read('frontend', 'modules', 'sales_read.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  },
  {
    key: 'receivings',
    html: read('frontend', 'modules', 'receivings.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'receiving_add.js'),
  },
];

test('each list has the bar mounted with a panel and a button', () => {
  for (const s of SCREENS) {
    assert.match(s.html, new RegExp(`id="${s.key}_filter_panel"`), `${s.key}: no filter panel`);
    assert.match(s.html, new RegExp(`id="${s.key}_filter_btn"`), `${s.key}: no filter button`);
    assert.match(
      s.js,
      new RegExp(`key: '${s.key}'`),
      `${s.key}: the bar is never mounted`,
    );
  }
});

test('the old controls are REMOVED, not merely hidden', () => {
  /* Leaving #view_items_input in the markup with nothing writing to it is
     exactly how the quotes search bug worked: a selector that still reads,
     from an input nobody can see. */
  for (const s of SCREENS) {
    for (const suffix of ['_input', '_fields']) {
      assert.ok(
        !new RegExp(`id="view_${s.key}${suffix}"`).test(s.html),
        `${s.key}: view_${s.key}${suffix} is still in the markup`,
      );
    }
    assert.ok(
      !/onclick="PosnicPro\.search\(/.test(s.html),
      `${s.key}: the old Apply button survives alongside the bar`,
    );
  }
});

test('the sales date-range element is kept on purpose', () => {
  /* Twenty other modules read THIS element to label their own empty states -
     "No Records on <range>" - because it carries .daterange-timepicker-all.
     Deleting it with the rest of the old filter row would not have broken
     Sales History; it would have put "No Records on undefined" on twenty
     screens that are not being migrated. */
  const sales = SCREENS.find((s) => s.key === 'sales');
  assert.match(
    sales.html,
    /id="view_sales_daterange"/,
    'removing this breaks the empty state of twenty other modules',
  );
  const readers = fs
    .readdirSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js'))
    .filter((f) => f.endsWith('.js'))
    .filter((f) =>
      read('frontend', 'static', 'script', 'js', 'modules', 'js', f).includes(
        '#view_sales_daterange span span'
      )
    );
  assert.ok(
    readers.length > 5,
    'the cross-screen dependency this element serves has gone - the note above it is now wrong',
  );
});

test('the bar writes the blob these endpoints already took', () => {
  /* The lists keep loading exactly as before; only where the filter comes from
     changed. Rewriting how they load at the same time would make a regression
     impossible to attribute. */
  for (const s of SCREENS) {
    const at = s.js.indexOf(`key: '${s.key}'`);
    const body = s.js.slice(at, at + 1600);
    assert.match(body, /legacyFilters\(/, `${s.key}: does not translate to the filters blob`);
    assert.match(body, /data\('filters', JSON\.stringify/, `${s.key}: never applies the filter`);
    assert.match(body, /current_page', 1/, `${s.key}: stays on a page the new filter may not have`);
  }
});

test('the translation reproduces the regex search() built', () => {
  /* Adopting the bar must not silently change which rows a shop's existing
     habits return. search() matched all tokens in any order; Exact means the
     whole value. */
  const at = lf.indexOf('legacyFilters: function');
  assert.notStrictEqual(at, -1, 'legacyFilters is gone');
  const body = lf.slice(at, lf.indexOf('\n    },', at));
  assert.match(body, /\(\?=\.\*/, 'the all-tokens lookahead is gone - search results will change');
  assert.match(body, /'\^' \+/, 'Exact no longer anchors, so it matches values CONTAINING the term');
  /* BOTH branches, checked at their own call sites. A bare /_escapeRegex/
     match survived a mutation that unescaped both real uses, because a third
     use in the fallback below them kept the word present. */
  assert.match(
    body,
    /'\(\?=\.\*' \+ LF\._escapeRegex\(t\)/,
    'the token search puts user input into a regex unescaped',
  );
  assert.match(
    body,
    /'\^' \+ LF\._escapeRegex\(term\) \+ '\$'/,
    'Exact puts user input into a regex unescaped',
  );
  /* The date column is the caller's: these lists do not agree on it, and
     guessing filters the wrong column while looking like it worked. */
  assert.match(body, /opts && opts\.dateKey/, 'the date column is guessed rather than given');
});

test('sales does not fight its own KOT rule', () => {
  /* salesTable re-applies sale_process $ne KOT on top of whatever is filtered.
     A bar that also wrote that key would have the two arguing over one field. */
  const sales = SCREENS.find((s) => s.key === 'sales');
  const at = sales.js.indexOf("key: 'sales'");
  const body = sales.js.slice(at, at + 1600);
  assert.ok(
    !/sale_process/.test(body),
    'the sales bar writes sale_process, which salesTable also owns',
  );
});
