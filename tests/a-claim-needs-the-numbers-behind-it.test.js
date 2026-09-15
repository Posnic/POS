'use strict';

/*
 * A badge on a menu is a claim, and a claim needs the numbers behind it.
 *
 * Owner, in the middle of a long list of things he wants on a dish: "tags such
 * as 'diabetic friendly,' 'heart healthy,' 'keto,' or exact calorie numbers
 * should only be shown when the recipe/nutrition actually supports the claim."
 *
 * That single sentence is why the health badges are not a set of tick boxes.
 * Tick boxes were the obvious build - the rest of the list IS tick boxes - and
 * they would have shipped a screen where a shop in a hurry ticks "Diabetic
 * Friendly" on a dish it has never analysed, and a person managing a condition
 * reads it as advice. FSSAI, Codex and EU 1924/2006 all regulate exactly these
 * words. A tick box for them is a liability with a checkbox in front of it.
 *
 * So the split this file exists to pin:
 *
 *   the kitchen enters FACTS      - the macros, and what is in the recipe
 *   the menu shows CLAIMS         - derived from those numbers, never stored
 *
 * Every test below is a way that split could quietly collapse. The two that
 * matter most are the last two: a claim must never appear on a dish with no
 * nutrition at all, and a claim must never be storable by asking for it.
 */

const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const facts = require('../api/src/utils/dish-facts');

/* A dish good enough to earn most claims, so each test can spoil one thing. */
function grilledChicken(over) {
  return Object.assign(
    {
      kcal: 280,
      protein_g: 38,
      carbs_g: 6,
      fat_g: 11,
      sat_fat_g: 2.5,
      fibre_g: 3,
      sugar_g: 2,
      sodium_mg: 420,
    },
    over || {}
  );
}

test('a dish with no nutrition at all carries no claims', () => {
  /*
   * The one that would have put a false badge on the entire estate. Most
   * items in a three hundred item catalogue will never have nutrition
   * entered. If missing read as zero, every one of them is low fat, low
   * carb, keto and under 300 kcal - a menu full of claims about dishes
   * nobody has looked at.
   */
  assert.deepStrictEqual(facts.claimsFor({}, []), []);
  assert.deepStrictEqual(facts.claimsFor(null, []), []);
  assert.deepStrictEqual(facts.claimsFor(undefined, undefined), []);
});

test('a claim cannot be ticked into existence', () => {
  /*
   * The write path takes food tags. If a claim key were ever accepted there,
   * the whole derivation is decoration. Ask for the claims by name, as a
   * careless client or a helpful AI autofill would.
   */
  const asked = [
    'heart_healthy',
    'diabetic_friendly',
    'keto_friendly',
    'high_protein',
    'low_calorie',
    'under_300',
  ];
  assert.deepStrictEqual(facts.cleanTags(asked, facts.FOOD_TAGS), []);

  /* And none of those words is in the tickable list in the first place. */
  for (const claim of asked) {
    assert.ok(!facts.FOOD_TAGS.includes(claim), `${claim} must not be tickable`);
    assert.ok(!facts.MENU_MARKS.includes(claim), `${claim} must not be a menu mark`);
  }
});

test('high protein is twenty percent of energy, not a big-sounding number', () => {
  const lean = facts.claimsFor(grilledChicken(), []);
  assert.ok(lean.includes('high_protein'));

  /* 12 to 20 percent is a source of protein, which is a different sentence. */
  const middling = facts.claimsFor({ kcal: 600, protein_g: 22 }, []);
  assert.ok(middling.includes('protein_source'));
  assert.ok(!middling.includes('high_protein'));

  /* 30g of protein in a 1200 kcal biryani is 10 percent. Not a protein dish,
     however large the gram count looks on its own. */
  const biryani = facts.claimsFor({ kcal: 1200, protein_g: 30 }, []);
  assert.ok(!biryani.includes('high_protein'));
  assert.ok(!biryani.includes('protein_source'));
});

