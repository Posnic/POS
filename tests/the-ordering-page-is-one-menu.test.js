'use strict';

/*
 * The page a guest orders from shows the whole menu, grouped.
 *
 * Owner: "/menu/ is not same as /order/table/123 coz inside there is not menu
 * button. thats actually good. its grouping the menu and easy to navigate.
 * add it here too."
 *
 * Driving both pages showed it was worse than a missing button. The public
 * menu drew fourteen sections and every dish in the shop. The page people
 * actually ORDER from drew one category at a time, opening on whichever
 * sorted first - so a guest at table 34 of a restaurant opened it, read
 * "32 dishes", and saw a single A5 ruled notebook with 85% of the screen
 * blank. The food was behind a chip strip whose second chip was already cut
 * off by the edge of the phone.
 *
 * After: fourteen sections, thirty-two cards, same page, same request.
 *
 * What this file guards is the thing that made it possible to ship the bug in
 * the first place: none of it fails. A page showing one category out of
 * fourteen renders perfectly, throws nothing, and passes every test that asks
 * whether a card is drawn correctly. The only way to catch it is to assert
 * that the page draws SECTIONS, and that a chip moves you rather than
 * replacing what you are looking at.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ORDER = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'order.css'), 'utf8');

test('the menu is drawn as sections, not as one chosen category', () => {
  assert.match(ORDER, /async function renderWholeMenu\(/);
  assert.match(ORDER, /class="menu-section"/);
  assert.match(ORDER, /class="menu-section-name"/);

  /* Every section, every time. The old shape read one key out of `products`
     and drew that; if anything ever narrows this back down to a single
     section the page is a set of small pages again. */
  assert.match(ORDER, /Object\.keys\(products\)\.map\(/);
});

test('a chip jumps to a section instead of replacing the page', () => {
  const show = ORDER.slice(ORDER.indexOf('async function showCategory('));
  const body = show.slice(0, show.indexOf('\n}\n') + 3);

  assert.match(body, /scrollIntoView/, 'a chip must move the page, not redraw it');
  assert.ok(
    !/renderProductCards|renderWholeMenu/.test(body),
    'tapping a chip must not redraw anything: the section is already on the page'
  );
});

test('a heading jumped to does not land under the sticky header', () => {
  /*
   * The whole navigation is chips that jump to headings. A heading that
   * arrives hidden behind the header is a jump that looks like it did
   * nothing, which is the one failure that would make people stop using it.
   */
  const section = CSS.slice(CSS.indexOf('.menu-section {'));
  assert.match(section.slice(0, 200), /scroll-margin-top:\s*\d+px/);
});

