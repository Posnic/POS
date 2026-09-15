'use strict';

/*
 * Telling a customer the kitchen is behind, before they commit.
 *
 * Owner: "when kitchen have many order have so many order we might notify
 * online order customer deley might expecteed. example shop having total 10
 * tables. 10 order in the process. then kitchen is full. so you need to do
 * best guess. for this restuarant module enabled and number of table also
 * given. so than you can identify the capasity."
 *
 * A customer who waits forty minutes without being told blames the restaurant;
 * one who was told chose to wait. That is worth more than the handful of
 * orders the warning costs, which is why it is shown on the menu AND above the
 * order button rather than only at the end.
 *
 * What it must never do is guess. The server sends minutes only where the
 * shop's own prep times can support them, and the page says the weaker true
 * thing when they cannot - the same rule the health badges follow. These tests
 * run the real renderer over the real shapes to hold it to that.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DB = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');

/** A named function, lifted out of the bundle by brace matching. */
function lift(name) {
  const at = DB.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + ' is not in order/indexedDB.js');
  let depth = 0;
  let i = DB.indexOf('{', at);
  for (; i < DB.length; i += 1) {
    if (DB[i] === '{') depth += 1;
    else if (DB[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return DB.slice(at, i + 1);
}

/**
 * The real renderer, in a real document, with the shop the test describes.
 *
 * `escapeHtml` and `t` come out of the bundle and the dictionary respectively,
 * so a change to either is felt here rather than papered over by a stub.
 */
function page(kitchen) {
  const dom = new JSDOM('<!doctype html><body><div id="kitchen-notice" hidden></div></body>', {
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(lift('escapeHtml'));
  /* The ordering bundle's t() takes a sentence and fills {n}; English is the
     sentence itself, which is what an untranslated page shows. */
  window.eval(
    'function t(text, vars) {' +
      ' return String(text).replace(/\\{(\\w+)\\}/g, function (_, k) {' +
      '   return vars && vars[k] != null ? vars[k] : "{" + k + "}"; }); }'
  );
  window.eval('var shop = ' + JSON.stringify({ kitchen }) + ';');
  window.eval(lift('kitchenNoticeHtml'));
  window.eval(lift('paintKitchenNotice'));
  window.paintKitchenNotice();
  const box = window.document.getElementById('kitchen-notice');
  return { window, box, text: box.textContent.trim(), hidden: box.hidden };
}

/* ------------------------------------------------ when it says nothing */

test('a kitchen keeping up says nothing at all', () => {
  /*
   * The whole value of the notice is that it is unusual. Shown on a quiet
   * Tuesday it becomes furniture, and on the night it matters nobody reads it.
   */
  const quiet = page({ busy: false, open: 4, capacity: 10, extra_minutes: 0, over: false });
  assert.strictEqual(quiet.text, '');
  assert.strictEqual(quiet.hidden, true, 'an empty notice still took up the page');
});

test('a shop that sent nothing says nothing', () => {
  /* A takeaway counter, a grocer, or a browser holding a menu fetched before
     this feature existed. None of them should show a half-built warning. */
  for (const nothing of [null, undefined, {}, 'busy']) {
    assert.strictEqual(page(nothing).hidden, true, JSON.stringify(nothing) + ' drew a notice');
  }
});

test('busy has to be the boolean, not a truthy lookalike', () => {
  assert.strictEqual(page({ busy: 'true', extra_minutes: 20 }).hidden, true);
  assert.strictEqual(page({ busy: 1, extra_minutes: 20 }).hidden, true);
});

/* --------------------------------------------------- when it says it */

test('it says how much longer, because a warning with no number is noise', () => {
  /*
   * "Delay expected" is either ignored or read as "do not order", because the
   * reader has to imagine the wait and people imagine the worst.
   */
  const busy = page({ busy: true, open: 21, capacity: 10, extra_minutes: 30, over: false });
  assert.strictEqual(busy.hidden, false);
  assert.match(busy.text, /30/);
  assert.match(busy.text, /longer than usual/i);
});

test('past an hour it stops quoting a figure and says so in words', () => {
  const swamped = page({ busy: true, open: 101, capacity: 10, extra_minutes: 60, over: true });
  assert.match(swamped.text, /over an hour/i);
  assert.doesNotMatch(swamped.text, /60/, 'it quoted the cap as if it were a measurement');
});

test('busy with no figure says the weaker true thing, and invents no number', () => {
  /*
   * THE HONESTY RULE, and the case that decided the shape of the whole
   * feature. A shop that has entered no prep times has a real queue and no
   * way to price it in minutes. Saying "about 20 minutes" here would be the
   * same sin as a heart-healthy badge on a dish with no nutrition.
   */
  const vague = page({ busy: true, open: 30, capacity: 10, extra_minutes: 0, over: false });
  assert.strictEqual(vague.hidden, false);
  assert.match(vague.text, /may take longer/i);
  assert.doesNotMatch(vague.text, /\d/, 'it put a number on a queue it cannot measure');
});

/* ---------------------------------------------------------- the details */

test('it is a sentence, never a gate', () => {
  /*
   * No button, no dismissal, nothing that has to be answered before ordering.
   * A restaurant that is busy still wants the order.
   */
  const busy = page({ busy: true, extra_minutes: 20 });
  assert.strictEqual(busy.box.querySelectorAll('button, a, input').length, 0);
  assert.strictEqual(busy.box.firstElementChild.getAttribute('role'), 'status');
});

test('the minutes reach the sentence even in another language', () => {
  /*
   * The ordering pages translate by swapping whole sentences, so one built by
   * concatenation would leave the number stranded in English word order. It
   * goes through t() with a placeholder, which is the only way the other
   * language can put it where it belongs.
   */
  const source = lift('kitchenNoticeHtml');
  assert.match(source, /\{n\}/, 'the minutes are not passed through a placeholder');
  assert.doesNotMatch(source, /"\s*\+\s*minutes\s*\+\s*"/, 'the sentence is built by concatenation');
});

test('every sentence it can say is in the Tamil dictionary', () => {
  /*
   * A sentence the dictionary does not carry renders perfectly in English on
   * a Tamil page, which is exactly how eleven words on the requests dock went
   * untranslated for the life of that panel.
   */
  const dict = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'i18n.js'), 'utf8');
  const said = [...lift('kitchenNoticeHtml').matchAll(/t\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(said.length >= 3, 'the renderer no longer says what this test thinks');
  for (const sentence of said) {
    assert.ok(
      dict.includes(JSON.stringify(sentence).slice(1, -1)),
      'no Tamil for: ' + sentence
    );
  }
});

/* ------------------------------------------------ and it reaches the page */

test('both pages that take an order have somewhere to show it', () => {
  for (const file of ['products.html', 'cart.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'order', file), 'utf8');
    assert.match(html, /id="kitchen-notice"/, file + ' has nowhere to show the notice');
  }
});

test('the presenter carries it, or the page never sees it', () => {
  /*
   * present() in the online-ordering controller REBUILDS the payload field by
   * field, and a field it does not name never reaches /order however correctly
   * the repository sent it. That is how the currency once failed to arrive
   * while /menu had it all along, and how the dish facts were dropped for
   * three releases.
   */
  const controller = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'online-ordering.controller.js'),
    'utf8'
  );
  assert.match(controller, /kitchen: data\.kitchen \|\|/, 'present() drops the kitchen load');
});
