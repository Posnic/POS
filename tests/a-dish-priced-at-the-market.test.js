/*
 * WHAT A CUSTOMER SEES BEFORE THE SHOP HAS SET TODAY'S PRICE.
 *
 * Owner, after two fish reached a kitchen worth nothing: "for menu and order
 * say its just market price. i will ask another prompt to make seperate flag
 * for these kind of items. dont let customer add or menu see the price. ask
 * for pricing. as of now. if price is set above 0 then you can show as normal
 * item. my intension is when shop open let them update the price."
 *
 * Whole fish, crab, lobster: the rate comes from the morning's market, so the
 * catalogue holds nothing until the shop opens and enters it. Both customer
 * surfaces printed that as 0.00 - which reads as free, and is the one thing a
 * displayed price must never do.
 *
 * Zero is the signal for now. A separate flag is somebody else's work; this
 * has to be right today, and a kitchen does not sell a dish for nothing, so
 * there is no case to confuse it with.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

const BOARD = read('menu', 'menu.js');
const CARD = read('order', 'indexedDB.js');
const SHEET = read('order', 'assets', 'products', 'script.js');
const CSS = read('order', 'assets', 'order.css');

/* --------------------------------------------- the board, which only reads */

test('the menu board prints the words, never a zero', () => {
  assert.match(BOARD, /function marketPriced\(item\)/, 'the board has no rule for this');
  assert.match(
    BOARD,
    /marketPriced\(item\) \? t\("Market price"\) : money\(item\.price\)/,
    'a dish row still prints the number'
  );
});

test('a search result on the board says it too', () => {
  /* The same dish found two ways must not answer differently. */
  const hits = BOARD.match(/marketPriced\(item\) \? t\("Market price"\)/g) || [];
  assert.ok(hits.length >= 2, `only ${hits.length} of the board's two price spots were changed`);
});

test('a dish with a real price is untouched on the board', () => {
  const from = BOARD.indexOf('function marketPriced(');
  const body = BOARD.slice(from, BOARD.indexOf('\n  }', from));
  assert.match(body, /Number\(item && item\.price\) > 0/,
    'the test for "priced" is not simply having a price above zero');
});

/* ------------------------------------- the ordering page, which takes money */

test('the card says the words and offers no way to add it', () => {
  assert.match(CARD, /const marketPriced = !\(price > 0\);/, 'the card has no rule for this');
  assert.match(
    CARD,
    /marketPriced \? t\("Market price"\) : money\(price\)/,
    'the card still prints the number'
  );
  assert.match(CARD, /\$\{marketPriced \? `[\s\S]{0,200}product-ask/,
    'the quantity buttons are still drawn for an unpriced dish');
});

test('the line that replaces the button tells them what to do', () => {
  /*
   * "Ask staff for today's price" is an instruction. A blank space where a
   * button belongs reads as a broken page, and a guest who thinks the page is
   * broken does not ask anybody anything.
   */
  assert.match(CARD, /Ask staff for today's price/);
  assert.match(CSS, /\.product-ask \{/, 'the line is drawn with no style of its own');
});

test('the dish sheet agrees with the card', () => {
  /*
   * The sheet has its own add button. A card that refuses and a sheet one tap
   * later that accepts is worse than neither, because the guest has already
   * been told no once.
   */
  assert.match(SHEET, /const marketPriced = !\(Number\(item\.price\) > 0\);/);
  assert.match(SHEET, /el\("dish-add"\)\.hidden = !available \|\| marketPriced;/,
    'the sheet still offers the button');
  assert.match(SHEET, /marketPriced[\s\S]{0,80}Ask staff for today's price/,
    'the sheet hides the button and says nothing about why');
});

test('a priced dish still behaves exactly as it always did', () => {
  /*
   * The whole promise of using zero as the signal: the moment the shop enters
   * today's rate, every one of these branches is false and nothing else has
   * to be switched.
   */
  assert.match(SHEET, /marketPriced \? t\("Market price"\) : money\(item\.price\)/);
  assert.match(CARD, /marketPriced \? t\("Market price"\) : money\(price\)/);
});

/* ------------------------------------------------------------ translation */

test('both words are translated, in both copies of the dictionary', () => {
  /*
   * /menu and /order ship their own byte copy of the dictionary and CI pins
   * that they are identical, so a string added to one and not the other
   * breaks the build - and a Tamil shop meets an English line in the middle
   * of a Tamil page.
   */
  const board = read('menu', 'i18n.js');
  const order = read('order', 'assets', 'i18n.js');

  for (const [where, dict] of [['menu', board], ['order', order]]) {
    assert.match(dict, /"Market price":/, `${where} has no translation for Market price`);
    assert.match(dict, /"Ask staff for today's price":/, `${where} has no translation for the ask`);
  }
  assert.equal(board, order, 'the two copies of the dictionary have drifted apart');
});
