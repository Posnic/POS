'use strict';

/*
 * How hot would you like it?
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy. we can add those into kitchen note. what you
 * think?"
 *
 * What I think, and what this file holds the build to:
 *
 *   - PER DISH, because a kitchen that batch-cooks its gravy cannot make one
 *     portion mild, and a customer who asked for mild and got hot is worse off
 *     than one who never asked. The offer exists only where it can be honoured.
 *   - NOT CHOOSING IS AN ANSWER, and it is the one most people give. There is
 *     no fourth button for "however you make it": a default that has to be
 *     selected turns a tap into a question.
 *   - ONE CONTROL, TWO PLACES. The dish sheet is where somebody chooses and
 *     the basket is where they change their mind; the day the two copies
 *     disagree is the day a customer picks mild in one and the kitchen reads
 *     medium from the other.
 *
 * Driven in a DOM rather than read as source. Every earlier test on this
 * bundle's dish facts asserted the shape of the code and passed for months
 * while the feature was dead on the page - see the last test in this file,
 * which is about exactly that.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SPICE = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'spice.js'), 'utf8');

/** The real module, in a real document, with nothing stubbed but the page. */
function picker(level) {
  const dom = new JSDOM('<!doctype html><body><div id="box"></div></body>', {
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(SPICE);
  const picked = [];
  const control = window.PosnicSpice.mount(window.document.getElementById('box'), (n) =>
    picked.push(n)
  );
  if (level !== undefined) control.set(level);
  return { window, document: window.document, control, picked };
}

const steps = (doc) => Array.from(doc.querySelectorAll('.spice-step'));
const chosen = (doc) => steps(doc).filter((s) => s.getAttribute('aria-checked') === 'true');

/* ------------------------------------------------------------ the control */

test('three levels, one chilli more on each', () => {
  const page = picker();
  const drawn = steps(page.document);
  assert.strictEqual(drawn.length, 3, 'there are not three levels');
  assert.deepStrictEqual(
    drawn.map((s) => s.getAttribute('data-spice')),
    ['1', '2', '3']
  );
  /* The chillies are the whole ask: one, two, three, drawn. */
  const chillies = drawn.map((s) => s.querySelector('.spice-chillies').textContent);
  assert.strictEqual([...chillies[0]].length < [...chillies[1]].length, true);
  assert.strictEqual([...chillies[1]].length < [...chillies[2]].length, true);
  /* And a word beside each, because an emoji renders differently on every
     phone and nobody should have to count peppers to order dinner. */
  assert.deepStrictEqual(
    drawn.map((s) => s.querySelector('.spice-word').textContent),
    ['Mild', 'Medium', 'Spicy']
  );
});

test('nothing is chosen until somebody chooses', () => {
  /*
   * The design decision worth defending. A picker that opens on Medium has
   * decided for the customer, and every order then carries a request the
   * kitchen has to honour whether or not anybody wanted it.
   */
  const page = picker();
  assert.strictEqual(chosen(page.document).length, 0, 'a level was pre-selected');
  assert.strictEqual(page.control.value(), 0);
});

test('a tap chooses, and only one is chosen at a time', () => {
  const page = picker();
  steps(page.document)[1].dispatchEvent(new page.window.Event('click'));
  assert.deepStrictEqual(page.picked, [2], 'the tap was not reported');
  assert.strictEqual(page.control.value(), 2);
  assert.deepStrictEqual(
    chosen(page.document).map((s) => s.getAttribute('data-spice')),
    ['2']
  );

  steps(page.document)[0].dispatchEvent(new page.window.Event('click'));
  assert.deepStrictEqual(
    chosen(page.document).map((s) => s.getAttribute('data-spice')),
    ['1'],
    'two levels are lit at once'
  );
});

test('the way back out appears only once there is something to undo', () => {
  /*
   * The alternative was a fourth button reading "however the kitchen makes
   * it", which is the default and therefore not a choice anybody should be
   * asked to make. A link that shows up after the fact costs nothing until
   * it is wanted.
   */
  const page = picker();
  const clear = page.document.querySelector('.spice-clear');
  assert.strictEqual(clear.hidden, true, 'an undo was offered before anything was done');

  steps(page.document)[2].dispatchEvent(new page.window.Event('click'));
  assert.strictEqual(clear.hidden, false, 'no way to take the choice back');

  clear.dispatchEvent(new page.window.Event('click'));
  assert.strictEqual(page.control.value(), 0, 'clearing did not clear');
  assert.strictEqual(chosen(page.document).length, 0);
  assert.deepStrictEqual(page.picked, [3, 0], 'the clear was not reported');
  assert.strictEqual(clear.hidden, true);
});

test('putting a stored level back on screen is not a choice somebody just made', () => {
  /*
   * set() is called every time the sheet opens on a line that already has a
   * level. Firing the callback there would write the value straight back to
   * storage on every open, and on the basket sheet it would commit a change
   * the customer had not saved yet - which makes Cancel a lie.
   */
  const page = picker(2);
  assert.strictEqual(page.control.value(), 2);
  assert.deepStrictEqual(
    chosen(page.document).map((s) => s.getAttribute('data-spice')),
    ['2']
  );
  assert.deepStrictEqual(page.picked, [], 'showing a stored level reported it as a new choice');
});

test('a level nobody recognises is no level at all', () => {
  /*
   * Everything here arrives from storage a customer's own browser owns and a
   * payload anybody can post. A value that is not one of the three must never
   * become a promise about somebody's food - and must never stop the order.
   */
  const page = picker();
  const { levelOf } = page.window.PosnicSpice;
  assert.strictEqual(levelOf(2), 2);
  assert.strictEqual(levelOf('2'), 2);
  [0, 4, -1, '', null, undefined, NaN, true, 'medium', {}, []].forEach((bad) => {
    assert.strictEqual(levelOf(bad), 0, JSON.stringify(bad) + ' read as a level');
  });
});

/* ------------------------------------------------ read back in the basket */

test('the basket says what was asked for, and says nothing when nothing was', () => {
  const page = picker();
  const { chip } = page.window.PosnicSpice;
  assert.strictEqual(chip(0), '', 'a line nobody chose for carries a badge');
  assert.strictEqual(chip(undefined), '');
  assert.match(chip(2), /Medium/);
  /* Drawn as well as named, the same as in the picker above. */
  assert.match(chip(3), /Spicy/);
});

/* -------------------------------------- what the page is given to work with */

test('the ordering catalogue keeps every fact the server sends it', () => {
  /*
   * THE BUG THIS FOUND, which is not the spice level.
   *
   * order/indexedDB.js builds the ordering bundle's whole catalogue in one
   * object literal, and a field it does not NAME there never reaches the page
   * however correctly the server sent it. The server has been sending
   * nutrition, the shop's own marks, the "made without" tags and the earned
   * health claims since the dish-facts release, and all four stopped at that
   * literal: /order drew no numbers, no badges and no marks, and its "Good
   * for" filter group had nothing to offer and hid itself - while /menu, which
   * reads the same endpoint without a local store, showed all of it. Nothing
   * failed and nothing was logged.
   *
   * So this asks the SERVER what a dish carries rather than naming the fields
   * here: add a fifth fact tomorrow and this fails until the page is told to
   * keep it, which is the only version of this test worth having.
   */
  const dishFacts = require(path.join(ROOT, 'api', 'src', 'utils', 'dish-facts.js'));
  const src = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');

  const at = src.indexOf('function catalogueItem(');
  assert.ok(at !== -1, 'the ordering catalogue is not built where this test thinks');
  let depth = 0;
  let end = src.indexOf('{', at);
  for (; end < src.length; end += 1) {
    if (src[end] === '{') depth += 1;
    else if (src[end] === '}' && --depth === 0) break;
  }
  const block = src.slice(at, end + 1);

  for (const field of Object.keys(dishFacts.factsFor({}))) {
    assert.ok(
      new RegExp('[\\s{]' + field + ':').test(block),
      'the ordering catalogue drops "' + field + '", so the page never sees it'
    );
  }
  /* And the one this change adds, for the same reason. */
  assert.ok(/[\s{]spice_choice:/.test(block), 'the catalogue drops spice_choice');
});

test('a cart line is told whether its dish offers the choice', () => {
  /*
   * The basket has no catalogue open. Without this the picker behind the
   * request button could not tell a dish that takes a level from one that
   * does not, and would either offer it on everything or on nothing.
   */
  const core = require(path.join(ROOT, 'order', 'assets', 'kiosk-core.js'));
  const { item } = core.changeCartQuantity(
    [],
    { id: 'a', name: 'Chicken Chettinad', price: 220, tax_price: 0, spice_choice: true },
    'a',
    1
  );
  assert.strictEqual(item.spice_choice, true);

  const plain = core.changeCartQuantity([], { id: 'b', name: 'Gulab Jamun', price: 80 }, 'b', 1);
  assert.strictEqual(plain.item.spice_choice, false, 'a dessert was offered a spice level');
});
