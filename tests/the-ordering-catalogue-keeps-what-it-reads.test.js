'use strict';

/*
 * A field the ordering catalogue does not name is a field the page never sees.
 *
 * `catalogueItem()` in order/indexedDB.js is the whole `/order` catalogue: one
 * object literal built out of what the storefront sent. It is a WHITELIST, and
 * an unnamed field is dropped in silence - no error, no log, no failing test,
 * because every test on those features reads the source of the feature rather
 * than the source of this.
 *
 * THIS HAS NOW HAPPENED TWICE.
 *
 *   - nutrition, tags, marks and claims, sent since the dish-facts release and
 *     dropped for three releases. /order showed no calorie figures, no earned
 *     badges, no signature or chef's pick marks, and a "Good for" filter group
 *     with nothing to offer. /menu, which reads the same endpoint without a
 *     local store, showed all of it.
 *
 *   - daily_price and price_set_on, read by waitingForTodaysPrice() since the
 *     daily-price release and never once delivered to it. A dish priced from
 *     the morning's market and last priced YESTERDAY was offered at yesterday's
 *     rate with an ordinary Add button. That one is about money.
 *
 * So rather than adding a third named field to a third test, this states the
 * rule: EVERY STOREFRONT FIELD THE ORDERING BUNDLE READS OFF A CATALOGUE
 * PRODUCT MUST BE KEPT BY THE CATALOGUE. Add a read tomorrow and this fails
 * until the literal names it.
 *
 * And it RUNS the thing rather than reading it. A regex over an object literal
 * would have passed on a `nutrition:` line that stored the wrong value; the
 * function is lifted out and driven over a real payload instead.
 *
 * Same shape of bug as the handset's menu loader, which is a whitelist too and
 * had open_price dead inside it for months.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');

/** The matching close of the brace that opens at or after `from`. */
function closeOf(src, from) {
  let depth = 0;
  let i = src.indexOf('{', from);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unclosed brace');
}

/** The real function, lifted out and callable. */
function catalogueItem() {
  const at = DB.indexOf('function catalogueItem(');
  assert.ok(at !== -1, 'the ordering catalogue is not built where this test thinks');
  const open = DB.indexOf('{', at);
  const body = DB.slice(open + 1, closeOf(DB, at));
  // eslint-disable-next-line no-new-func
  return new Function('item', 'categoryName', body);
}

/** Its source, for the questions that are about the whitelist itself. */
function whitelist() {
  const at = DB.indexOf('function catalogueItem(');
  return DB.slice(at, closeOf(DB, at) + 1);
}

/** What the storefront puts on every item, as the page receives it. */
function sentToThePage() {
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'item.repository.js'),
    'utf8'
  );
  const push = src.indexOf('$push: {', src.indexOf('items: {'));
  assert.ok(push !== -1, 'the storefront aggregation is not where this test thinks');
  const block = src.slice(push, closeOf(src, push + 6) + 1);
  const named = [...new Set([...block.matchAll(/^\s{16}([a-z_0-9]+):/gm)].map((m) => m[1]))];

  /* Destructured away in the map below the pipeline: these never travel raw,
     they are folded into photos / available / served_in / the dish facts. */
  const foldedAway = ['multi_image', 'daypart_ids', 'nutrition_source', 'food_tags', 'menu_marks'];
  /* ...and these are what that same map puts there instead. */
  const foldedIn = ['photos', 'available', 'served_in', 'nutrition', 'tags', 'marks', 'claims'];

  return [...new Set(named.filter((f) => !foldedAway.includes(f)).concat(foldedIn))];
}

/*
 * The scripts that read a catalogue PRODUCT.
 *
 * Listed rather than swept up, because the bundle holds other shapes that
 * share field names with a product and would read as false alarms: the
 * thank-you page walks the SERVER'S RECEIPT, whose lines carry their own
 * `tax`. Add a script that reads products and it belongs here.
 */
const CONSUMERS = [
  'indexedDB.js',
  'assets/products/script.js',
  'assets/cart/script.js',
  'assets/assistant/script.js',
  'assets/assistant/voice.js',
];

function consumerSource() {
  const list = whitelist();
  /* Everything EXCEPT the whitelist itself: the reads inside it are the
     boundary - `price: parseFloat(item.final_price)` is the catalogue
     consuming a server field, not the page reading a stored one. */
  const outside = DB.replace(list, '');

  return CONSUMERS.map((rel) => {
    const full = path.join(ROOT, 'order', rel);
    assert.ok(fs.existsSync(full), rel + ' is on the consumer list and not in the bundle');
    return rel === 'indexedDB.js' ? [rel, outside] : [rel, fs.readFileSync(full, 'utf8')];
  });
}

