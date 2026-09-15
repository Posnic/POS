'use strict';

/*
 * Driving the shop's side of the prep-time tool.
 *
 * Counted on the live production shop the day this was written: 272 dishes,
 * ZERO with a prep time. The field has been on the item form all along. It is
 * empty because filling it means opening 272 dishes, and nobody does that.
 *
 * Two customer-facing things go quiet without it. The dish sheet cannot say
 * "takes about 20 minutes", and the busy-kitchen notice has no round length to
 * multiply - so it tells somebody the kitchen is behind and never by how much,
 * which is the weakest sentence it can say and the one it says on every shop.
 *
 * Driven rather than read for the reason every shop-facing miss in this
 * program has had in common: the control existed, the handler existed, and it
 * did nothing. A regex over items.js cannot tell you that an empty box is sent
 * as zero, which on a menu reads as "ready instantly".
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

const METHODS = [
  'openPrepMinutes',
  'togglePrepMinutesCategory',
  'loadPrepMinutesCategories',
  'readPrepMinutesForm',
  'checkPrepMinutes',
  'submitPrepMinutes',
];

function toolPage(answer) {
  const dom = new JSDOM('<!doctype html><body>' + modal('prep_minutes_modal') + '</body>', {
    url: 'https://shop.example/dashboard.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(JQUERY);

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
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    alert: (kind, message) => alerts.push({ kind, message }),
    get: (opts, ok) => ok({ suggestions: [{ id: 'c1', name: 'Breads' }] }),
    post: (opts, ok, fail) => {
      const body = JSON.parse(opts.data);
      posted.push({ url: opts.url, body });
      const said = answer ? answer(opts.url, body) : { type: 'success', message: 'ok' };
      return said && said.__fail ? fail(said.__fail) : ok(said);
    },
    items: { itemsTable: () => refreshed.push(true) },
  };
  window.eval(
    'PosnicPro.items = Object.assign(PosnicPro.items, {' + METHODS.map(method).join(',\n') + '});'
  );

  return { window, document: window.document, posted, alerts, refreshed, shown, PosnicPro: window.PosnicPro };
}

const el = (page, id) => page.document.getElementById(id);

/* --------------------------------------------------------------- opening */

test('it opens on everything, sparing what the shop set by hand', () => {
  /*
   * THE DEFAULT THAT MATTERS. A shop that has hand-tuned a handful of dishes
   * has done the most valuable work on this whole field, and a tool that
   * opened ready to overwrite it would destroy that on the first careless run.
   */
  const page = toolPage();
  el(page, 'prep_minutes_check_result').innerHTML = 'left over from last time';
  page.PosnicPro.items.openPrepMinutes();

  assert.strictEqual(
    page.document.querySelector('input[name="prep_minutes_scope"][value="all"]').checked,
    true
  );
  assert.strictEqual(el(page, 'prep_minutes_only_empty').checked, true, 'it opened ready to overwrite');
  assert.strictEqual(el(page, 'prep_minutes_value').value, '');
  assert.strictEqual(el(page, 'prep_minutes_check_result').innerHTML, '');
  assert.deepStrictEqual(page.shown, ['show']);
});

/* ---------------------------------------------------------- what it sends */

test('an empty box is refused, never sent as zero', () => {
  /*
   * The bug this test is really about. Number('') is 0, so a blank that
   * travelled would arrive as a confident request to set every dish in the
   * shop to zero minutes - which reads on the menu as "ready instantly" and
   * gives the busy-kitchen notice a floor of nothing to work from.
   */
  const page = toolPage();
  page.PosnicPro.items.openPrepMinutes();
  assert.strictEqual(page.PosnicPro.items.submitPrepMinutes(), false);
  assert.strictEqual(page.posted.length, 0, 'it posted an empty box');
  assert.match(page.alerts[0].message, /minutes/i);
});

test('a wait longer than a day is refused at the form', () => {
  const page = toolPage();
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '2000';
  assert.strictEqual(page.PosnicPro.items.submitPrepMinutes(), false);
  assert.strictEqual(page.posted.length, 0);
});

test('"one category" with nothing chosen is refused rather than sent as all', () => {
  /* Falling through to every dish in the shop because a select was empty is
     the worst reading of an unanswered question. */
  const page = toolPage();
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.document.querySelector('input[value="category"]').checked = true;
  el(page, 'prep_minutes_category').innerHTML = '';

  assert.strictEqual(page.PosnicPro.items.submitPrepMinutes(), false);
  assert.strictEqual(page.posted.length, 0);
  assert.match(page.alerts[0].message, /category/i);
});

