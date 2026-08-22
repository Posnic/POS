const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, cssReader, stripComments } = require('./helpers/source-lookup');

/*
 * A variant is a distinct thing, and the form has to let it be one.
 *
 * Two faults, reported together:
 *
 *   "item variant same value cant select twise. how can be two variant with
 *    same values. ex. shirt size 40 and 40 again."
 *   "for each variant seperate image possible or not ?"
 *
 * They are the same fault seen from two sides. A variant needs an identity of
 * its own - one value, one picture - and the form was letting two variants
 * share a value while forcing all of them to share a photo. Both produce items
 * nobody can tell apart: "Shirt / 40" twice over, and a whole family showing
 * one picture on the sale grid.
 *
 * Comments are stripped before every assertion. Prose that NAMES a guard reads
 * exactly like the guard, and a test that matches its own explanation passes
 * with the code deleted.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const itemsJs = stripComments(
  read('frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
);
const helperJs = stripComments(read('api', 'src', 'helpers', 'variants.helper.js'));
const variantSvc = stripComments(read('api', 'src', 'services', 'variant.service.js'));
const variantCtl = stripComments(read('api', 'src', 'controllers', 'variants-v2.controller.js'));
const css = read('frontend', 'static', 'style', 'css', 'custom.css');
const cssRule = cssReader(css);

/* A slice between two markers, refusing to read backwards. `a.slice(x, y)`
   with y before x yields '' - and every assertion against '' passes. */
const between = (src, from, to) => {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  assert.notStrictEqual(start, -1, `marker not found: ${from}`);
  assert.notStrictEqual(end, -1, `marker not found: ${to}`);
  assert.ok(end > start, `${to} comes before ${from} - the slice would be empty`);
  return src.slice(start, end);
};

/* ------------------------------------------------------------------ *
 * One value, once
 * ------------------------------------------------------------------ */

test('a variant value cannot be offered twice', () => {
  /*
   * select2 keys a multi-select on the option ELEMENT, not its value. Two
   * <option value="40"> elements are two separate choices, so a variant saved
   * with 40 twice let both be picked - and the family saved two items called
   * "Shirt / 40".
   */
  const fn = blockAt(itemsJs, 'loadVariantValues: function');
  assert.match(fn, /toLowerCase\(\)/, 'the offered values are not compared case-insensitively');
  /*
   * The SKIP, not merely a mention of `seen`. Asserting on the name alone
   * passed with the guard deleted, because `seen[key] = true` on the next line
   * matched it just as well - the bookkeeping without the behaviour.
   */
  assert.match(
    fn,
    /if \(seen\[key\]\)[^\n]*return/,
    'a value already offered is recorded but not skipped',
  );
});

test('the de-duplication is on the server too, not only in the form', () => {
  /* The form is a courtesy. Anything else posting to the API - an import, an
     older build still open in a browser - has to get the same answer. */
  assert.match(helperJs, /seen\.has\(key\)/, 'the helper does not skip a repeated value');
  assert.match(helperJs, /name\.toLowerCase\(\)/, 'the helper compares case-sensitively');
});

test('every path that stores variant values goes through the one helper', () => {
  /* The same four-line normalisation was copied into six places. A guard added
     to one copy is a guard missing from five. */
  for (const [label, src] of [
    ['variant.service', variantSvc],
    ['variants-v2.controller', variantCtl],
  ]) {
    assert.match(src, /normalizeVariantFields/, `${label} does not use the shared normaliser`);
    assert.doesNotMatch(
      src,
      /\.map\(\(val\) => \(\{ name: val \}\)\)/,
      `${label} still has its own copy of the normalisation`,
    );
  }
});

