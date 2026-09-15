'use strict';

/*
 * Driving the shop's side of the spice choice, rather than reading it.
 *
 * The spice level is per dish because only the kitchen knows which dishes it
 * can cook to order. But production carries 272 dishes, and a restaurant that
 * has to open every one of them to tick a box does not turn the feature on -
 * it leaves it off, and the customer goes on typing "less spicy" into a note,
 * which is the very thing the level exists to replace. So the items list gets
 * the same check-then-apply tool the bulk price and stock changes already use.
 *
 * WHY THIS IS DRIVEN AND NOT READ. Every miss in this program so far has been
 * on a SHOP-facing screen, and every one of them was a control that existed in
 * the markup, had a handler in the source, and did nothing: a select the
 * wording read after it had moved, a helper that hid its own keys from the
 * scanner, a whitelist that dropped the field the page went on to use. A regex
 * over items.js cannot tell you that the Check button posts the category
 * nobody chose, or that Apply sends "yes" where the server reads a boolean.
 *
 * So the REAL modal is lifted out of items.html and the REAL handlers out of
 * items.js, and they run against real jQuery with a server that answers the
 * way the real one does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items.html'), 'utf8');
const ITEMS = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
  'utf8'
);
const JQUERY = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'jquery-3.7.1.min.js'), 'utf8');

/** The modal as it ships, lifted out of the page by its id. */
function modal(id) {
  const at = HTML.indexOf(`id="${id}"`);
  assert.ok(at !== -1, `${id} is not on the items page`);
  const open = HTML.lastIndexOf('<div', at);
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

/** One named method of PosnicPro.items, lifted out by brace matching. */
function method(name) {
  const at = ITEMS.indexOf('\n    ' + name + ': function (');
  assert.ok(at !== -1, 'PosnicPro.items.' + name + ' is not in items.js');
  const open = ITEMS.indexOf('{', ITEMS.indexOf('(', at));
  let depth = 0;
  let i = open;
  for (; i < ITEMS.length; i += 1) {
    if (ITEMS[i] === '{') depth += 1;
    else if (ITEMS[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return name + ': function ' + ITEMS.slice(ITEMS.indexOf('(', at), open) + ITEMS.slice(open, i + 1);
}

const SPICE_METHODS = [
  'openSpiceChoice',
  'toggleSpiceChoiceCategory',
  'loadSpiceChoiceCategories',
  'readSpiceChoiceForm',
  'checkSpiceChoice',
  'submitSpiceChoice',
];

/**
 * The tool, running, with a server that answers however the test says.
 *
 * @param {function} answer  called with the posted url and body
 */
function toolPage(answer) {
  const dom = new JSDOM('<!doctype html><body>' + modal('spice_choice_modal') + '</body>', {
    url: 'https://shop.example/dashboard.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(JQUERY);

  /* Bootstrap and select2 are not under test; they are recorded so the test
     can say whether the modal was actually opened or closed. */
  const shown = [];
  window.jQuery.fn.modal = function (what) {
    shown.push(what);
    return this;
  };
  window.jQuery.fn.select2 = function () {
    return this;
  };

  const posted = [];
  const alerts = [];
  const refreshed = [];
  const PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    alert: (kind, message) => alerts.push({ kind, message }),
    get: (opts, ok) => ok({ suggestions: [{ id: 'c1', name: 'Mains' }] }),
    post: (opts, ok, fail) => {
      const body = JSON.parse(opts.data);
      posted.push({ url: opts.url, body });
      const said = answer ? answer(opts.url, body) : { type: 'success', message: 'ok' };
      return said && said.__fail ? fail(said.__fail) : ok(said);
    },
    items: { itemsTable: () => refreshed.push(true) },
  };
  window.PosnicPro = PosnicPro;
  window.eval('PosnicPro.items = Object.assign(PosnicPro.items, {' + SPICE_METHODS.map(method).join(',\n') + '});');

  return { window, document: window.document, posted, alerts, refreshed, shown, PosnicPro };
}

const el = (page, id) => page.document.getElementById(id);

/* ------------------------------------------------------------- the form */

test('it opens on everything, offering the choice, with no stale result showing', () => {
  /*
   * "Which items: all" and "let customers choose" are the two answers a shop
   * gives nine times out of ten. A result left over from the last time it was
   * opened would be read as this run's answer.
   */
  const page = toolPage();
  el(page, 'spice_choice_check_result').innerHTML = 'left over from last time';
  page.PosnicPro.items.openSpiceChoice();

  assert.strictEqual(
    page.document.querySelector('input[name="spice_choice_scope"][value="all"]').checked,
    true
  );
  assert.strictEqual(el(page, 'spice_choice_offer').value, 'yes');
  assert.strictEqual(el(page, 'spice_choice_check_result').innerHTML, '');
  assert.strictEqual(el(page, 'spice_choice_submit').disabled, false);
  assert.deepStrictEqual(page.shown, ['show']);
});

test('choosing one category reveals the category picker, and going back hides it', () => {
  const page = toolPage();
  page.PosnicPro.items.openSpiceChoice();
  const row = page.document.querySelector('.spice-choice-category-row');
  assert.strictEqual(row.style.display, 'none');

  page.document.querySelector('input[value="category"]').checked = true;
  page.PosnicPro.items.toggleSpiceChoiceCategory();
  assert.notStrictEqual(row.style.display, 'none', 'the category picker stayed hidden');

  page.document.querySelector('input[value="all"]').checked = true;
  page.PosnicPro.items.toggleSpiceChoiceCategory();
  assert.strictEqual(row.style.display, 'none');
});

test('"one category" with nothing chosen is refused rather than sent', () => {
  /*
   * The worst reading of an unanswered question is "all of them". A request
   * that reached the server with no category would turn the choice on across
   * the entire menu, desserts included.
   */
  const page = toolPage();
  page.PosnicPro.items.openSpiceChoice();
  page.document.querySelector('input[value="category"]').checked = true;
  el(page, 'spice_choice_category').innerHTML = '';

  const sent = page.PosnicPro.items.submitSpiceChoice();
  assert.strictEqual(sent, false);
  assert.strictEqual(page.posted.length, 0, 'it posted a category nobody chose');
  assert.strictEqual(page.alerts.length, 1);
  assert.match(page.alerts[0].message, /category/i);
});

/* -------------------------------------------------------------- the check */

test('Check asks the server what would change, and says so', () => {
  const page = toolPage(() => ({
    type: 'success',
    data: {
      total: 272,
      willChange: 84,
      offer: true,
      sample: [{ name: 'Chettinad Chicken' }, { name: 'Meen Kuzhambu' }],
    },
  }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.checkSpiceChoice();

  assert.strictEqual(page.posted.length, 1);
  assert.strictEqual(page.posted[0].url, 'items/bulkSpiceChoicePreview');
  assert.deepStrictEqual(page.posted[0].body, { scope: 'all', category_id: null, offer: true });

  const text = el(page, 'spice_choice_check_result').textContent;
  assert.match(text, /84/, 'the count of what would change is not shown');
  assert.match(text, /272/);
  assert.match(text, /Chettinad Chicken/, 'the shop cannot see which dishes it would touch');
});

test('a check that would change nothing says nothing, not zero of nothing', () => {
  /*
   * A shop running this twice should be told there is nothing left to do,
   * rather than shown a bare "0 of 272" and left wondering whether the first
   * run worked at all.
   */
  const page = toolPage(() => ({
    type: 'success',
    data: { total: 272, willChange: 0, offer: true, sample: [] },
  }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.checkSpiceChoice();
  assert.match(el(page, 'spice_choice_check_result').textContent, /already/i);
});

test('a dish name with markup in it cannot reach the page as markup', () => {
  /* Shop-typed text, drawn into a result box by hand. */
  const page = toolPage(() => ({
    type: 'success',
    data: { total: 1, willChange: 1, offer: true, sample: [{ name: '<img src=x onerror=1>' }] },
  }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.checkSpiceChoice();
  const box = el(page, 'spice_choice_check_result');
  assert.strictEqual(box.querySelectorAll('img').length, 0, 'the name was drawn as markup');
  assert.match(box.textContent, /onerror/);
});

/* -------------------------------------------------------------- the write */

test('Apply sends the scope, and the answer is a boolean the server can read', () => {
  const page = toolPage(() => ({ type: 'success', message: '84 dish(es) updated' }));
  page.PosnicPro.items.openSpiceChoice();
  page.document.querySelector('input[value="category"]').checked = true;
  el(page, 'spice_choice_category').innerHTML = '<option value="c1" selected>Mains</option>';

  const returned = page.PosnicPro.items.submitSpiceChoice();
  assert.strictEqual(returned, false, 'the form was allowed to navigate');
  assert.strictEqual(page.posted[0].url, 'items/bulkSpiceChoice');
  assert.deepStrictEqual(page.posted[0].body, { scope: 'category', category_id: 'c1', offer: true });
  /* A boolean, not the select's "yes": the server reads `offer === true`. */
  assert.strictEqual(typeof page.posted[0].body.offer, 'boolean');
});

test('taking the choice back off sends false', () => {
  const page = toolPage(() => ({ type: 'success', message: 'done' }));
  page.PosnicPro.items.openSpiceChoice();
  el(page, 'spice_choice_offer').value = 'no';
  page.PosnicPro.items.submitSpiceChoice();
  assert.strictEqual(page.posted[0].body.offer, false);
});

test('a good run closes the sheet and redraws the list', () => {
  const page = toolPage(() => ({ type: 'success', message: '84 dish(es) updated' }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.submitSpiceChoice();
  assert.deepStrictEqual(page.shown, ['show', 'hide']);
  assert.deepStrictEqual(page.refreshed, [true], 'the items list still shows the old state');
  assert.strictEqual(page.alerts[0].kind, 'success');
});

test('a refusal leaves the sheet open with the button usable again', () => {
  /*
   * A disabled button on a sheet that stayed open is a dead end: the shop can
   * see what it asked for and has no way to ask again.
   */
  const page = toolPage(() => ({ type: 'error', message: 'Not allowed' }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.submitSpiceChoice();
  assert.deepStrictEqual(page.shown, ['show'], 'it closed on a refusal');
  assert.strictEqual(el(page, 'spice_choice_submit').disabled, false);
  assert.strictEqual(page.alerts[0].kind, 'error');
});

test('a request that never lands leaves the button usable too', () => {
  const page = toolPage(() => ({ __fail: { status: 500 } }));
  page.PosnicPro.items.openSpiceChoice();
  page.PosnicPro.items.submitSpiceChoice();
  assert.strictEqual(
    el(page, 'spice_choice_submit').disabled,
    false,
    'a failed request left the button dead'
  );
});

/* ------------------------------------------------------- where it lives */

test('the tool is on the items page, and only for a restaurant', () => {
  /*
   * A grocer has no kitchen to cook to order, and a menu tool in a
   * stationer's catalogue is noise. Same rule as the nutrition tools beside
   * it, which is why it carries the same class.
   */
  const at = HTML.indexOf('openSpiceChoice()');
  assert.ok(at !== -1, 'nothing on the items page opens the tool');
  const link = HTML.slice(HTML.lastIndexOf('<a', at), at);
  assert.match(link, /restaurant-only/, 'the tool is offered to shops with no kitchen');
});
