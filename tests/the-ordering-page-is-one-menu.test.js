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

/* ------------------------------------------------------------ the filters */

test('a filter is offered only where this menu can answer it', () => {
  /*
   * Owner: "very user friend ux and advanced options to choose", and in the
   * same breath "filter options. not too annoying make it very very
   * professional and neat."
   *
   * Those are usually a trade and here they are not, because the honest
   * version is also the smaller one. A filter appears only when at least one
   * dish on THIS menu carries it, with the count beside it - so a shop that
   * has entered no nutrition sees no health filters at all, rather than a
   * sheet full of controls that can only ever return nothing.
   *
   * The count is what makes the list self-explaining: "Gluten free 4" says
   * both what the filter does and what it is worth, and a guest who ticks it
   * cannot be surprised by the result.
   */
  assert.match(ORDER, /function countBy\(/);

  const group = ORDER.slice(ORDER.indexOf('function filterGroupHtml('));
  assert.match(
    group.slice(0, 1200),
    /\.filter\(function \(k\) \{ return counts\[k\]; \}\)/,
    'an option with no dish behind it must not be offered'
  );
  assert.match(group.slice(0, 1200), /if \(!keys\.length\) return "";/, 'an empty group draws nothing');
});

test('within a group any, across groups all', () => {
  /*
   * Somebody who ticks "Gluten free" and "Nut free" needs BOTH true of the
   * same dish: those are things they cannot eat, and a dish satisfying one
   * of them is not an answer. Getting this backwards is the difference
   * between a filter and a hazard.
   */
  const list = ORDER.slice(ORDER.indexOf('function orderViewList('));
  const body = list.slice(0, 3000);
  assert.match(body, /orderView\.tags\.every\(/);
  assert.match(body, /orderView\.claims\.every\(/);
});

test('the filter reads the claim, it does not recompute it', () => {
  /*
   * The claims were decided on the server from the shop's own numbers. If
   * this page worked one out for itself it could disagree with the badge on
   * the card it just hid, and there would be no way to tell which was right.
   */
  const list = ORDER.slice(ORDER.indexOf('function orderViewList('));
  const body = list.slice(0, 3000);
  assert.match(body, /Array\.isArray\(p\.claims\) \? p\.claims : \[\]/);
  assert.ok(
    !/protein_g|sat_fat_g|sodium_mg/.test(body),
    'the filter must not derive a claim of its own'
  );
});

test('a narrowed menu says so on the button', () => {
  /*
   * The risk of a filter is forgetting it is on and deciding the kitchen has
   * run out of food. The count on the button is the standing reminder.
   */
  const HTML = fs.readFileSync(path.join(ROOT, 'order', 'products.html'), 'utf8');
  assert.match(HTML, /id="order-filter-count"/);
  assert.match(ORDER, /badge\.hidden = chosen === 0;/);

  /* And the result line counts these as a narrowing, not just search. */
  const refresh = ORDER.slice(ORDER.indexOf('async function refreshProductView('));
  assert.match(refresh.slice(0, 4000), /orderView\.tags\.length > 0 \|\| orderView\.claims\.length > 0/);
});

test('sorting moved into the sheet, and took nothing dead with it', () => {
  /*
   * Sort had a seat beside the sections. Once the Filters button arrived
   * beside it the two together left room for one chip and the first letter
   * of the next - the strip a customer steers with, squeezed out by two
   * controls they touch once.
   *
   * The trap in moving it: the retail wording read '#order-sort option',
   * which now matches nothing and would fail silently, quietly telling a
   * stationer "Menu order" forever.
   */
  const HTML = fs.readFileSync(path.join(ROOT, 'order', 'products.html'), 'utf8');
  assert.ok(!/<select id="order-sort"/.test(HTML), 'the sort select is gone from the row');
  assert.match(HTML, /id="filters-sort"/);
  assert.match(ORDER, /#filters-sort input\[value="menu"\] \+ span/);
});

test('columns are counted off the grid, never off the viewport', () => {
  /*
   * OWNER, with a desktop screenshot: "design broken in desktop... decktop
   * price is behind the image."
   *
   * Two faults, one cause, and both invisible to every test here and to a
   * phone screenshot.
   *
   * `#product-list` carried the `product-grid` class itself. That was fine
   * when it held cards; once it held SECTIONS it became a two-column grid of
   * sections on a wide screen, each with a second grid inside it - so a card
   * got about 200px, and a card is a row of text beside a 96px photo. The
   * text had 68px and the photo sat on top of the name and the price.
   *
   * And the columns were counted off the VIEWPORT - two at 720px, three at
   * 1100px, two again in the desktop block. That is only ever right when the
   * grid is as wide as the window, and on a wide screen this one sits in the
   * middle of a 220px rail and a 340px order panel.
   *
   * So: the container is a plain block, and the grid fits as many columns as
   * will hold a card in the width it actually has.
   */
  const HTML = fs.readFileSync(path.join(ROOT, 'order', 'products.html'), 'utf8');
  assert.ok(
    !/class="[^"]*product-grid[^"]*"\s+id="product-list"/.test(HTML),
    'the container must not be a grid: it holds sections, each with its own'
  );
  assert.match(HTML, /<div id="product-list"><\/div>/);

  /* A flat search result brings its own grid, so a section and a search are
     laid out by the same rule one level down. */
  const flat = ORDER.slice(ORDER.indexOf('async function renderProductCards('));
  assert.match(flat.slice(0, 900), /'<div class="product-grid">'/);

  /* One rule, and it asks the width of the grid rather than of the window. */
  assert.match(CSS, /grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, \d+px\), 1fr\)\)/);
  /* Scoped to .product-grid: other grids on these pages (the kiosk attract
     screen, for one) are as wide as the window and a fixed count is right
     for them. It is this grid, inside a column, that must not have one. */
  const productGridRules = (CSS.match(/\.product-grid\s*\{[^}]*\}/g) || []).join(' ');
  assert.ok(
    !/grid-template-columns:\s*repeat\(\d+,/.test(productGridRules),
    'a fixed column count on .product-grid is what put the photo over the price'
  );
});

test('a section has a picture without anybody uploading one', () => {
  /*
   * Owner: "menu looks like shit... if possible have category image ( menu ).
   * show some image as ccategory. how many items inside."
   *
   * A category has no image field anywhere in the product, and adding one
   * would mean an upload a shop does fourteen times before this button is
   * worth pressing - so it would be empty everywhere, like every other
   * optional image. The section borrows from the food instead: the first
   * dish with a photograph, then the first emoji (which dish-icons.js gives
   * almost every dish from its name), then the section's own initial.
   *
   * The point of the ladder is that the LAST rung always works, so no tile
   * is ever blank and no tile is ever a broken image.
   */
  const pick = ORDER.slice(ORDER.indexOf('function sectionPicture('));
  const body = pick.slice(0, pick.indexOf('\n}\n') + 3);

  assert.match(body, /items\[i\]\.img/, 'a photograph is preferred');
  assert.match(body, /items\[j\]\.icon/, 'then the emoji');
  assert.match(body, /charAt\(0\)\.toUpperCase\(\)/, 'and a letter that cannot fail');

  /* Eager, unlike every other image on these pages: a contents sheet that
     opens half blank and fills in as you scroll is what looked unfinished. */
  assert.ok(!/loading="lazy"/.test(body), 'the tiles must not lazy-load');
});

test('a sheet is measured in dvh, so its bottom is reachable on a phone', () => {
  /*
   * 100vh is the LARGE viewport - the height the page would have with the
   * browser's bars hidden - so a sheet sized in vh is taller than what can
   * actually be seen and its last rows sit under the address bar. Owner:
   * "not able to scroll."
   *
   * vh stays as the line before it, for anything with no dvh.
   */
  const sheet = CSS.slice(CSS.indexOf('dialog.sheet {'));
  const rule = sheet.slice(0, sheet.indexOf('}'));
  assert.match(rule, /max-height:\s*calc\(100vh - \d+px\)/, 'the fallback is missing');
  assert.match(rule, /max-height:\s*calc\(100dvh - \d+px\)/, 'the dvh line is missing');
  assert.ok(
    rule.indexOf('100vh') < rule.indexOf('100dvh'),
    'dvh must come second or the fallback wins'
  );
  assert.match(rule, /overflow-y:\s*auto/);
});
