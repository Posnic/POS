'use strict';

/*
 * A field the ordering catalogue does not name is a field the page never sees.
 *
 * `order/indexedDB.js` builds the whole `/order` catalogue in ONE object
 * literal - `products.push({ ... })` - out of what the storefront sent. It is
 * a whitelist, and an unnamed field is dropped in silence: no error, no log,
 * no failing test, because every test on those features reads the source of
 * the feature rather than the source of the catalogue.
 *
 * THIS HAS NOW HAPPENED TWICE.
 *
 *   - nutrition, tags, marks and claims, sent since the dish-facts release
 *     and dropped for three releases. /order showed no calorie figures, no
 *     earned badges, no signature or chef's pick marks, and a "Good for"
 *     filter group with nothing to offer. /menu, which reads the same endpoint
 *     without a local store, showed all of it.
 *
 *   - daily_price and price_set_on, read by waitingForTodaysPrice() since the
 *     daily-price release and never once delivered to it. A dish priced from
 *     the morning's market and last priced YESTERDAY was offered at yesterday's
 *     rate with an ordinary Add button. That one is about money.
 *
 * So rather than adding a third named field to a third test, this states the
 * rule: EVERY FIELD THE ORDERING BUNDLE READS OFF A CATALOGUE PRODUCT MUST BE
 * KEPT BY THE CATALOGUE. Add a read tomorrow and this fails until the literal
 * names it.
 *
 * The same shape of bug as [[captain-menu-field-whitelist]]: the handset's
 * menu loader is a whitelist too, and open_price was dead in it for months.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

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
  const foldedAway = [
    'multi_image',
    'daypart_ids',
    'nutrition_source',
    'food_tags',
    'menu_marks',
  ];
  /* ...and these are what that map puts there instead. */
  const foldedIn = ['photos', 'available', 'served_in', 'nutrition', 'tags', 'marks', 'claims'];

  return [...new Set(named.filter((f) => !foldedAway.includes(f)).concat(foldedIn))];
}

/** The catalogue literal itself. */
function catalogueBlock() {
  const db = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');
  const at = db.indexOf('products.push({');
  assert.ok(at !== -1, 'the ordering catalogue is not built where this test thinks');
  return { db, at, block: db.slice(at, closeOf(db, at + 13) + 1) };
}

/*
 * The scripts that read a catalogue PRODUCT.
 *
 * Named rather than swept up, because the bundle holds other shapes that share
 * field names with a product and would read as false alarms: the thank-you
 * page walks the SERVER'S RECEIPT, whose lines carry their own `tax`, and the
 * cart walks lines the customer built. Add a script that reads products and it
 * belongs on this list.
 */
const CONSUMERS = [
  'indexedDB.js',
  'assets/products/script.js',
  'assets/cart/script.js',
  'assets/assistant/script.js',
  'assets/assistant/voice.js',
];

function bundleSource() {
  const { db, at, block } = catalogueBlock();
  /* Everything EXCEPT the catalogue literal: the reads inside it are the
     boundary itself - `price: parseFloat(item.final_price)` is the catalogue
     consuming a server field, not the page reading a stored one. */
  const outsideTheLiteral = db.slice(0, at) + db.slice(at + block.length);

  return CONSUMERS.map((rel) => {
    const full = path.join(ROOT, 'order', rel);
    assert.ok(fs.existsSync(full), rel + ' is on the consumer list and not in the bundle');
    return rel === 'indexedDB.js' ? [rel, outsideTheLiteral] : [rel, fs.readFileSync(full, 'utf8')];
  });
}

test('every storefront field the page reads is a field the catalogue kept', () => {
  const { block } = catalogueBlock();
  const consumers = bundleSource();
  const dropped = [];

  for (const field of sentToThePage()) {
    const readers = consumers
      .filter(([, text]) => new RegExp('\\.' + field + '\\b').test(text))
      .map(([rel]) => rel);
    if (!readers.length) continue;                       // sent but nobody wants it
    if (new RegExp('[\\s{]' + field + ':').test(block)) continue;
    dropped.push(field + ' (read by ' + readers.join(', ') + ')');
  }

  assert.deepStrictEqual(
    dropped.sort(),
    [],
    'the ordering catalogue drops fields the page goes on to read, so they are ' +
      'undefined on every dish:\n  ' +
      dropped.join('\n  ')
  );
});

test('the market-price gate can actually see a market price', () => {
  /*
   * The second bug this rule caught, kept as its own test because the general
   * one will not say what it costs. waitingForTodaysPrice() is the ONE rule
   * behind both the card and the dish sheet - written at the top level so the
   * two cannot disagree - and it has been reading two fields that were never
   * stored, which left it able to answer only "has it got a price at all".
   */
  const { block } = catalogueBlock();
  assert.match(block, /[\s{]daily_price:/, 'the catalogue drops daily_price');
  assert.match(block, /[\s{]price_set_on:/, 'the catalogue drops price_set_on');

  const db = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');
  const fn = db.slice(db.indexOf('function waitingForTodaysPrice'));
  assert.match(
    fn.slice(0, 400),
    /product\.daily_price === true && !pricedToday\(product\.price_set_on\)/,
    'the gate no longer reads the pair this test is about'
  );
});

test('the flag survives the shape it is stored in', () => {
  /*
   * `daily_price === true` and not a loose truthy read: settings and flags
   * have arrived here as the string "false" before and read as ON.
   * `price_set_on` keeps whatever the server sent, because pricedToday() has
   * to parse it and an empty string is the honest "never".
   */
  const { block } = catalogueBlock();
  assert.match(block, /daily_price: item\.daily_price === true/);
  assert.match(block, /price_set_on: item\.price_set_on \|\| ""/);
});