/* A dish as the storefront really sends one, facts and all. */
const DISH = {
  id: 'm3',
  name: 'Chettinad Chicken',
  img: 'chettinad.jpg',
  icon: '',
  description: 'Slow cooked, black pepper, star anise',
  diet: 'non_veg',
  prep_minutes: 25,
  ordered_count: 66,
  available: true,
  available_quantity: 4,
  served_in: ['Dinner'],
  photos: ['chettinad.jpg'],
  goes_with: ['r2'],
  price: 380,
  final_price: 380,
  discount_price: 0,
  tax_price: 0,
  nutrition: { kcal: 420, protein_g: 38 },
  tags: ['gluten_free'],
  marks: ['signature'],
  claims: ['high_protein'],
  spice_choice: true,
  daily_price: false,
  price_set_on: '',
};

/* ------------------------------------------------------------- the rule */

test('every storefront field the page reads is a field the catalogue kept', () => {
  const list = whitelist();
  const consumers = consumerSource();
  const dropped = [];

  for (const field of sentToThePage()) {
    const readers = consumers
      .filter(([, text]) => new RegExp('\\.' + field + '\\b').test(text))
      .map(([rel]) => rel);
    if (!readers.length) continue; /* sent, but nobody on the page wants it */
    if (new RegExp('[\\s{]' + field + ':').test(list)) continue;
    dropped.push(field + ' (read by ' + readers.join(', ') + ')');
  }

  assert.deepStrictEqual(
    dropped.sort(),
    [],
    'the catalogue drops fields the page goes on to read, so they are undefined ' +
      'on every dish:\n  ' +
      dropped.join('\n  ')
  );
});

/* ------------------------------------------------- and the thing itself */

test('a dish arrives on the page with the facts the server sent', () => {
  /*
   * Driven, not read. A whitelist that names `nutrition:` and stores the wrong
   * thing passes every regex ever written about it.
   */
  const kept = catalogueItem()(DISH, 'Mains');
  assert.deepStrictEqual(kept.nutrition, { kcal: 420, protein_g: 38 });
  assert.deepStrictEqual(kept.tags, ['gluten_free']);
  assert.deepStrictEqual(kept.marks, ['signature']);
  assert.deepStrictEqual(kept.claims, ['high_protein']);
  assert.strictEqual(kept.spice_choice, true);
  assert.strictEqual(kept.category_name, 'Mains');
});

test('a dish with nothing entered carries empties, never undefined', () => {
  /*
   * The page does `(product.claims || []).forEach` in some places and
   * `Array.isArray(p.tags)` in others. Empties keep both honest, and mean a
   * shop that has entered nothing gets no badges rather than a crash.
   */
  const kept = catalogueItem()({ id: 'x', name: 'Plain' }, 'Mains');
  assert.deepStrictEqual(kept.nutrition, {});
  assert.deepStrictEqual(kept.tags, []);
  assert.deepStrictEqual(kept.marks, []);
  assert.deepStrictEqual(kept.claims, []);
  assert.strictEqual(kept.spice_choice, false);
  assert.strictEqual(kept.daily_price, false);
  assert.strictEqual(kept.price_set_on, '');
});

test('the market-price gate can actually see a market price', () => {
  /*
   * The second bug the rule caught, kept as its own test because the general
   * one will not say what it costs. waitingForTodaysPrice() is the ONE rule
   * behind both the dish card and the dish sheet - written at the top level so
   * the two cannot disagree - and it had been reading two fields that were
   * never stored, leaving it able to answer only "has it got a price at all".
   */
  const kept = catalogueItem()(
    Object.assign({}, DISH, { daily_price: true, price_set_on: '2026-09-14T06:30:00.000Z' }),
    'Mains'
  );
  assert.strictEqual(kept.daily_price, true);
  assert.strictEqual(kept.price_set_on, '2026-09-14T06:30:00.000Z');

  const fn = DB.slice(DB.indexOf('function waitingForTodaysPrice'));
  assert.match(
    fn.slice(0, 400),
    /product\.daily_price === true && !pricedToday\(product\.price_set_on\)/,
    'the gate no longer reads the pair this test is about'
  );
});

test('a flag that arrives as the word "false" is still off', () => {
  /* Settings and flags have reached this codebase as the string "false" and
     read as ON through a loose check. Both booleans here are strict. */
  const kept = catalogueItem()(
    Object.assign({}, DISH, { spice_choice: 'false', daily_price: 'false' }),
    'Mains'
  );
  assert.strictEqual(kept.spice_choice, false);
  assert.strictEqual(kept.daily_price, false);
});
