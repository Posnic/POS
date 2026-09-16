'use strict';

/*
 * What a customer types reaches a shop's screens, and must arrive as words.
 *
 * Almost every XSS alert CodeQL raises on this codebase is the shop's own data
 * on the shop's own till: a value read back out of the sale screen's DOM and
 * put into the next row. A shopkeeper who types a script tag into their own
 * item name and then watches it run on their own till has not been attacked.
 *
 * THREE SURFACES ARE DIFFERENT, because the text on them comes from outside:
 *
 *   the online orders queue   a customer's name, address, delivery note, and
 *                             the note they put on a single dish
 *   the request dock          the same order, as a card over the till
 *   the kitchen screen        the ticket on the wall
 *
 * Anyone with the shop's ordering link can put anything they like in those.
 * All three escape today; this is what says so tomorrow. Written as
 * BEHAVIOUR - a real payload through the real renderer - rather than as a
 * search for the word `safe(`, because the question is what comes out, and a
 * search would pass on a field somebody escaped the wrong way.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

/* The three shapes an attacker actually sends, not one. */
const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
];

/**
 * Nothing the payload contributed can still be markup.
 *
 * The test is that the payload never appears VERBATIM: escaping is exactly
 * the act of changing the characters that would have made it markup, so if
 * the original string survives intact, it did not happen.
 *
 * Asserting on `onerror=` instead would be wrong, and was, in the first draft
 * of this file: `&lt;img src=x onerror=alert(1)&gt;` contains those letters
 * and is completely inert - they are text on a page, not an attribute on a
 * tag. A check that fails on correct code teaches people to delete checks.
 */
function assertInert(html, payload, where) {
  /*
   * What actually prevents an injection IN A TEXT POSITION: the payload cannot
   * open a tag. `<` and `>` are the whole of it.
   *
   * Two earlier drafts of this check were wrong in opposite directions, and
   * both are worth remembering because both look right:
   *
   *   `onerror=` must not appear     - it does, inside
   *                                    `&lt;img src=x onerror=alert(1)&gt;`,
   *                                    which is text on a page and completely
   *                                    inert;
   *   the payload must not survive   - an apostrophe legitimately survives.
   *     verbatim                       jQuery's text-then-read-html escapes
   *                                    `&`, `<` and `>` and nothing else,
   *                                    because nothing else needs escaping in
   *                                    text. The quote only matters inside an
   *                                    ATTRIBUTE, which is checked separately
   *                                    and by its own test.
   *
   * A check that fails on correct code teaches people to delete checks.
   */
  const opened = payload.match(/[<>]/g) || [];
  for (const bracket of opened) {
    assert.ok(
      !html.includes(bracket === '<' ? '<img' : '</script'),
      `${where}: the payload opened a tag`
    );
  }
  assert.ok(!/<img/i.test(html), `${where}: an <img> tag reached the page`);
  assert.ok(!/<script/i.test(html), `${where}: a <script> tag reached the page`);
  if (opened.length) {
    assert.ok(/&lt;|&gt;/.test(html), `${where}: the angle brackets were not escaped`);
  }
}

/* ------------------------------------------------- the online orders queue */

/**
 * The real card renderer, with a faithful jQuery stand-in.
 *
 * `safe()` in that file is jQuery's text-then-read-html round trip, so the
 * stand-in does exactly that against a real DOM. Faking the escaping itself
 * would make this test prove nothing at all.
 */
function onlineOrdersCard(order) {
  const dom = new JSDOM('');
  const $ = () => ({
    on: () => undefined,
    text(value) {
      const div = dom.window.document.createElement('div');
      div.textContent = value == null ? '' : String(value);
      return { html: () => div.innerHTML };
    },
  });

  const sandbox = {
    $,
    PosnicPro: {
      i18n: { t: (key, fallback) => fallback || key },
      local: { get: () => '₹' },
    },
    Number,
    String,
    Math,
    Array,
    Object,
    Boolean,
    JSON,
    Date,
    console: { log() {}, warn() {}, error() {} },
  };
  /* The file binds its click handlers at load time, so it needs something to
     bind them to. Nothing here ever fires one. */
  sandbox.document = {};
  $.fn = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('frontend/static/script/js/modules/js/online_orders.js'), sandbox);
  return sandbox.PosnicPro.onlineorders.card(order);
}

test('A CUSTOMER CANNOT PUT MARKUP ON THE ORDERS QUEUE', () => {
  for (const payload of PAYLOADS) {
    const html = onlineOrdersCard({
      sale_id: '1',
      sales_id: 'SB1D14-000001',
      token_id: '219',
      fulfilment: 'delivery',
      customer_name: payload,
      customer_address: payload,
      delivery_note: payload,
      note: payload,
      total: 100,
      items: [{ quantity: 1, name: payload, note: payload }],
    });
    assertInert(html, payload, `online orders card, payload ${JSON.stringify(payload)}`);
  }
});

test('and the dish name is escaped too, not only the notes', () => {
  /*
   * The item name comes from the shop's own menu, but it travels back through
   * the order the customer sent - so it is only as trustworthy as whatever
   * checked it on the way in, and nothing here should be relying on that.
   */
  const html = onlineOrdersCard({
    sale_id: '1',
    items: [{ quantity: 2, name: '<b>Idli</b>', note: '' }],
    total: 40,
  });
  assert.ok(!/<b>Idli<\/b>/.test(html), 'a dish name was rendered as markup');
  assert.match(html, /&lt;b&gt;Idli/);
});