test('the chip strip follows the scroll, in both the strip and the rail', () => {
  /*
   * Chips that jump but never answer back are lying about where you are
   * after the first scroll. One observer feeds both lists, so the phone
   * strip and the wide-screen rail cannot disagree.
   */
  assert.match(ORDER, /function watchSections\(/);
  assert.match(ORDER, /new IntersectionObserver\(/);
  assert.match(ORDER, /function lightChip\(/);

  /* And it is rebuilt whenever the sections are, or it is watching elements
     that were thrown away by the last filter change. */
  const render = ORDER.slice(ORDER.indexOf('async function renderWholeMenu('));
  assert.match(render.slice(0, 2000), /watchSections\(\)/);
});

test('searching still answers with a flat list', () => {
  /*
   * A search spans the whole menu, so the answer is not a place in it.
   * Somebody who typed "biryani" asked the restaurant a question; dressing
   * the answer in section headings would be answering a different one.
   */
  const refresh = ORDER.slice(ORDER.indexOf('async function refreshProductView('));
  const body = refresh.slice(0, 3000);
  assert.match(body, /if \(searching\) \{[\s\S]{0,200}renderProductCards\(/);
  assert.match(body, /\} else \{[\s\S]{0,600}renderWholeMenu\(/);
});

test('a section filtered down to nothing keeps neither heading nor chip', () => {
  /*
   * "Veg only" on a menu with no vegetarian starters must not leave a
   * Starters heading with nothing under it, nor a chip that jumps to it.
   */
  const render = ORDER.slice(ORDER.indexOf('async function renderWholeMenu('));
  assert.match(render.slice(0, 1200), /\.filter\(s => \(s\.items \|\| \[\]\)\.length\)/);

  const refresh = ORDER.slice(ORDER.indexOf('async function refreshProductView('));
  assert.match(refresh.slice(0, 3000), /alive\.has\(/);
});

test('the card carries at most two badges, and never one it invented', () => {
  /*
   * A dish can be a chef's pick, high protein, low carb, keto, under 300
   * kcal, gluten free and ready in ten minutes. A card carrying all seven is
   * a nutrition label with a price on it. Owner: "not too annoying make it
   * very very professional and neat."
   */
  const badges = ORDER.slice(ORDER.indexOf('function badgesFor('));
  assert.match(badges.slice(0, 800), /\.slice\(0, 2\)/);

  /*
   * And every badge comes from what the SERVER sent. This page holds a
   * dictionary of words, never a rule: the claims are derived by
   * utils/dish-facts.js from the shop's own numbers, so nothing here can
   * put "Heart healthy" on a dish that did not earn it.
   */
  assert.match(badges.slice(0, 800), /product\.claims/);
  assert.match(badges.slice(0, 800), /product\.marks/);
  assert.ok(
    !/kcal\s*[<>]=?|protein_g|sat_fat_g/.test(badges.slice(0, 800)),
    'the ordering page must not decide a health claim for itself'
  );
});

test('calories are shown only when the kitchen entered them', () => {
  /*
   * Nothing on a customer's screen may estimate. An unentered calorie count
   * is absent, not zero, and "0 kcal" on a biryani is worse than silence.
   */
  const card = ORDER.slice(ORDER.indexOf('function cardHtml('));
  assert.match(card.slice(0, 4000), /if \(kcal > 0\) meta\.push/);
});

test('the menu button is the contents page, and only when it earns its place', () => {
  /*
   * Owner named this: "coz inside there is not menu button. thats actually
   * good. its grouping the menu and easy to navigate. add it here too."
   *
   * A chip strip is fine for five sections and real work for twenty-nine.
   * The live shop runs Soup, Starters Veg, Salad, Prawn Starters, Squid
   * Starters, Crab Starters - and a guest who wants dessert is swiping a
   * chip at a time to find out what the place even has.
   */
  const HTML = fs.readFileSync(path.join(ROOT, 'order', 'products.html'), 'utf8');
  assert.match(HTML, /id="menu-index-btn"/);
  assert.match(HTML, /<dialog id="menu-index"/);

  /* Hidden for a menu short enough to read without it: a contents page for
     three headings already on the screen is a control that exists to be
     ignored, and this screen cannot afford another one. */
  assert.match(ORDER, /var INDEX_WORTH_IT = \d+;/);
  assert.match(ORDER, /button\.hidden = worth\.length < INDEX_WORTH_IT/);

  /* It lists what is actually drawn, so a section filtered away by "Veg
     only" is not offered - an index that jumps to nothing is worse than
     no index. */
  const fill = ORDER.slice(ORDER.indexOf('function fillMenuIndex('));
  assert.match(fill.slice(0, 900), /\.filter\(function \(s\) \{ return \(s\.items \|\| \[\]\)\.length; \}\)/);
});

test('a row in the index closes the sheet before it jumps', () => {
  /*
   * A dialog still open while the page scrolls under it means the guest
   * watches nothing happen and taps again, landing somewhere else.
   */
  const row = ORDER.slice(ORDER.indexOf('$(document).on("click", ".menu-index-row"'));
  const body = row.slice(0, 400);
  assert.ok(
    body.indexOf('closeMenuIndex()') < body.indexOf('showCategory('),
    'close the sheet first, then jump'
  );
});

test('the last section is lit at the bottom, where it can never win the band', () => {
  /*
   * The bug this caught, found by tapping the button rather than reading
   * the code: the trigger line sits under the header and the page runs out
   * of scroll before the last heading can reach it. Tapping "Desserts"
   * scrolled correctly to the desserts, filled the screen with them, and
   * left "Drinks" lit - so a guest who asked for desserts and got desserts
   * is told they are in Drinks, and concludes the button is broken.
   */
  assert.match(ORDER, /function atTheBottom\(/);
  assert.match(ORDER, /function lightLastSection\(/);

  /* Checked before the observer's own answer, or the observer wins. */
  const watch = ORDER.slice(ORDER.indexOf('sectionWatcher = new IntersectionObserver('));
  assert.match(watch.slice(0, 400), /if \(atTheBottom\(\)\) return lightLastSection\(\);/);

  /* And on an ordinary scroll to the end, not only on a jump. */
  assert.match(ORDER, /addEventListener\("scroll", onScrollEnd/);
});
