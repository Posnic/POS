/*
 * The Kiosk column appears only where there is a kiosk.
 *
 * The Item List carried a Kiosk toggle on every row for every shop. Most shops
 * do not run a kiosk, so for them it was a switch that did nothing anybody
 * could see, taking width from Quantity and Price on the page staff are in all
 * day.
 *
 * "Has a kiosk" means a store id has been entered in Kiosk Settings. That is
 * the one field required before a kiosk can identify itself; images, payment
 * and print all have defaults, so a branch with settings but no store id is
 * still a branch with no kiosk.
 *
 * The decision is the server's. A cached setting would not do: the cache is
 * only written when the Settings page is opened, so a till that never visited
 * Settings would have to guess, and guessing wrong either hides a control a
 * kiosk shop needs or shows one nobody can use.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

/* ---- what the server decides ----------------------------------------- */

/* The rule is a pure predicate over a branch document, so it is tested as one.
   The controller's job around it - look the branch up, fall back to false if
   that fails - is asserted from the source below. */
const { isKioskConfigured } = require('../api/src/utils/kiosk');

test('a store id means the branch runs a kiosk', () => {
  assert.strictEqual(isKioskConfigured({ kiosk: [{ store_id: 'GOA-01' }] }), true);
});

test('no kiosk settings at all means no kiosk', () => {
  assert.strictEqual(isKioskConfigured({ kiosk: [] }), false);
  assert.strictEqual(isKioskConfigured({}), false);
  assert.strictEqual(isKioskConfigured(null), false);
  assert.strictEqual(isKioskConfigured(undefined), false);
});

test('kiosk settings saved without a store id still means no kiosk', () => {
  /* The branch document gets a kiosk entry the moment any kiosk image or
     payment option is saved. Its presence is not the question - a kiosk with
     no store id cannot identify itself, so there is nothing to toggle for. */
  assert.strictEqual(
    isKioskConfigured({ kiosk: [{ logo: 'a.png', payment_cod: true }] }), false);
});

test('a store id of spaces is not a store id', () => {
  assert.strictEqual(isKioskConfigured({ kiosk: [{ store_id: '   ' }] }), false);
  assert.strictEqual(isKioskConfigured({ kiosk: [{ store_id: '' }] }), false);
  assert.strictEqual(isKioskConfigured({ kiosk: [{ store_id: null }] }), false);
});

test('a store id that is not a string still counts', () => {
  /* Entered through a numeric field, or restored from a backup that typed it
     differently. It identifies the kiosk either way. */
  assert.strictEqual(isKioskConfigured({ kiosk: [{ store_id: 4021 }] }), true);
});

test('a branch that cannot be read hides the column rather than failing', () => {
  /* Hiding an optional column from a shop that might have wanted it is a far
     smaller harm than a failed list of items. */
  const src = fs.readFileSync(
    path.join(ROOT, 'api/src/controllers/items.controller.js'), 'utf8');
  const fn = src.slice(src.indexOf('async isKioskConfigured(branchId)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));

  assert.match(body, /if \(!branchId\) return false/,
    'no branch means no kiosk, without a lookup');
  assert.match(body, /catch[\s\S]*return false/,
    'a failed branch lookup must hide the column, not break the list');
});

/* ---- and what the page does with it ----------------------------------- */

const ITEMS_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/static/script/js/modules/js/items.js'), 'utf8');
const CORE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/static/script/js/core/PosnicPro.js'), 'utf8');

test('the list sends its answer to the page', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'api/src/controllers/items.controller.js'), 'utf8');
  assert.match(src, /kiosk_configured:\s*await this\.isKioskConfigured\(branchId\)/,
    'GET /items must tell the page whether this branch has a kiosk');
});

test('header and cells carry the same marker', () => {
  /* Hiding one without the other leaves a column of headers over the wrong
     cells, which is worse than the column that was there before. The list
     moved to the master-detail standard (2026-08-27): loadList writes its
     own header, so both markers live in items.js now. */
  assert.match(ITEMS_JS, /<th class="text-center kiosk-column">Kiosk<\/th>/,
    'the Kiosk header is not marked');
  assert.match(ITEMS_JS, /<td class="text-center kiosk-column">/,
    'the Kiosk cell is not marked');
});

test('the page hides the column when the server says there is no kiosk', () => {
  assert.match(ITEMS_JS, /if \(response\.data\.kiosk_configured\)[\s\S]{0,120}\$\('\.kiosk-column'\)\.show\(\)/);
  assert.match(ITEMS_JS, /else \{[\s\S]{0,60}\$\('\.kiosk-column'\)\.hide\(\)/);
});

test('the header exists before the answer arrives', () => {
  /* loadList writes the header in the same render that toggles the column;
     the toggle must come AFTER the rows land in the DOM. */
  const headerAt = ITEMS_JS.indexOf('kiosk-column">Kiosk');
  const renderAt = ITEMS_JS.indexOf("$('#items_list_rows').html(html)");
  const toggleAt = ITEMS_JS.indexOf("$('.kiosk-column')");
  assert.ok(headerAt > -1, 'the item table header is no longer written here');
  assert.ok(renderAt > -1 && renderAt < toggleAt,
    'the Kiosk column is toggled before its header is in the DOM');
});
