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
 * THE FLAG CONTRACT has since landed: `daily_price` says a dish is priced from
 * the market, `price_set_on` says when somebody last did it. Priced today it
 * is an ordinary dish; priced yesterday it is not, which is the quiet failure
 * the flag exists to catch - a stale number looks right, and nobody checks a
 * price that looks right. An item carrying neither field still falls through
 * to "has it got a price at all", because shops are running this today.
 *
 * The rules are lifted out of the page and run for real here, rather than
 * matched as text: a regex over source cannot tell you that a price entered
 * yesterday evening is refused this morning.
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

/**
 * Pull named functions out of a browser file and make them callable.
 *
 * Neither page can be require()d - one is an IIFE, the other expects a DOM and
 * IndexedDB on the first line. The rules being tested are deliberately small,
 * pure and named, so they can be lifted whole by brace-matching and run on
 * their own. See tests/lift-a-function-out-to-test-it (the pattern), and the
 * assertion below that each name is still there: if somebody renames one of
 * these, this file must fail loudly rather than silently test nothing.
 */
function lift(source, where, names) {
  const bodies = names.map((name) => {
    const from = source.indexOf(`function ${name}(`);
    assert.ok(from >= 0, `${name} is gone from ${where} - renamed, or inlined?`);
    let depth = 0;
    let end = -1;
    for (let i = source.indexOf('{', from); i < source.length; i++) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.ok(end > from, `could not read the whole of ${name} in ${where}`);
    return source.slice(from, end + 1);
  });
  return new Function(`${bodies.join('\n\n')}\nreturn { ${names.join(', ')} };`)();
}

const board = lift(BOARD, 'menu/menu.js', ['marketPriced', 'pricedToday']);
const page = lift(CARD, 'order/indexedDB.js', ['waitingForTodaysPrice', 'pricedToday']);

/* Both surfaces answer the same question, so every case below is asked of
   both. A board that says "Market price" over a page that takes the money is
   the failure this pairing exists to prevent. */
const SURFACES = [
  ['the menu board', (item) => board.marketPriced(item)],
  ['the ordering page', (item) => page.waitingForTodaysPrice(item)],
];

const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000);

for (const [where, waiting] of SURFACES) {
  test(`${where}: an ordinary priced dish is ordinary`, () => {
    assert.equal(waiting({ price: 280 }), false);
  });

  test(`${where}: a dish with no price at all waits`, () => {
    /* Every shop until the flag ships, including the one that ran two fish
       through a live kitchen for nothing. */
    assert.equal(waiting({ price: 0 }), true);
    assert.equal(waiting({}), true);
    assert.equal(waiting(null), true);
  });

  test(`${where}: priced from the market TODAY is ordinary`, () => {
    /* The entire point of the shop updating it when they open: once the
       number is in, nothing on the screen mentions any of this. */
    assert.equal(
      /*
       * Priced TODAY, whatever time the test runs.
       *
       * This was `hoursAgo(2)`, which reads as "the shop entered it this morning"
       * and is yesterday whenever the suite runs within two hours of midnight.
       * pricedToday compares CALENDAR DAYS, so the fixture has to be an unambiguous
       * today rather than a small offset from now - it failed at 00:32 on a machine
       * and in CI on the same code that had passed hours earlier.
       *
       * `new Date()` is today by definition, at every hour. The stale case keeps
       * its 26 hours, which crosses midnight from any starting point.
       */
      waiting({ price: 900, daily_price: true, price_set_on: new Date().toISOString() }),
      false
    );
  });

  test(`${where}: priced YESTERDAY waits, it does not print yesterday's rate`, () => {
    assert.equal(
      waiting({ price: 900, daily_price: true, price_set_on: hoursAgo(26) }),
      true
    );
  });

  test(`${where}: marked daily but never priced waits`, () => {
    assert.equal(waiting({ price: 900, daily_price: true }), true);
  });

  test(`${where}: an unreadable date counts as not today`, () => {
    /* The safe way round. Asking a guest to ask staff costs a question; a
       stale number costs the shop's word. */
    assert.equal(
      waiting({ price: 900, daily_price: true, price_set_on: 'before the fish came in' }),
      true
    );
  });

  test(`${where}: daily_price must be exactly true, not a stray string`, () => {
    /* Settings arrive as 'false' strings often enough in this codebase to be
       worth pinning: a truthy string must not switch a whole menu to words. */
    assert.equal(waiting({ price: 900, daily_price: 'false' }), false);
    assert.equal(waiting({ price: 900, daily_price: 0 }), false);
  });

  test(`${where}: open_price is deliberately not read on a customer screen`, () => {
    /*
     * open_price means the price is settled at the counter. A guest ordering
     * from a phone has no counter to settle it at, those dishes carry a card
     * price today and are ordered with it, and taking that away was not this
     * change's business. The waiter's handset is the surface that asks.
     */
    assert.equal(waiting({ price: 900, open_price: true }), false);
  });
}

/* -------------------------------------------------- what the screens print */

test('the menu board prints the words, never a zero', () => {
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

test('the card says the words and offers no way to add it', () => {
  assert.match(CARD, /const marketPriced = waitingForTodaysPrice\(product\);/,
    'the card is no longer asking the shared rule');
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

test('the dish sheet asks the very same rule as the card', () => {
  /*
   * One rule, not two copies of it. A card that refuses and a sheet one tap
   * later that accepts is worse than neither, because the guest has already
   * been told no once - and two copies of a date comparison will drift.
   */
  assert.match(SHEET, /const marketPriced = waitingForTodaysPrice\(item\);/);
  assert.match(SHEET, /el\("dish-add"\)\.hidden = !available \|\| marketPriced;/,
    'the sheet still offers the button');
  assert.match(SHEET, /marketPriced[\s\S]{0,80}Ask staff for today's price/,
    'the sheet hides the button and says nothing about why');
});

test('a priced dish still behaves exactly as it always did', () => {
  /*
   * The promise that lets this ship ahead of the schema: the moment the shop
   * enters today's rate, every one of these branches is false and nothing
   * else has to be switched.
   */
  assert.match(SHEET, /marketPriced \? t\("Market price"\) : money\(item\.price\)/);
  assert.match(CARD, /marketPriced \? t\("Market price"\) : money\(price\)/);
});

/* ------------------------------------------------------------- the fields */

test('the storefront actually sends the two fields', () => {
  /*
   * The rules above are worth nothing if the payload does not carry the
   * contract. One projection feeds all three surfaces - the board, the
   * ordering page and the captain handset - so this is the single place it
   * can be dropped.
   */
  const items = read('api', 'src', 'repositories', 'item.repository.js');
  assert.match(items, /daily_price: '\$daily_price'/);
  assert.match(items, /price_set_on: '\$price_set_on'/);
});

/* ------------------------------------------------------------ translation */

test('both words are translated, in both copies of the dictionary', () => {
  /*
   * /menu and /order ship their own byte copy of the dictionary and CI pins
   * that they are identical, so a string added to one and not the other
   * breaks the build - and a Tamil shop meets an English line in the middle
   * of a Tamil page.
   */
  const menu = read('menu', 'i18n.js');
  const order = read('order', 'assets', 'i18n.js');

  for (const [where, dict] of [['menu', menu], ['order', order]]) {
    assert.match(dict, /"Market price":/, `${where} has no translation for Market price`);
    assert.match(dict, /"Ask staff for today's price":/, `${where} has no translation for the ask`);
  }
  assert.equal(menu, order, 'the two copies of the dictionary have drifted apart');
});
