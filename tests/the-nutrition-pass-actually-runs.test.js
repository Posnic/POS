'use strict';

/*
 * Driving the nutrition pass, rather than reading it.
 *
 * Owner: "have you tested ?"
 *
 * A fair question, and the honest answer was partly. The customer-facing work
 * was driven in a real browser - grouped menu, menu button, filters, card
 * geometry at three widths, the live page. The SHOP-facing nutrition chain
 * was not driven at all. Every test on it asserted the SHAPE of the source:
 * that a function exists, that a line matches a pattern, that a field is in a
 * projection. Not one of them ran the loop.
 *
 * That is a real gap and it is the kind that lets a feature ship broken while
 * its tests stay green, because a regex over source code cannot tell you that
 * the second dish is never asked about, that Stop does not stop, or that a
 * refusal spends three hundred calls before giving up.
 *
 * So this file runs it: the real module, in a real DOM, against a server that
 * answers the way the real one does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PASS = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'nutrition-pass.js'),
  'utf8'
);
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items.html'), 'utf8');

/* The two modals, lifted out of the page so the module drives the real
   markup rather than a hand-written stand-in that could drift from it. */
function modal(id) {
  const at = HTML.indexOf(`id="${id}"`);
  assert.ok(at !== -1, `${id} is not on the items page`);
  const open = HTML.lastIndexOf('<div', at);
  /* To the matching close: count divs from the opening tag. */
  let depth = 0;
  let i = open;
  while (i < HTML.length) {
    if (HTML.startsWith('<div', i)) depth += 1;
    else if (HTML.startsWith('</div>', i)) {
      depth -= 1;
      if (depth === 0) return HTML.slice(open, i + 6);
    }
    i += 1;
  }
  throw new Error(`${id} never closes`);
}

/**
 * The pass, running, with a shop that answers however the test says.
 *
 * @param {object[]} dishes   what dishesWantingNutrition returns
 * @param {function} answer   called per dish; returns what the server said
 */
function passPage(dishes, answer) {
  const dom = new JSDOM(
    `<!doctype html><body>${modal('nutrition_pass_modal')}${modal('nutrition_review_modal')}</body>`,
    { url: 'https://shop.example/dashboard.html', runScripts: 'outside-only' }
  );
  const { window } = dom;
  const asked = [];

  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    alert: () => {},
    get: (url, data, ok) => {
      /* The module calls get() two ways - a url string, and an options
         object for the category list. Both shapes answer here, as the real
         PosnicPro does. */
      const name = typeof url === 'string' ? url : url.url;
      if (String(name).includes('aiAvailability')) return ok({ data: { available: true } });
      if (String(name).includes('getCategoryAjaxList')) return ok({ suggestions: [] });
      if (String(name).includes('dishesWantingNutrition')) return ok({ data: dishes });
      if (String(name).includes('estimatedDishes')) return ok({ type: 'success', data: dishes });
      return ok({ data: [] });
    },
    post: (opts, ok, fail) => {
      const body = JSON.parse(opts.data);
      asked.push(body);
      const said = answer ? answer(body, asked.length) : { type: 'success', data: {} };
      if (said && said.__fail) return fail(said.__fail);
      return ok(said);
    },
  };
  window.jQuery = null;
  window.setInterval = () => 0;
  window.eval(PASS);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document: window.document, asked };
}

const menu = (n) =>
  Array.from({ length: n }, (_, i) => ({
    item_id: 'i' + (i + 1),
    name: 'Dish ' + (i + 1),
    category_name: 'Mains',
    description: '',
    diet: '',
    estimated: false,
  }));

/* The loop is async through callbacks; let it drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('it asks about every dish, one at a time', async () => {
  /*
   * Sequential is the whole design: three hundred requests in flight would
   * take the shop's own AI provider rate limit down on the first try. A
   * source regex cannot tell you whether the loop actually chains.
   */
  const page = passPage(menu(5), () => ({ type: 'success', data: { nutrition: { kcal: 280 } } }));
  page.window.PosnicRequestDockUnused = null;

  page.window.PosnicPro.nutritionPass.look('');
  await settle();
  page.window.PosnicPro.nutritionPass.start();
  await settle();

  assert.strictEqual(page.asked.length, 5, 'not every dish was asked about');
  assert.deepStrictEqual(
    page.asked.map((a) => a.item_id),
    ['i1', 'i2', 'i3', 'i4', 'i5'],
    'the dishes were not walked in order'
  );
  assert.strictEqual(page.window.PosnicPro.nutritionPass.state().done, 5);
});

test('the button says how many it will ask about before it starts', async () => {
  /*
   * This spends the shop's own AI balance once per dish. "Run this over your
   * menu" with no number in front of it is not a choice anybody can make.
   */
  const page = passPage(menu(214), () => ({ type: 'success', data: {} }));
  page.window.PosnicPro.nutritionPass.look('');
  await settle();

  const go = page.document.getElementById('nutrition_pass_go');
  assert.match(go.textContent, /214/, 'the count is not on the button');
  assert.strictEqual(go.disabled, false);
});

test('Stop stops, and on the next dish rather than eventually', async () => {
  const page = passPage(menu(50), (body, n) => {
    if (n === 3) page.window.PosnicPro.nutritionPass.stop();
    return { type: 'success', data: {} };
  });

  page.window.PosnicPro.nutritionPass.look('');
  await settle();
  page.window.PosnicPro.nutritionPass.start();
  await settle();

  assert.strictEqual(page.asked.length, 3, 'it kept going after Stop');
  assert.strictEqual(page.window.PosnicPro.nutritionPass.state().running, false);
});