test('the minutes go out as a number, and the scope with them', () => {
  const page = toolPage(() => ({ type: 'success', message: '84 dish(es) updated' }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.document.querySelector('input[value="category"]').checked = true;
  el(page, 'prep_minutes_category').innerHTML = '<option value="c1" selected>Breads</option>';

  page.PosnicPro.items.submitPrepMinutes();
  assert.strictEqual(page.posted[0].url, 'items/bulkPrepMinutes');
  assert.deepStrictEqual(page.posted[0].body, {
    scope: 'category',
    category_id: 'c1',
    minutes: 8,
    only_empty: true,
  });
  assert.strictEqual(typeof page.posted[0].body.minutes, 'number', 'the minutes went out as text');
});

test('unticking the box asks to overwrite, explicitly', () => {
  const page = toolPage(() => ({ type: 'success', message: 'done' }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '25';
  el(page, 'prep_minutes_only_empty').checked = false;
  page.PosnicPro.items.submitPrepMinutes();
  assert.strictEqual(page.posted[0].body.only_empty, false);
});

/* -------------------------------------------------------------- the check */

test('Check says what would change, from what to what', () => {
  const page = toolPage(() => ({
    type: 'success',
    data: {
      total: 272,
      willChange: 84,
      keeping: 6,
      minutes: 8,
      sample: [{ name: 'Butter Naan', old_value: 0, new_value: 8 }],
    },
  }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.checkPrepMinutes();

  assert.strictEqual(page.posted[0].url, 'items/bulkPrepMinutesPreview');
  const text = el(page, 'prep_minutes_check_result').textContent;
  assert.match(text, /84/);
  assert.match(text, /272/);
  assert.match(text, /Butter Naan/);
  /* The before as well as the after, or "84 would change" is a number to take
     on faith while a whole section is rewritten. */
  assert.match(text, /0/);
});

test('a cautious run says out loud what it is sparing', () => {
  const page = toolPage(() => ({
    type: 'success',
    data: { total: 272, willChange: 84, keeping: 6, minutes: 8, sample: [] },
  }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.checkPrepMinutes();
  assert.match(
    el(page, 'prep_minutes_check_result').textContent,
    /by hand/i,
    'a shop cannot see that its own times are safe'
  );
});

test('a check that would change nothing says so, not zero of nothing', () => {
  const page = toolPage(() => ({
    type: 'success',
    data: { total: 272, willChange: 0, keeping: 272, minutes: 8, sample: [] },
  }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.checkPrepMinutes();
  assert.match(el(page, 'prep_minutes_check_result').textContent, /already/i);
});

test('a dish name with markup in it cannot reach the page as markup', () => {
  const page = toolPage(() => ({
    type: 'success',
    data: {
      total: 1,
      willChange: 1,
      keeping: 0,
      minutes: 8,
      sample: [{ name: '<img src=x onerror=1>', old_value: 0, new_value: 8 }],
    },
  }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.checkPrepMinutes();
  const box = el(page, 'prep_minutes_check_result');
  assert.strictEqual(box.querySelectorAll('img').length, 0, 'the name was drawn as markup');
  assert.match(box.textContent, /onerror/);
});

/* -------------------------------------------------------------- finishing */

test('a good run closes the sheet and redraws the list', () => {
  const page = toolPage(() => ({ type: 'success', message: '84 dish(es) updated' }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.submitPrepMinutes();
  assert.deepStrictEqual(page.shown, ['show', 'hide']);
  assert.deepStrictEqual(page.refreshed, [true]);
});

test('a refusal leaves the sheet open with the button usable again', () => {
  const page = toolPage(() => ({ type: 'error', message: 'Not allowed' }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.submitPrepMinutes();
  assert.deepStrictEqual(page.shown, ['show'], 'it closed on a refusal');
  assert.strictEqual(el(page, 'prep_minutes_submit').disabled, false);
});

test('a request that never lands leaves the button usable too', () => {
  const page = toolPage(() => ({ __fail: { status: 500 } }));
  page.PosnicPro.items.openPrepMinutes();
  el(page, 'prep_minutes_value').value = '8';
  page.PosnicPro.items.submitPrepMinutes();
  assert.strictEqual(el(page, 'prep_minutes_submit').disabled, false);
});

test('the tool is on the items page, and only for a restaurant', () => {
  /* A stationer has no kitchen and no wait to declare. */
  const at = HTML.indexOf('openPrepMinutes()');
  assert.ok(at !== -1, 'nothing on the items page opens the tool');
  const link = HTML.slice(HTML.lastIndexOf('<a', at), at);
  assert.match(link, /restaurant-only/);
});