test('AND A CUSTOMER\'S WORDS NEVER LAND IN AN ATTRIBUTE, which is why that is enough', () => {
  /*
   * The card is safe because every escaped value goes into a TEXT position.
   *
   * That is not an accident to be relied on quietly. jQuery's escaper - the
   * one this file uses - changes `&`, `<` and `>` and leaves quotes alone,
   * because a quote is only dangerous inside an attribute. So the day somebody
   * writes `title="' + safe(order.note) + '"`, a customer's quotation mark
   * closes that attribute and the escaper will not have stopped it.
   *
   * The request dock's own helper does escape quotes, so the two files are not
   * interchangeable either. This is the line that keeps the weaker one safe.
   */
  const source = read('frontend/static/script/js/modules/js/online_orders.js');
  const card = source.slice(source.indexOf('card: function (order)'));
  const body = card.slice(0, card.indexOf('\n    },\n'));

  /*
   * INSIDE A TAG, which is the whole distinction. `[^>\n]` is what says so:
   * once a `>` has gone by we are back in a text position, which is the safe
   * one.
   *
   * My first attempt excluded QUOTES instead, and therefore could never match
   * `title="' + safe(...)` at all - the apostrophe closing the JS string was
   * in its own exclusion list. It passed over a regression injected on purpose
   * to check it, which is the only reason that was found. An assertion that
   * matches nothing passes for ever.
   */
  /* The fields a customer actually controls. A sale id in `data-id` is a
     server-generated ObjectId and is not one of them, which is why this names
     the fields rather than banning attributes outright. */
  const THEIRS = 'note|customer_name|customer_address|delivery_note|destination|name';
  const inAttribute = [
    ...body.matchAll(
      new RegExp(`[a-zA-Z-]+=["'][^>\\n]{0,4}\\+\\s*safe\\(\\s*(?:order|item|line)\\.(?:${THEIRS})\\b`, 'g')
    ),
  ];
  assert.deepStrictEqual(
    inAttribute.map((m) => m[0]),
    [],
    'an escaped value is being written into an attribute'
  );
  /* And it really does escape somewhere, so this is not passing on an empty
     function. */
  assert.ok((body.match(/safe\(/g) || []).length >= 8);
});

/* --------------------------------------------------------- the request dock */

test('THE REQUEST DOCK ESCAPES THE SAME FIVE CHARACTERS', () => {
  /*
   * Its own helper, because the dock is loaded on screens that have no
   * jQuery. Lifted and run rather than read: a replace() with the wrong
   * character class looks perfectly correct.
   */
  const source = read('frontend/static/script/js/core/request-dock.js');
  const at = source.indexOf('function safe(text)');
  assert.ok(at > -1, 'the request dock no longer has an escaping helper');
  const body = source.slice(at, source.indexOf('\n  }\n', at) + 4);

  const sandbox = { String };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nthis.out = safe;', sandbox);

  for (const payload of PAYLOADS) {
    const escaped = sandbox.out(payload);
    assertInert(escaped, payload, `request dock, payload ${JSON.stringify(payload)}`);
  }
  assert.strictEqual(sandbox.out('&'), '&amp;');
  assert.strictEqual(sandbox.out("'"), '&#39;');
  assert.strictEqual(sandbox.out(null), '');
});

/* --------------------------------------------------------- the kitchen wall */

test('THE KITCHEN SCREEN BUILDS TEXT, NEVER MARKUP', () => {
  /*
   * A ticket on a wall carries a dish name and a customer's note, and that
   * screen is a full browser window. It draws every ticket through
   * createElement + textContent, so there is nothing to escape - which is the
   * stronger position, and worth keeping.
   *
   * The one innerHTML on that page is the placement helper, and it carries
   * only numbers the shop typed into its own settings: a distance, a panel
   * size, and figures computed from them.
   */
  const page = read('src/kitchen-screen.html');
  assert.match(page, /n\.textContent = text;/, 'the ticket builder no longer sets text');

  const uses = [...page.matchAll(/innerHTML\s*=/g)];
  assert.strictEqual(uses.length, 1, `the kitchen screen now has ${uses.length} innerHTML writes`);

  const at = page.indexOf('setup.innerHTML =');
  assert.ok(at > -1, 'the one innerHTML is no longer the placement helper');
  const block = page.slice(at, page.indexOf(';\n', at));
  for (const field of ['name', 'items', 'note', 'table', 'orderNumber']) {
    assert.ok(!new RegExp(`\\b${field}\\b`).test(block), `the placement helper now carries ${field}`);
  }
});

/* ------------------------------------------------------------- the feed */

test('and nothing a customer typed is even sent to that screen unescaped', () => {
  /*
   * The read behind the wall carries a table, an order number, a time and the
   * lines. It is built from a projection rather than from whatever the sale
   * happens to hold, so a field added to sales later does not arrive here by
   * accident.
   */
  const repo = read('api/src/repositories/sale.repository.js');
  const at = repo.indexOf('async kitchenScreenTickets(branchId');
  assert.ok(at > -1, 'the kitchen screen feed is gone');
  const body = repo.slice(at, repo.indexOf('\n  }\n', at));
  assert.match(body, /projection: \{/);
  assert.ok(!/customer_name|customer_address|delivery_note/.test(body),
    'the kitchen wall is being sent a customer name or address');
});
