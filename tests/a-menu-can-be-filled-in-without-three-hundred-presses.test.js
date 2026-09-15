'use strict';

/*
 * Filling in a menu's nutrition, and the one thing that must not follow.
 *
 * Owner asked for nutrition on every dish and an assistant to fill it in "if
 * user lazy to do". The single-dish button does exactly that, one press at a
 * time - which on the 272-dish menu of a real shop is 272 presses. Left there
 * the panel is empty in every shop in the estate, and a feature that is empty
 * everywhere may as well not exist.
 *
 * So there is a pass over the whole menu. And the moment that exists, the
 * rule this whole feature was built on comes under a new kind of pressure.
 *
 * Until now the question could not arise: the only way numbers reached a dish
 * was a person typing them, or pressing Estimate and then Save. Either way a
 * person put them there, so every stored figure was somebody's word. A pass
 * that walks three hundred dishes unattended breaks that, and an unchecked
 * guess would start earning "Heart healthy" and "Diabetic friendly" on a live
 * menu - the same harm as a tick box for those words, arriving by a door that
 * is much harder to see.
 *
 * That is what most of this file is about.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PASS = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'nutrition-pass.js'),
  'utf8'
);
const REPO = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'repositories', 'item.repository.js'),
  'utf8'
);
const CONTROLLER = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'controllers', 'items.controller.js'),
  'utf8'
);
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items.html'), 'utf8');

const facts = require('../api/src/utils/dish-facts');

test('a guess is stored as a guess, and the server is what decides that', () => {
  /*
   * The single most important line in the feature. If the client could send
   * `nutrition_source: 'kitchen'` alongside its estimate, every badge in the
   * product would be derived from an unchecked guess, and nothing anywhere
   * would say so.
   */
  const stored = REPO.slice(REPO.indexOf('async storeEstimatedDishFacts('));
  const body = stored.slice(0, stored.indexOf('\n  async ', 10));

  assert.match(body, /nutrition_source: 'estimated',/, 'the pass does not mark its own work');
  assert.ok(
    !/nutrition_source:\s*(facts|data|req)\./.test(body),
    'the caller must never choose this word'
  );
});

test('and a guess publishes nothing until a person confirms it', () => {
  const measured = { kcal: 280, protein_g: 38, carbs_g: 6, sat_fat_g: 2, sodium_mg: 300, sugar_g: 2 };

  assert.ok(facts.factsFor({ nutrition: measured }).claims.length > 0);
  assert.deepStrictEqual(facts.factsFor({ nutrition: measured, nutrition_source: 'estimated' }).claims, []);
  assert.deepStrictEqual(
    facts.factsFor({ nutrition: measured, nutrition_source: 'estimated' }).nutrition,
    {},
    'a guessed calorie count is still a claim, and reached a customer'
  );
});

test('nothing overrules a person, and the pass can be run twice', () => {
  /*
   * A shop part-way through doing this by hand must not have its own figures
   * replaced by a guess - and a run that skips those is a run somebody can
   * repeat without paying for it twice.
   */
  const stored = REPO.slice(REPO.indexOf('async storeEstimatedDishFacts('));
  const body = stored.slice(0, stored.indexOf('\n  async ', 10));

  assert.match(body, /const confirmed = String\(before\.nutrition_source \|\| ''\)\.trim\(\) !== 'estimated';/);
  assert.match(body, /if \(Object\.keys\(already\)\.length && confirmed\)/);
  assert.match(body, /skipped: true/);
});

test('the write is narrow: four fields, not the whole document', () => {
  /*
   * The obvious way to do this is to replay the item form's upsert, which
   * writes every field - and anything the caller did not send comes back as
   * a default. Survivable when a person is looking at a form; not when a loop
   * is walking three hundred dishes unattended.
   */
  const stored = REPO.slice(REPO.indexOf('async storeEstimatedDishFacts('));
  const body = stored.slice(0, stored.indexOf('\n  async ', 10));

  assert.match(body, /collection\.updateOne\(filter, \{ \$set: set \}\)/);
  assert.ok(!/upsertItem|insertOne|replaceOne/.test(body), 'the pass replays the whole item write');

  /* And the kitchen's own ticks are joined, never replaced: those are the
     shop's statements about its own recipe. */
  assert.match(body, /\[\.\.\.new Set\(\[\.\.\.ticked, \.\.\.guessed\]\)\]/);
});

