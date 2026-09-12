'use strict';

/*
 * Restaurant questions live in a restaurant section, and only a restaurant
 * sees it.
 *
 * Serving periods, the kitchen ticket and the diet mark sat among the stock
 * and channel flags on every shop's item form, so a hardware store editing a
 * hinge read "Note for the kitchen" and "Diet". Owner: do not show
 * restaurant-specific inputs to every business; give them their own section
 * when the Restaurant module is on.
 *
 * They now sit in one card that carries the one switch, table_options - the
 * same switch that shows the KOT report and the Restaurant settings page.
 * The fields inside carry no switch of their own, so there is exactly one
 * place this can go wrong, and this file watches it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');

const RESTAURANT = ['item_dayparts', 'item_diet', 'item_prep_minutes', 'item_prep_note'];
const EVERY_SHOP = ['item_track_inventory', 'item_ecommerce', 'item_show_on_menu', 'item_channel_off', 'item_negative_stock'];

/* A card's markup, from its opening div to the balanced close. */
function cardOf(marker) {
  const at = HTML.indexOf(marker);
  assert.notStrictEqual(at, -1, `${marker} is not on the form`);
  /* the exact card class: '<div class="card' alone also matches the
     card-header inside it, and measures the header instead of the card */
  const open = HTML.lastIndexOf('<div class="card m-b-30', at);
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(HTML))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return HTML.slice(open, m.index + 6);
  }
  assert.fail(`${marker}'s card never closes`);
}

const restaurantCard = cardOf('id="item_restaurant_card"');
const extrasCard = cardOf('data-target="#item_extras_collapse"');

test('the restaurant questions are together, in their own card', () => {
  for (const id of RESTAURANT) {
    assert.ok(restaurantCard.includes(`id="${id}"`), `#${id} is not in the Restaurant card`);
    assert.ok(!extrasCard.includes(`id="${id}"`), `#${id} is still among the flags every shop sees`);
  }
  assert.match(restaurantCard, /class="lang_item_restaurant_title"/, 'the card has no heading');
});

test('the questions every shop answers stayed where they were', () => {
  for (const id of EVERY_SHOP) {
    assert.ok(extrasCard.includes(`id="${id}"`), `#${id} left Channels & extras`);
    assert.ok(!restaurantCard.includes(`id="${id}"`), `#${id} was moved into the Restaurant card`);
  }
});

test('one switch, on the card, and it is the Restaurant module', () => {
  assert.match(restaurantCard, /^<div class="card m-b-30 restaurant-only"/, 'the card does not follow the Restaurant switch');
  /* the fields inside must not carry their own, or a future edit toggles one
     and not the other */
  const inner = restaurantCard.slice(restaurantCard.indexOf('>') + 1);
  assert.ok(!inner.includes('restaurant-only'), 'a field inside the card carries its own switch');
  assert.match(CORE, /\$\('\.restaurant-only'\)\.toggle\(PosnicPro\.local\.get\('table_options'\) === 'enable'\)/,
    'nothing toggles restaurant-only on the Restaurant module');
});

test('every moved field still sits in a column', () => {
  for (const id of RESTAURANT) {
    const before = restaurantCard.slice(0, restaurantCard.indexOf(`id="${id}"`));
    const col = [...before.matchAll(/class="form-group col-md-\d+"/g)].pop();
    assert.ok(col, `#${id} sits in no column`);
  }
});

test('the card opens by default, like its neighbours', () => {
  assert.match(restaurantCard, /class="collapse show" id="item_restaurant_collapse"/);
  assert.match(restaurantCard, /data-target="#item_restaurant_collapse"/);
});