test('heart healthy needs the sodium, and stays silent without it', () => {
  /*
   * The claim most likely to be got wrong by guessing. Low saturated fat
   * alone is not heart healthy - a dish can be lean and still carry a day's
   * salt - which is the whole reason sodium is collected at all.
   */
  assert.ok(facts.claimsFor(grilledChicken(), []).includes('heart_healthy'));

  const salty = facts.claimsFor(grilledChicken({ sodium_mg: 1400 }), []);
  assert.ok(!salty.includes('heart_healthy'));

  const noSodium = grilledChicken();
  delete noSodium.sodium_mg;
  assert.ok(!facts.claimsFor(noSodium, []).includes('heart_healthy'));

  const buttery = facts.claimsFor(grilledChicken({ sat_fat_g: 14 }), []);
  assert.ok(!buttery.includes('heart_healthy'));
});

test('diabetic friendly reads the carbohydrate load, not the fibre', () => {
  /*
   * This test is why the rule changed. It was first written as low sugar AND
   * high fibre, which sounds right and refuses the claim to a grilled
   * chicken: six grams of carbohydrate on the plate, and not enough fibre to
   * clear a threshold borrowed from a different claim. A dish with almost no
   * carbohydrate in it is the best case there is for this reader.
   */
  assert.ok(facts.claimsFor(grilledChicken(), []).includes('diabetic_friendly'));

  const sweet = facts.claimsFor(grilledChicken({ sugar_g: 22 }), []);
  assert.ok(!sweet.includes('diabetic_friendly'));

  /* A plate of biryani is not diabetic friendly for having little sugar. */
  const biryani = facts.claimsFor({ kcal: 900, sugar_g: 4, carbs_g: 110, fibre_g: 4 }, []);
  assert.ok(!biryani.includes('diabetic_friendly'));

  /* Fibre is optional and only ever helps: without it net carbs read as the
     whole carbohydrate, which is the conservative direction. */
  const noFibre = grilledChicken();
  delete noFibre.fibre_g;
  assert.ok(facts.claimsFor(noFibre, []).includes('diabetic_friendly'));

  /* But the carbohydrate itself is not optional. Sugar alone cannot carry
     this claim, because sugar alone does not describe the load. */
  const halfKnown = grilledChicken();
  delete halfKnown.carbs_g;
  assert.ok(!facts.claimsFor(halfKnown, []).includes('diabetic_friendly'));
});

test('keto is net carbs, so fibre counts the way the diet counts it', () => {
  /* 24g carbs looks over the line until 15 of them are fibre. */
  const salad = facts.claimsFor({ kcal: 300, carbs_g: 24, fibre_g: 15 }, []);
  assert.ok(salad.includes('keto_friendly'));

  const rice = facts.claimsFor({ kcal: 300, carbs_g: 60, fibre_g: 2 }, []);
  assert.ok(!rice.includes('keto_friendly'));
  assert.ok(!rice.includes('low_carb'));
});

test('only the tighter calorie line is shown', () => {
  /* "Under 500" on a 240 kcal dish reads as a hedge, not a boast. */
  const light = facts.claimsFor({ kcal: 240 }, []);
  assert.ok(light.includes('under_300'));
  assert.ok(!light.includes('under_500'));

  const middle = facts.claimsFor({ kcal: 430 }, []);
  assert.ok(middle.includes('under_500'));

  assert.ok(!facts.claimsFor({ kcal: 900 }, []).some((c) => c.startsWith('under_')));
});

test('nonsense in the nutrition box is not said, not stored as zero', () => {
  const cleaned = facts.cleanNutrition({
    kcal: 'about three hundred',
    protein_g: -4,
    carbs_g: '',
    fat_g: null,
    sat_fat_g: 400000,
    fibre_g: '3.456',
    sugar_g: 2,
  });

  /* Only the two real numbers survive, and the decimal is kept sane. */
  assert.deepStrictEqual(cleaned, { fibre_g: 3.46, sugar_g: 2 });

  /* And a dish that entered only rubbish makes no claims from it. */
  assert.deepStrictEqual(facts.claimsFor({ kcal: 'lots', fat_g: 'none' }, []), []);
});

test('no added sugar is the kitchen speaking, and travels with the claims', () => {
  /*
   * The one badge that is a recipe fact rather than a number: nothing in the
   * macros distinguishes sugar that was added from sugar that was already in
   * the fruit. The kitchen knows, so the kitchen ticks it - but it surfaces
   * with the claims, so a menu has one list to render rather than two.
   */
  const said = facts.claimsFor({ kcal: 200 }, ['no_added_sugar']);
  assert.ok(said.includes('no_added_sugar'));
  assert.ok(!facts.claimsFor({ kcal: 200 }, []).includes('no_added_sugar'));
});