test('a refusal ends the run instead of asking fifty times', async () => {
  /*
   * 400 means the AI is refusing - no key, provider down, cap spent - and
   * every remaining dish would fail identically. Asking fifty times in a row
   * is how a rate limit becomes a ban.
   */
  const page = passPage(menu(50), (body, n) => {
    if (n === 2) return { __fail: { status: 400, responseText: '{"message":"No AI key"}' } };
    return { type: 'success', data: {} };
  });

  page.window.PosnicPro.nutritionPass.look('');
  await settle();
  page.window.PosnicPro.nutritionPass.start();
  await settle();

  assert.strictEqual(page.asked.length, 2, 'it ploughed on through a refusal');
  assert.match(
    page.document.getElementById('nutrition_pass_state').textContent,
    /No AI key/,
    'the shop was not told why it stopped'
  );
});

test('an ordinary failure does NOT end the run', async () => {
  /*
   * The other side of the same rule. A dish the assistant simply cannot place
   * is one dish, not a broken feature, and stopping on it would leave the
   * rest of the menu unasked.
   */
  const page = passPage(menu(4), (body, n) =>
    n === 2 ? { type: 'error', message: 'Could not place this dish' } : { type: 'success', data: {} }
  );

  page.window.PosnicPro.nutritionPass.look('');
  await settle();
  page.window.PosnicPro.nutritionPass.start();
  await settle();

  assert.strictEqual(page.asked.length, 4, 'one unplaceable dish stopped the whole menu');
  const state = page.window.PosnicPro.nutritionPass.state();
  assert.strictEqual(state.done, 3);
  assert.strictEqual(state.failed, 1);
});

test('a dish the shop already answered is counted as left alone, not as done', async () => {
  /* The server skips those. The screen has to say so, or a shop reads
     "214 estimated" and believes its own figures were overwritten. */
  const page = passPage(menu(3), (body, n) =>
    n === 2 ? { type: 'success', data: { skipped: true } } : { type: 'success', data: {} }
  );

  page.window.PosnicPro.nutritionPass.look('');
  await settle();
  page.window.PosnitionUnused = null;
  page.window.PosnicPro.nutritionPass.start();
  await settle();

  const state = page.window.PosnicPro.nutritionPass.state();
  assert.strictEqual(state.skipped, 1);
  assert.strictEqual(state.done, 2);
});

/* ------------------------------------------------------- the review half */

test('the review screen shows the badges confirming would publish', async () => {
  /*
   * The point of that screen. A shop cannot check a calorie figure by looking
   * at it; it can absolutely tell you whether its own dish is heart healthy.
   */
  const estimated = [
    {
      item_id: 'i1',
      name: 'Grilled Chicken',
      category_name: 'Mains',
      nutrition: { kcal: 280, protein_g: 38 },
      tags: [],
      claims: ['high_protein', 'heart_healthy'],
    },
  ];
  const page = passPage(estimated, () => ({ type: 'success', data: {} }));
  page.window.PosnicPro.nutritionPass.loadReview('');
  await settle();

  const rows = page.document.querySelectorAll('.nutrition-review-row');
  assert.strictEqual(rows.length, 1);
  const text = rows[0].textContent;
  assert.match(text, /Grilled Chicken/);
  assert.match(text, /High protein/, 'the badge it would publish is not shown');
  assert.match(text, /Heart healthy/);
  assert.match(text, /280 kcal/);
});

test('confirming sends the ticked dishes, and only those', async () => {
  const estimated = ['a', 'b', 'c'].map((id) => ({
    item_id: id,
    name: 'Dish ' + id,
    category_name: 'Mains',
    nutrition: { kcal: 200 },
    tags: [],
    claims: [],
  }));
  const page = passPage(estimated, () => ({ type: 'success', message: '2 dishes confirmed' }));
  page.window.PosnicPro.nutritionPass.loadReview('');
  await settle();

  /* Untick the middle one, the way a shop would for a dish it disagrees with. */
  const boxes = page.document.querySelectorAll('.nutrition-review-tick');
  boxes[1].checked = false;
  boxes[1].dispatchEvent(new page.window.Event('change', { bubbles: true }));

  page.document
    .getElementById('nutrition_review_confirm')
    .dispatchEvent(new page.window.Event('click', { bubbles: true }));
  await settle();

  const sent = page.asked.find((a) => a.item_ids);
  assert.ok(sent, 'nothing was sent to confirm');
  assert.deepStrictEqual(sent.item_ids, ['a', 'c'], 'it confirmed a dish nobody ticked');
});

test('the confirm button counts what is ticked', async () => {
  const estimated = ['a', 'b'].map((id) => ({
    item_id: id,
    name: 'Dish ' + id,
    category_name: 'Mains',
    nutrition: {},
    tags: [],
    claims: [],
  }));
  const page = passPage(estimated, () => ({ type: 'success' }));
  page.window.PosnicPro.nutritionPass.loadReview('');
  await settle();

  const button = page.document.getElementById('nutrition_review_confirm');
  assert.match(button.textContent, /2/);

  const boxes = page.document.querySelectorAll('.nutrition-review-tick');
  boxes[0].checked = false;
  boxes[0].dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.match(button.textContent, /1/);

  boxes[1].checked = false;
  boxes[1].dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.strictEqual(button.disabled, true, 'nothing ticked and the button still offers to confirm');
});
