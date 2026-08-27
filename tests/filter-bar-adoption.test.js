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
    /* Purchase History retired (2026-08-27): the bar's 'receivings' key
       lives on, mounted by the ONE purchases surface whose controls carry
       the purchases_ prefix. */
    key: 'receivings',
    idPrefix: 'purchases',
    html: read('frontend', 'modules', 'purchaseOrders.html'),
    js: read('frontend', 'static', 'script', 'js', 'modules', 'js', 'receiving_add.js'),
  },
];

test('each list has the bar mounted with a panel and a button', () => {
  for (const s of SCREENS) {
    const prefix = s.idPrefix || s.key;
    assert.match(s.html, new RegExp(`id="${prefix}_filter_panel"`), `${s.key}: no filter panel`);
    assert.match(s.html, new RegExp(`id="${prefix}_filter_btn"`), `${s.key}: no filter button`);
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
    /* the purchases surface's loadList sits farther from its mount config */
    const body = s.js.slice(at, at + (s.idPrefix ? 12000 : 1600));
    assert.match(body, /legacyFilters\(/, `${s.key}: does not translate to the filters blob`);
    if (s.idPrefix) {
      /* the purchases surface has no DataTable: the bar's onChange reloads
         page 1 and the fetch carries the same blob in its query */
      assert.match(body, /loadList\(1\)/, `${s.key}: a filter change must land on page 1`);
      assert.match(body, /filters: JSON\.stringify/, `${s.key}: never sends the filter`);
    } else {
      assert.match(body, /data\('filters', JSON\.stringify/, `${s.key}: never applies the filter`);
      assert.match(body, /current_page', 1/, `${s.key}: stays on a page the new filter may not have`);
    }
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
test('the customer typeahead asks the server, not a cache of ten', () => {
  /*
   * The reported bug: the picker said "Nothing matches" for a customer whose
   * quotes were listed directly underneath it.
   *
   * LF.suggest filters `rows`, which is recents plus PosnicPro.sales
   * ._customerSeed - and that seed is the FIRST TEN customers, fetched only by
   * renderRecentCustomers on the SALE screen. On the quotes page nothing calls
   * it, so the seed is null and the suggestions are recents alone, while the
   * list beside it queries the server properly.
   *
   * A suggestion box that disagrees with the results it sits on top of is
   * worse than no suggestion box.
   */
  const at = lf.indexOf('customer: {');
  assert.notStrictEqual(at, -1, 'the customer entity is gone');
  const entity = lf.slice(at, lf.indexOf('item: {', at));
  assert.match(entity, /lookup: function/, 'the customer entity still cannot ask the server');
  assert.match(entity, /getCustomersAjaxList/, 'it does not use the real customer search endpoint');
  assert.match(entity, /encodeURIComponent/, 'the typed term is not encoded - a name with & breaks the query');
  /* Offline must not raise an error popup over a filter panel. */
  assert.match(entity, /function \(\) \{ done\(\[\]\); \}/, 'a failed lookup has no quiet fallback');
});

test('a slow suggestion reply cannot overwrite a newer one', () => {
  /* Type "Cus" then "Custom": without a sequence guard the older answer can
     land last and leave the wrong list on screen. */
  const at = lf.indexOf('LF.typeahead = function');
  const body = lf.slice(at, lf.indexOf('LF.paintTypeahead = function'));
  assert.match(body, /_taSeq/, 'there is no sequence guard on the lookup');
  assert.match(body, /if \(mine !== m\._taSeq\) return;/, 'a stale reply is not dropped');
});

test('cached rows still paint immediately', () => {
  /* The server answer merges in when it lands; the box must not go blank
     waiting for it, or every keystroke flickers. */
  const at = lf.indexOf('LF.typeahead = function');
  const body = lf.slice(at, lf.indexOf('LF.paintTypeahead = function'));
  const lookupAt = body.indexOf('e.lookup(');
  const paintAt = body.lastIndexOf('LF.paintTypeahead(key, e, rows)');
  assert.ok(paintAt > lookupAt, 'the cached rows are not painted after the lookup is dispatched');
  assert.match(lf, /LF\.paintTypeahead = function/, 'painting was not split out, so a late reply cannot repaint');
});