test('factsFor answers with everything a menu card needs, and nothing invented', () => {
  const card = facts.factsFor({
    nutrition: grilledChicken(),
    food_tags: ['gluten_free', 'nut_free', 'heart_healthy', 'NOT_A_TAG'],
    menu_marks: ['chefs_pick', 'signature'],
  });

  assert.deepStrictEqual(card.tags, ['gluten_free', 'nut_free']);
  assert.deepStrictEqual(card.marks, ['chefs_pick', 'signature']);
  assert.ok(card.claims.includes('heart_healthy'));
  assert.strictEqual(card.nutrition.kcal, 280);

  /* An item the shop never touched answers with four empties, not nulls, so
     nothing downstream has to guard before it iterates. */
  const bare = facts.factsFor({});
  assert.deepStrictEqual(bare, { nutrition: {}, tags: [], marks: [], claims: [] });
});

/* ------------------------------------------------- a guess earns nothing */

test('estimated numbers publish no claims and no calories', () => {
  /*
   * Until nutrition could be written in bulk this question could not arise:
   * the only way numbers reached a dish was a person typing them, or pressing
   * Estimate and then Save. Either way a person put them there.
   *
   * The moment a pass can walk three hundred dishes unattended that stops
   * being true, and an unchecked guess would start earning "Heart healthy"
   * and "Diabetic friendly" on a live menu. That is the same harm the owner
   * ruled out - "only be shown when the recipe/nutrition actually supports
   * the claim" - arriving by a door that is harder to see than a tick box.
   */
  const measured = {
    nutrition: { kcal: 280, protein_g: 38, carbs_g: 6, sat_fat_g: 2.5, sodium_mg: 420, sugar_g: 2 },
    food_tags: ['gluten_free'],
  };

  const kitchen = facts.factsFor(measured);
  assert.ok(kitchen.claims.includes('high_protein'));
  assert.ok(kitchen.claims.includes('heart_healthy'));
  assert.strictEqual(kitchen.nutrition.kcal, 280);

  const guessed = facts.factsFor({ ...measured, nutrition_source: 'estimated' });
  assert.deepStrictEqual(guessed.claims, [], 'a guess earned a health claim');
  assert.deepStrictEqual(guessed.nutrition, {}, 'a guessed calorie count reached a customer');

  /* The recipe tags survive: the kitchen ticked those itself and nothing
     about them was estimated. */
  assert.deepStrictEqual(guessed.tags, ['gluten_free']);
});

test('a dish answered before this field existed keeps its badges', () => {
  /*
   * Empty means kitchen, deliberately. Every number stored before
   * nutrition_source existed got there because somebody typed it and pressed
   * Save, so it IS confirmed - and reading the absence as "unverified" would
   * silently strip the badges off every dish already done.
   */
  const legacy = facts.factsFor({ nutrition: { kcal: 280, protein_g: 38 } });
  assert.ok(legacy.claims.includes('high_protein'));
  assert.strictEqual(legacy.nutrition.kcal, 280);

  assert.strictEqual(facts.estimatedOnly({}), false);
  assert.strictEqual(facts.estimatedOnly({ nutrition_source: '' }), false);
  assert.strictEqual(facts.estimatedOnly({ nutrition_source: 'kitchen' }), false);
  assert.strictEqual(facts.estimatedOnly({ nutrition_source: 'estimated' }), true);
});

test('only the machine can be the one that guessed', () => {
  /*
   * The write path decides this word rather than trusting the caller: a
   * guess filed as the kitchen's would publish itself. Any value that is not
   * exactly "estimated" means a person.
   */
  const REPO = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'src', 'repositories', 'item.repository.js'),
    'utf8'
  );
  assert.match(
    REPO,
    /nutrition_source:\s*\n?\s*String\(data\.nutrition_source \|\| ''\)\.trim\(\) === 'estimated' \? 'estimated' : ''/
  );
  /* And the pass's own write sets it flat, never from what it was handed. */
  const stored = REPO.slice(REPO.indexOf('async storeEstimatedDishFacts('));
  assert.match(stored.slice(0, 3000), /nutrition_source: 'estimated',/);
});
