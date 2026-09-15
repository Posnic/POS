'use strict';

/*
 * Telling a customer when their food will be ready.
 *
 * They place an order, get a token number, and then hear nothing. The list of
 * this phone's orders said "With the kitchen" and that was the whole of it -
 * which is the moment somebody walks up to the counter to ask, the single
 * interruption an ordering channel exists to remove. Every food app they have
 * ever used shows a time.
 *
 * WHAT IS NOT BEING BUILT HERE. Nothing in this product knows when food is
 * actually finished: no cook marks a ticket done, so there is no "ready"
 * signal and this does not invent one. The server estimates from the slowest
 * dish on the order plus the queue that was ahead of it, both of which the
 * shop really told us, and the page says nothing whenever it would be
 * guessing. "Usually" is doing real work in that sentence.
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

/** The real sentence-writer, with the customer's own clock. */
function words(order, now) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(
    'function t(text, vars) {' +
      ' return String(text).replace(/\\{(\\w+)\\}/g, function (_, k) {' +
      '   return vars && vars[k] != null ? vars[k] : "{" + k + "}"; }); }'
  );
  if (now) {
    window.eval('Date.now = function () { return ' + new Date(now).getTime() + '; };');
  }
  window.eval(lift('readyByWords'));
  return window.readyByWords(order);
}

const SOON = '2026-09-16T19:15:00.000Z';
const NOW = '2026-09-16T18:45:00.000Z';

/* --------------------------------------------------------- when it speaks */

test('an accepted order says the clock time', () => {
  const said = words({ state: 'accepted', ready_by: SOON, ready_minutes: 30 }, NOW);
  assert.match(said, /Usually ready by about/);
  /* The time itself is the customer's own reading of the instant, so this
     asserts that a time was rendered rather than which timezone ran the test. */
  assert.match(said, /\d/);
});

test('"usually" is in the sentence, because it is an estimate', () => {
  /*
   * Nothing here knows when food is finished. A sentence reading "Ready at
   * 7:15" is a promise the product cannot keep, and the first time it is
   * wrong the customer stops believing the next one.
   */
  assert.match(words({ state: 'accepted', ready_by: SOON, ready_minutes: 30 }, NOW), /Usually/);
});

test('an order the shop has not accepted yet says a length, not a clock', () => {
  /*
   * A shop that holds orders for approval has not started cooking, so a clock
   * time would be a fiction: the food is not twenty-five minutes away, it is
   * twenty-five minutes away from whenever somebody presses accept.
   */
  const said = words({ state: 'pending', ready_by: SOON, ready_minutes: 25 }, NOW);
  assert.match(said, /25/);
  assert.match(said, /once the shop accepts/i);
});

/* -------------------------------------------------------- when it is quiet */

test('a shop that has stated no prep times says nothing at all', () => {
  /*
   * THE HONESTY RULE. The server sends an empty ready_by when no dish on the
   * order says how long it takes, and the row then looks exactly as it always
   * has rather than carrying half a sentence.
   */
  assert.strictEqual(words({ state: 'accepted', ready_by: '', ready_minutes: 0 }, NOW), '');
  assert.strictEqual(words({ state: 'accepted' }, NOW), '');
  assert.strictEqual(words(null, NOW), '');
});

test('a time that has been and gone stops being shown', () => {
  /*
   * Worse than no time. An estimate counting backwards at somebody still
   * waiting reads as the shop being late rather than as an estimate being
   * approximate, and there is nothing they can do with it.
   */
  const said = words({ state: 'accepted', ready_by: '2026-09-16T18:00:00.000Z', ready_minutes: 30 }, NOW);
  assert.strictEqual(said, '');
});

test('a cancelled order never says when it will be ready', () => {
  assert.strictEqual(
    words({ state: 'accepted', cancelled: true, ready_by: SOON, ready_minutes: 30 }, NOW),
    ''
  );
});

test('an unreadable time is no time', () => {
  for (const bad of ['soon', 'null', '2026-13-45', 0]) {
    assert.strictEqual(
      words({ state: 'accepted', ready_by: bad, ready_minutes: 30 }, NOW),
      '',
      JSON.stringify(bad) + ' was drawn as a time'
    );
  }
});

/* ------------------------------------------------------------ the details */

test('the number goes through a placeholder, so another language can move it', () => {
  /*
   * The ordering pages translate by swapping whole sentences. One built by
   * concatenation would leave the clock stranded in English word order.
   */
  const source = lift('readyByWords');
  assert.match(source, /\{when\}/);
  assert.match(source, /\{n\}/);
  assert.doesNotMatch(source, /"\s*\+\s*clock\s*\+\s*"/);
});

test('both sentences are in the Tamil dictionary', () => {
  /* A sentence the dictionary does not carry renders perfectly in English on
     a Tamil page, which is how eleven words on the requests dock stayed
     untranslated for the life of that panel. */
  const dict = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'i18n.js'), 'utf8');
  const said = [...lift('readyByWords').matchAll(/t\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(said.length, 2, 'the sentences changed without this test knowing');
  for (const sentence of said) assert.ok(dict.includes(sentence), 'no Tamil for: ' + sentence);
});

test("the clock is the customer's own, not the shop's", () => {
  /*
   * A guest ordering from a hotel in another timezone reads their own watch.
   * The server sends an instant; the page renders it locally.
   */
  const source = lift('readyByWords');
  assert.match(source, /toLocaleTimeString/);
  assert.match(source, /new Date\(order\.ready_by\)/);
});

test('the order list draws it, and hides the line when there is nothing to say', () => {
  const history = fs.readFileSync(
    path.join(ROOT, 'order', 'assets', 'history', 'script.js'),
    'utf8'
  );
  assert.match(history, /readyByWords\(said\)/, 'the list never asks for the estimate');
  assert.match(history, /ready\.hidden = !readyWords/, 'an empty estimate still takes up the row');
  assert.match(history, /open\.appendChild\(ready\)/, 'the estimate is built and never added');
});

test('the server sends both the instant and the minutes', () => {
  /*
   * The instant for a clock time, the minutes for the pending case where a
   * clock would be a fiction. A page that had only one of them would have to
   * do arithmetic the server has already done.
   */
  const repo = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );
  assert.match(repo, /ready_minutes: Number\(order\.ready_minutes\) \|\| 0/);
  assert.match(repo, /ready_by: readyBy\.readyBy\(/);
  /* Counted from when the kitchen was told, not when the customer tapped. */
  assert.match(repo, /order\.order_state_at \|\| order\.created_date/);
});
