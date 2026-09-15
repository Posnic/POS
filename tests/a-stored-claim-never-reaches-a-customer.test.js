'use strict';

/*
 * The derivation is only honest if there is no OTHER way out.
 *
 * A sibling test proves that claimsFor refuses to invent a badge. That is the
 * rule. This file guards the plumbing around it, because the rule survives
 * exactly as long as nobody adds a second path.
 *
 * There are three ways it could quietly collapse:
 *
 *   1. The write path stops filtering, and `heart_healthy` is simply stored
 *      in food_tags because a client asked nicely. The derivation still runs
 *      and is still correct, and the badge appears anyway.
 *
 *   2. A read path forwards the raw stored document. `food_tags` goes out
 *      beside the derived list and a page renders whichever it finds first.
 *
 *   3. A new customer-facing read is added that never calls factsFor, so the
 *      dish arrives with no badges at all, or with raw ones.
 *
 * None of those is visible from behaviour in a unit test - they are all
 * "somebody edits this file later". So this reads the repository source and
 * holds the shape. A structural test for a structural promise.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', 'api', 'src', 'repositories', 'item.repository.js');
const source = fs.readFileSync(REPO, 'utf8');

const facts = require('../api/src/utils/dish-facts');

test('the write path cleans all three fields rather than trusting them', () => {
  /*
   * Each has its own way of going wrong. Nutrition must drop anything that is
   * not a number, so "about 300" is not-said rather than stored. The two tag
   * arrays must be filtered against their own lists, which is what stops a
   * claim being stored under the name of a fact.
   */
  assert.match(source, /nutrition: dishFacts\.cleanNutrition\(data\.nutrition\)/);
  assert.match(source, /food_tags: dishFacts\.cleanTags\(data\.food_tags, dishFacts\.FOOD_TAGS\)/);
  assert.match(source, /menu_marks: dishFacts\.cleanTags\(data\.menu_marks, dishFacts\.MENU_MARKS\)/);
});

test('both customer-facing reads derive the claims', () => {
  /*
   * Two paths reach a customer and they are different code: the public menu
   * builds rows in a loop, the ordering storefront maps over an aggregation.
   * A dish that shows badges on one and not the other is the bug this
   * catches, and it is the exact bug that shipped when diet and prep_minutes
   * were added to the menu and not to the storefront.
   */
  const derivations = source.match(/dishFacts\.factsFor\(/g) || [];
  assert.ok(
    derivations.length >= 2,
    `expected both customer reads to derive facts, found ${derivations.length}`
  );
});

test('the storefront strips the raw fields before sending the derived ones', () => {
  /*
   * The aggregation has to carry nutrition and the tag arrays through the
   * $group to reach the mapping step, so for one moment they are on the
   * object that is about to go out. They must be destructured away in the
   * same statement that spreads the rest, or the derived list and the raw
   * list travel together and a page picks one.
   */
  /*
   * Asked by NAME, not by one spelling of the line.
   *
   * This assertion has now been wrong twice for the same reason. It began as a
   * regex requiring `...rest } = item;` on a single line, which stopped
   * matching the moment prettier wrapped the destructure; that was patched by
   * making the whitespace flexible, which fixed the formatting problem and
   * left a real one behind. The regex only ever NAMED three of the four raw
   * fields, so deleting nutrition_source from the destructure passed it.
   *
   * That is not a hypothetical. nutrition_source is the flag saying the
   * figures were ESTIMATED rather than entered by the shop - it is an input to
   * what may honestly be claimed, and if it travels raw beside the derived
   * list then the exact thing the comment above warns about has happened: the
   * two lists travel together and a page picks one.
   *
   * Checked by removing that field and watching this go red. A guard for a
   * list of fields has to read the list.
   */
  const at = source.indexOf('multi_image,');
  assert.ok(at !== -1, 'the storefront no longer destructures the outgoing item');
  const destructure = source.slice(at, source.indexOf('} = item;', at));

  for (const raw of ['nutrition', 'nutrition_source', 'food_tags', 'menu_marks']) {
    assert.ok(
      destructure.split(/[\s,]+/).includes(raw),
      `${raw} still travels raw beside the derived list`
    );
  }
  assert.match(destructure, /\.\.\.rest/, 'nothing is spread on, so nothing is sent');
});

test('no claim key is anywhere in the tickable lists', () => {
  /*
   * The list-level version of the same promise, stated once here so that
   * adding a badge to FOOD_TAGS because it "fits with the others" fails
   * loudly. Every one of these is regulated language somewhere.
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

  const tickable = [...facts.FOOD_TAGS, ...facts.MENU_MARKS];
  for (const claim of claims) {
    assert.ok(!tickable.includes(claim), `${claim} is derived and must never be tickable`);
  }

  /* And the reverse direction: every claim this file names is one the engine
     can actually produce, so the list above cannot rot into a list of words
     that mean nothing. */
  const everyClaim = new Set();
  const dishes = [
    { kcal: 280, protein_g: 38, carbs_g: 6, fat_g: 4, sat_fat_g: 1, fibre_g: 3, sugar_g: 2, sodium_mg: 300 },
    { kcal: 600, protein_g: 22, carbs_g: 90, fibre_g: 22 },
    { kcal: 430, protein_g: 5, carbs_g: 40, fibre_g: 1, sugar_g: 1 },
  ];
  for (const dish of dishes) for (const c of facts.claimsFor(dish, [])) everyClaim.add(c);
  for (const claim of claims) {
    assert.ok(everyClaim.has(claim), `${claim} is named here but the engine never produces it`);
  }
});