test('the shop is told what it will cost before it starts', () => {
  /*
   * One call to their own AI provider per dish. "Run this over your menu"
   * with no number in front of it is not a choice anybody can make, so the
   * count is read first and put in the button.
   */
  assert.match(CONTROLLER, /async dishesWantingNutrition\(req, res\)/);
  assert.match(PASS, /lang_estimate_n_dishes', 'Estimate \{n\} dishes'/);
  assert.match(HTML, /lang_nutrition_pass_cost/, 'the modal never mentions the cost');
});

test('it walks one dish at a time, and can be stopped', () => {
  /*
   * Sequential, in the browser. Three hundred requests in flight would take
   * the shop's provider rate limit down on the first try, and a job on the
   * server could be neither watched nor stopped once it was spending.
   */
  const step = PASS.slice(PASS.indexOf('function step()'));
  assert.match(step.slice(0, 2500), /if \(stopped \|\| at >= todo\.length\) return finish\(\);/);

  /* The next dish is asked for only from inside the answer to the last one,
     which is what makes it a queue rather than a flood. */
  const calls = (step.slice(0, 3000).match(/\bstep\(\);/g) || []).length;
  assert.ok(calls >= 2, 'the loop does not chain from its own callbacks');
});

test('a refusal ends the run instead of asking three hundred times', () => {
  /*
   * 400 from that route means the AI is refusing - no key, provider down,
   * monthly cap spent. Every remaining dish would fail identically, and
   * asking three hundred times in a row is how a rate limit becomes a ban.
   */
  assert.match(PASS, /if \(xhr && xhr\.status === 400\) \{\s*\n\s*stopped = true;/);
});

test('the entry explains itself rather than vanishing', () => {
  /*
   * The single-dish button hides when the shop has no AI key, because the
   * only place that asks about availability is the item FORM. This lives on
   * the item LIST, so a gate written the same way would have been dead code
   * and the entry hidden on every shop forever - which is exactly the kind of
   * silent nothing this codebase has been bitten by before.
   */
  assert.match(HTML, /id="item_nutrition_pass_open"/);
  assert.match(HTML, /class="dropdown-item restaurant-only" id="item_nutrition_pass_open"/);
  assert.ok(
    !/id="item_nutrition_pass_open"[^>]*style="display:none/.test(HTML),
    'the entry hides itself and nothing ever shows it again'
  );
  assert.match(PASS, /lang_no_ai_key_for_pass/, 'a shop with no key is told nothing');
});

test('the file actually ships', () => {
  /* A file in core/ that no page map lists is a file that does not ship.
     That has happened in this codebase before, to a whole animation. */
  const map = fs.readFileSync(path.join(ROOT, 'frontend', 'pages_css_js_map.json'), 'utf8');
  assert.match(map, /static\/script\/js\/core\/nutrition-pass\.js/);
});

/* --------------------------------------------- and then checking them */

test('confirming is the other half, and it is not 272 presses either', () => {
  /*
   * The pass made ESTIMATING a menu cheap and left CONFIRMING it at one dish
   * at a time - open the item, save it - which on 272 dishes is the same 272
   * presses, moved one step along. A feature that stops there publishes
   * nothing, because confirming is the only thing that lets a badge out.
   */
  assert.match(REPO, /async estimatedDishes\(/);
  assert.match(REPO, /async confirmEstimatedNutrition\(/);
  assert.match(CONTROLLER, /async confirmNutrition\(req, res\)/);
  assert.match(HTML, /id="nutrition_review_modal"/);
});

test('confirming changes who said so, and not one number', () => {
  /*
   * THE LINE THAT MATTERS ON THIS SCREEN. A confirm that also edited would be
   * a second way for figures to reach a dish, and the whole feature rests on
   * there being exactly one - the item form, where a person types them.
   */
  const confirm = REPO.slice(REPO.indexOf('async confirmEstimatedNutrition('));
  const body = confirm.slice(0, confirm.indexOf('\n  async ', 10));

  assert.match(body, /nutrition_source: '',/);
  assert.match(body, /nutrition_confirmed_at/);
  assert.ok(
    !/nutrition:|food_tags:|menu_marks:|diet:/.test(body.replace(/nutrition_\w+/g, '')),
    'confirming writes a figure, so there are now two ways for one to arrive'
  );
});

test('only a dish that is still an estimate can be confirmed', () => {
  /*
   * Somebody may have answered a dish by hand between the screen reading the
   * list and the button being pressed. That answer is already the shop's word
   * and must not be re-stamped, and the filter says so rather than the page
   * being trusted to have sent a list that is still true.
   */
  const confirm = REPO.slice(REPO.indexOf('async confirmEstimatedNutrition('));
  const body = confirm.slice(0, confirm.indexOf('\n  async ', 10));
  assert.match(body, /nutrition_source: 'estimated'/, 'the filter does not check what it is replacing');
});

test('the screen shows what confirming would publish, not just numbers', () => {
  /*
   * A shop scanning calorie figures is being asked to check arithmetic it has
   * no way to check. A shop reading "Grilled Chicken - High protein, Heart
   * healthy" is being asked the question it can actually answer. Those badges
   * are exactly what confirming publishes.
   *
   * They are DERIVED on the read, the same way the customer menu derives
   * them, so what is approved is what a customer will see.
   */
  const read = REPO.slice(REPO.indexOf('async estimatedDishes('));
  const body = read.slice(0, read.indexOf('\n  async ', 10));
  assert.match(body, /claims: dishFacts\.claimsFor\(nutrition, tags\)/);

  assert.match(PASS, /function reviewRow\(/);
  assert.match(PASS, /nutrition-review-claim/);
});

test('both pickers get filled, not just the first one', () => {
  /*
   * fillCategories hard-wired the pass's select. A second screen using it
   * would have filled that one and left its own picker showing nothing but
   * "The whole menu" - which looks right and silently narrows nothing.
   */
  assert.match(PASS, /function fillCategories\(intoId\)/);
  assert.match(PASS, /fillCategories\('nutrition_review_category'\)/);
});
