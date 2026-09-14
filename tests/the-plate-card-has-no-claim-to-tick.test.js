'use strict';

/*
 * The item screen may collect facts. It may not offer a claim.
 *
 * Owner: "impelement all of stuff easily tick of these" - and then, about the
 * health words in the same list: "tags such as 'diabetic friendly,' 'heart
 * healthy,' 'keto,' or exact calorie numbers should only be shown when the
 * recipe/nutrition actually supports the claim."
 *
 * Both sentences are satisfied on this screen and they pull in opposite
 * directions, so the thing to guard is the seam. Everything IS a tick box,
 * except the eleven words that are regulated language about food - those are
 * an output strip at the bottom of the card that redraws from the numbers.
 *
 * The failure this file is built to catch is somebody looking at that strip,
 * thinking "these should be tick boxes like the rest", and making them so.
 * Nothing would break. The screen would look more consistent. And a shop
 * would be able to badge a dish "Diabetic friendly" without entering a single
 * number.
 *
 * The second half of the file watches the plumbing: a field that saves but
 * never loads back is the ordinary bug on a form this size, and it presents
 * as "my nutrition keeps disappearing" long after the release that caused it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
const ITEMS = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
  'utf8'
);

const facts = require('../api/src/utils/dish-facts');

/* Just the plate card, so a control elsewhere on a long form cannot satisfy
   or break an assertion about this one. */
function plateCard() {
  const at = HTML.indexOf('id="item_plate_card"');
  assert.ok(at > -1, 'the plate card is not on the item screen');
  /* Back up to the <div that opens the card: the classes that gate it sit
     BEFORE the id, so a slice starting at the id cannot see them. */
  const open = HTML.lastIndexOf('<div', at);
  const next = HTML.indexOf('<div class="card ', at);
  return HTML.slice(open, next === -1 ? HTML.length : next);
}

test('every nutrient the engine reads has a box on the screen', () => {
  /*
   * A nutrient the engine uses and the screen never collects is a claim that
   * can never be earned - "heart healthy" was exactly that until sodium got
   * a box. Nothing fails; the badge simply never appears, anywhere, for any
   * dish, and no screen shows you why.
   */
  const card = plateCard();
  for (const key of facts.NUTRIENTS) {
    assert.ok(
      card.includes(`data-nutrient="${key}"`),
      `${key} is used to derive claims but has no input on the item screen`
    );
  }
});

test('every tickable tag and mark is on the screen, and nothing else is', () => {
  const card = plateCard();

  for (const tag of facts.FOOD_TAGS) {
    assert.ok(card.includes(`class="item-food-tag" value="${tag}"`), `${tag} has no pill`);
  }
  for (const mark of facts.MENU_MARKS) {
    assert.ok(card.includes(`class="item-menu-mark" value="${mark}"`), `${mark} has no pill`);
  }

  /* And the count matches, so a pill for something the write path will throw
     away cannot sit on the screen looking like it works. */
  const tagPills = (card.match(/class="item-food-tag" value="/g) || []).length;
  const markPills = (card.match(/class="item-menu-mark" value="/g) || []).length;
  assert.strictEqual(tagPills, facts.FOOD_TAGS.length);
  assert.strictEqual(markPills, facts.MENU_MARKS.length);
});

test('not one health claim is an input anywhere on the item screen', () => {
  /*
   * THE ONE THAT MATTERS. Every claim key the engine can produce, checked
   * against every control on the whole form - not just this card, because
   * the tempting place to add "Heart healthy" is next to the diet dot.
   */
  const claims = [
    'high_protein',
    'protein_source',
    'low_fat',
    'high_fibre',
    'keto_friendly',
    'low_carb',
    'diabetic_friendly',
    'heart_healthy',
    'under_300',
    'under_500',
  ];

  const controls = HTML.match(/<(input|select|textarea)\b[^>]*>/g) || [];
  for (const claim of claims) {
    for (const control of controls) {
      assert.ok(
        !control.includes(claim),
        `"${claim}" is a derived claim and must never be an input: ${control.trim()}`
      );
    }
  }
});

test('the earned strip is an output: nothing in it can be clicked', () => {
  const card = plateCard();
  const start = card.indexOf('id="item_plate_earned"');
  assert.ok(start > -1, 'the earned strip is missing');
  const strip = card.slice(start, card.indexOf('</div>', card.indexOf('item_plate_earned_list')));

  assert.ok(!/<input/.test(strip), 'the earned strip must contain no inputs');
  assert.ok(!/<button/.test(strip), 'the earned strip must contain no buttons');
  assert.ok(!/onclick/.test(strip), 'the earned strip must not be clickable');
});

test('the card is restaurant only, like the one above it', () => {
  /* A hardware store should not be asked for the saturated fat of a hinge. */
  const card = plateCard();
  assert.match(card.slice(0, 200), /restaurant-only/);
});

test('what saves also loads, on both paths', () => {
  /*
   * There are two save sites on this form and two load sites, which is how
   * a field comes to save on one screen and not the other. All four go
   * through one helper each so the four cannot drift.
   */
  const saves = (ITEMS.match(/PosnicPro\.itemPlate\.payload\(\)\.nutrition/g) || []).length;
  assert.strictEqual(saves, 2, 'both save paths must send the plate');

  const loads = (ITEMS.match(/PosnicPro\.itemPlate\.set\(data\)/g) || []).length;
  assert.strictEqual(loads, 2, 'both load paths must fill the plate');

  /* And a fresh form is emptied, or the last dish edited leaves its
     nutrition sitting in the boxes of the next one - which would be saved,
     silently, onto a different dish. */
  assert.match(ITEMS, /showAdd: function \(\)[\s\S]{0,400}PosnicPro\.itemPlate\.clear\(\)/);
});

test('an empty box is not a zero, in either direction', () => {
  /*
   * The whole honesty of the feature rests on absent meaning "not said". If
   * the form read an empty box as 0 on save, every unfilled dish would claim
   * no sugar, no fat and no calories. If it wrote 0 into an empty box on
   * load, the shop would see a measured-looking zero it never entered.
   */
  const read = ITEMS.slice(ITEMS.indexOf('nutrition: function ()'));
  assert.match(read.slice(0, 400), /if \(raw === ''\) \{ return; \}/);

  const write = ITEMS.slice(ITEMS.indexOf('set: function (data)'));
  assert.match(write.slice(0, 500), /undefined \|\| n\[key\] === null \? '' :/);
});

test('the assistant never types over a number a person entered', () => {
  /*
   * An estimate that overwrites a figure the kitchen measured is the one
   * outcome here worse than having no button at all: the shop would have to
   * check every box after every press to find out what it had lost.
   */
  const ask = ITEMS.slice(ITEMS.indexOf('ask: function ()'));
  assert.match(
    ask.slice(0, 3000),
    /if \(String\(\$\(this\)\.val\(\) \|\| ''\)\.trim\(\) !== ''\) \{ return; \}/,
    'the estimate must skip any box that is already filled in'
  );
});