test('values already saved with a duplicate stop offering it on read', () => {
  /* Fixing only the write path leaves every variant saved before today still
     showing 40 twice, because nobody is going to re-save them all. */
  /*
   * The service's is a method, so blockAt can brace-match it. The controller's
   * is an arrow with a `= {}` default parameter - brace-matching from the name
   * stops at THAT pair and reads a few characters, which is the shape of bug
   * that makes a test pass while proving nothing. Bounded by name instead.
   */
  assert.match(
    blockAt(variantSvc, '  formatVariant(variant) {'),
    /normalizeVariantFields\(rawFields\)/,
    'variant.service does not de-duplicate what it reads back',
  );
  assert.match(
    between(variantCtl, 'const formatVariant', 'const sendSuccess'),
    /normalizeVariantFields\(rawFields\)/,
    'variants-v2.controller does not de-duplicate what it reads back',
  );
});

/* ------------------------------------------------------------------ *
 * One axis, once
 * ------------------------------------------------------------------ */

test('the same option cannot be used for both axes', () => {
  /* Size crossed with Size is the same list twice: it produces "40 / 40" and
     "42 / 40" - names stating two different sizes for one garment. */
  const fn = blockAt(itemsJs, 'syncAxisExclusion: function');
  assert.match(fn, /prop\('disabled'/, 'the clashing option is never disabled');
  assert.match(fn, /resetSecondAxis/, 'an existing clash is never cleared');
});

test('both axis pickers apply the exclusion, and so does the first paint', () => {
  /*
   * Only guarding the second picker leaves the clash reachable from the other
   * direction: choose Colour then Size, then change the FIRST back to Size.
   */
  const calls = itemsJs.split('PosnicPro.items.syncAxisExclusion()').length - 1;
  assert.ok(calls >= 3, `syncAxisExclusion is called ${calls} time(s), expected at least 3`);
});

/* ------------------------------------------------------------------ *
 * One photo, per variant
 * ------------------------------------------------------------------ */

test('each variant row has its own photo control', () => {
  assert.match(itemsJs, /items_photo_strip_/, 'no per-row photo strip is built');
  assert.match(itemsJs, /id="items_photo_/, 'no per-row photo value is stored');
});

test('a chosen photo overrides the family photo for that row only', () => {
  const save = between(itemsJs, 'saveVariantFamily: function', 'items/createFamily');
  assert.match(save, /rowPhoto/, 'the row never carries its own photo');
  assert.match(
    save,
    /Object\.assign\(\{\}, shared, rowPhoto \|\| \{\}/,
    'the row photo does not override the shared fields',
  );
  assert.match(save, /cover_image: found\[0\]\.name/, 'the row keeps the family cover image');
});

test('a row with no photo chosen is left exactly as it was', () => {
  /* The whole feature is optional. Every item that exists today was saved with
     the shared set, and nothing here may change that. */
  const save = between(itemsJs, 'saveVariantFamily: function', 'items/createFamily');
  assert.match(save, /var rowPhoto = null;/, 'rowPhoto does not default to nothing');
  assert.match(save, /rowPhoto \|\| \{\}/, 'an unchosen row does not fall through to shared');
});

test('a photo removed after being chosen is not saved as a name with no image', () => {
  /* Otherwise the variant comes back with a broken picture rather than none. */
  const save = between(itemsJs, 'saveVariantFamily: function', 'items/createFamily');
  assert.match(save, /\$\.grep\(PosnicPro\.items\.imageParams/, 'the choice is trusted blindly');
  assert.match(save, /if \(found\.length\)/, 'a missing photo is not checked for');
});

test('the strips repaint when photos are added or removed', () => {
  const calls = itemsJs.split('PosnicPro.items.renderVariantPhotoPickers()').length - 1;
  assert.ok(calls >= 4, `repainted from ${calls} place(s), expected at least 4`);
});

test('a base64 photo is given a real mime type', () => {
  /* A data: URL with no usable type renders as a broken image - browsers do
     not sniff it. */
  const fn = blockAt(itemsJs, 'photoSrc: function');
  assert.match(fn, /data:image\//);
  assert.match(fn, /jpeg/, 'jpg is not mapped to its real mime type');
});

test('the chosen photo is marked by more than a border colour', () => {
  /* A border alone vanishes on a bright screen, and the wrong choice is not
     visible again until the item is saved and sitting on the sale grid. */
  const rule = cssRule('.items-variant-photo.is-chosen');
  assert.match(rule, /box-shadow/, 'the chosen photo has no ring');
  assert.match(rule, /opacity/, 'the chosen photo is not distinguished by opacity');
});

test('the picker reads as clickable and keeps keyboard focus visible', () => {
  assert.match(cssRule('.items-variant-photo {'), /cursor:\s*pointer/);
  assert.match(cssRule('.items-variant-photo:focus-visible'), /outline/);
});

/* ------------------------------------------------------------------ *
 * Rebuilding the rows does not throw away what was typed
 * ------------------------------------------------------------------ */

test('what was typed into the rows survives adding another value', () => {
  /*
   * loadVariant empties #load_price_fields and rebuilds it on every change to
   * the value lists. Adding a ninth size after pricing eight discarded all
   * eight prices, the SKUs, the barcodes and the quantities - the form reset
   * itself at the exact moment you were extending it.
   */
  const load = blockAt(itemsJs, 'loadVariant: function');
  const snapAt = load.indexOf('snapshotVariantRows()');
  const wipeAt = load.indexOf(".html('')");
  assert.notStrictEqual(snapAt, -1, 'nothing is snapshotted before the rebuild');
  assert.ok(snapAt < wipeAt, 'the snapshot is taken after the rows are already gone');
  assert.match(load, /restoreVariantRows\(/, 'nothing is restored after the rebuild');
});

test('rows are preserved by variant value, never by position', () => {
  /*
   * Removing '40' from the middle shifts every later row up one. Restoring by
   * index would hand '42' the price typed for '44' - worse than losing it,
   * because a wrong price looks exactly like a right one.
   */
  for (const marker of ['snapshotVariantRows: function', 'restoreVariantRows: function']) {
    const fn = blockAt(itemsJs, marker);
    assert.match(fn, /data-variant-value/, `${marker} does not key on the variant value`);
  }
});

test('the restore covers every field a row holds, including the photo', () => {
  const fn = blockAt(itemsJs, 'restoreVariantRows: function');
  for (const field of [
    'items_itemid_',
    'items_barcodeid_',
    'items_company_price_',
    'items_mrp_price_',
    'items_selling_price_',
    'items_available_quantity_',
    'items_sort_',
    'items_discount_amount_',
    'items_discount_percentage_',
    'items_photo_',
  ]) {
    assert.ok(fn.includes(field), `${field} is snapshotted but never restored`);
  }
});

test('the unit is restored once its own list has arrived', () => {
  /* The unit select is filled by a per-row request that lands after the rows
     are built, so setting it during the restore would select nothing. */
  const load = blockAt(itemsJs, 'loadVariant: function');
  assert.match(load, /wasRow && wasRow\.unit/, 'the unit is never restored');
  const restore = blockAt(itemsJs, 'restoreVariantRows: function');
  assert.doesNotMatch(
    restore,
    /put\('#items_unit_/,
    'the unit is set during the restore, when its list is still empty',
  );
});

test('the photo choice is restored before the strips are painted', () => {
  /* Painted first, the strip reads an empty hidden input and shows nothing as
     chosen - the choice is kept but looks lost, which is its own bug report. */
  const load = blockAt(itemsJs, 'loadVariant: function');
  const restoreAt = load.indexOf('restoreVariantRows(');
  const paintAt = load.indexOf('renderVariantPhotoPickers()');
  assert.notStrictEqual(restoreAt, -1, 'no restore in loadVariant');
  assert.notStrictEqual(paintAt, -1, 'no strip paint in loadVariant');
  assert.ok(restoreAt < paintAt, 'the strips paint before the choice is restored');
});
