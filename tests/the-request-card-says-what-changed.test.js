'use strict';

/*
 * What the shop sees when a customer asks for a change.
 *
 * Owner: "when customer aks for change. cancel then desktop or captain app
 * clearly can see the changes. what was before and what change customer
 * wahts? cancel item or cancel order."
 *
 * TWO THINGS WERE WRONG AND THEY COMPOUND.
 *
 * The card listed only the lines that MOVED. "Chicken Biryani: 2 to 1" tells
 * you nothing about whether that is most of the order or a detail of it, so
 * the person deciding in a hurry has to open the sales screen to find out - by
 * which time they are not deciding in a hurry.
 *
 * And every one of them said "Asked to change", whether the customer had
 * dropped one naan or emptied the order. Those are not the same decision and
 * should not read as the same question.
 *
 * Driven in a DOM against the real module, because a card is markup and the
 * whole complaint is about what it looks like.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DOCK = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'request-dock.js'),
  'utf8'
);

/**
 * The real dock, with a shop that answers however the test says.
 *
 * The module is an IIFE that wires itself to the page; it is evaluated whole
 * so the card is built by the shipping code rather than by a copy of it.
 */
function dockPage(orders) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://shop.example/dashboard.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    local: { get: () => 'b1' },
    get: (opts, ok) => ok({ type: 'success', data: orders }),
    post: (opts, ok) => ok({ type: 'success' }),
  };
  window.setInterval = () => 0;
  window.eval(DOCK);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

/**
 * The card's markup for one order.
 *
 * Built through the module's own `card()` rather than by opening the dock and
 * waiting for a poll: the same function the panel calls, with none of the
 * timers, so a failure here is about the card and not about the plumbing.
 */
function card(order) {
  const window = dockPage([order]);
  const html = window.PosnicRequestDock.card(order);
  assert.ok(html, 'the dock built no card at all');
  const host = window.document.createElement('ul');
  host.innerHTML = html;
  const el = host.querySelector('.request-dock-card');
  assert.ok(el, 'the card carries no card element');
  return el;
}

const BIRYANI = { item_id: 'm1', name: 'Chicken Biryani', quantity: 2 };
const NAAN = { item_id: 'r1', name: 'Butter Naan', quantity: 3 };
const DAL = { item_id: 'd1', name: 'Dal Tadka', quantity: 1 };

const asking = (wants, items) => ({
  sale_id: 's1',
  sales_id: 'SID7',
  token_id: '219',
  created_date: new Date().toISOString(),
  items: items || [BIRYANI, NAAN, DAL],
  change_requested: { items: wants, at: new Date().toISOString() },
});

/* ------------------------------------------------ the whole order, shown */

test('every line of the order is drawn, not only the ones that moved', () => {
  /*
   * What is NOT changing is half of what the decision is about. A shop asked
   * to drop the biryani needs to see at a glance that there is still a naan
   * and a dal on the ticket.
   */
  const el = card(asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }]));
  const rows = [...el.querySelectorAll('.request-dock-diff li')].map((li) => li.textContent);
  assert.strictEqual(rows.length, 3, 'the card shows only part of the order');
  assert.ok(rows.some((r) => r.includes('Chicken Biryani')));
  assert.ok(rows.some((r) => r.includes('Butter Naan')));
  assert.ok(rows.some((r) => r.includes('Dal Tadka')));
});

test('a line that is not moving steps back', () => {
  const el = card(asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }]));
  const same = [...el.querySelectorAll('.request-dock-diff li.is-same')].map((li) => li.textContent);
  assert.strictEqual(same.length, 2);
  assert.ok(same.some((r) => r.includes('Butter Naan')));
});

test('a line that moves says what it was and what it would become', () => {
  const el = card(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 1 }]));
  const moved = el.querySelector('.request-dock-diff li.is-moved');
  assert.ok(moved, 'nothing was marked as moving');
  assert.match(moved.textContent, /Butter Naan/);
  assert.match(moved.textContent, /3/);
  assert.match(moved.textContent, /1/);
});

test('a line going to nothing says so in words, not as a zero', () => {
  /*
   * "Butter Naan 3 to 0" is a sentence nobody reads at a glance, and zero is
   * the single most skimmable-past number on a card full of numbers.
   */
  const el = card(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  const gone = el.querySelector('.request-dock-diff li.is-gone');
  assert.ok(gone, 'a removal was not marked as one');
  assert.match(gone.textContent, /Butter Naan/);
  assert.match(gone.textContent, /removed/i);
  assert.doesNotMatch(gone.textContent, /\b0\b/, 'it still reads as a zero');
});

/* --------------------------------------------- which question this is */

test('cancelling the whole order says so', () => {
  const el = card({
    sale_id: 's1',
    sales_id: 'SID7',
    token_id: '219',
    created_date: new Date().toISOString(),
    items: [BIRYANI, NAAN],
    cancel_requested: true,
  });
  assert.match(el.querySelector('.request-dock-kind').textContent, /cancel the whole order/i);
});

test('dropping one dish reads as removing an item', () => {
  const el = card(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  assert.match(el.querySelector('.request-dock-kind').textContent, /remove an item/i);
});

test('dropping several reads as removing some', () => {
  const el = card(
    asking([
      { item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 },
      { item_id: 'd1', name: 'Dal Tadka', was: 1, quantity: 0 },
    ])
  );
  assert.match(el.querySelector('.request-dock-kind').textContent, /remove some items/i);
});

test('dropping every line reads as a cancellation, because that is what it is', () => {
  /*
   * A shop that says yes to this has no order left. Calling it "remove some
   * items" would have somebody accept the end of an order thinking they were
   * trimming it.
   */
  const el = card(
    asking([
      { item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 0 },
      { item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 },
      { item_id: 'd1', name: 'Dal Tadka', was: 1, quantity: 0 },
    ])
  );
  assert.match(el.querySelector('.request-dock-kind').textContent, /remove everything/i);
});

test('asking for fewer of something is not a removal', () => {
  const el = card(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 1 }]));
  const kind = el.querySelector('.request-dock-kind').textContent;
  assert.match(kind, /fewer/i);
  assert.doesNotMatch(kind, /remove/i);
});

/* --------------------------------------------------------- the details */

test('a dish name with markup in it cannot reach the card as markup', () => {
  const el = card(
    asking([{ item_id: 'x', name: '<img src=x onerror=1>', was: 1, quantity: 0 }], [
      { item_id: 'x', name: '<img src=x onerror=1>', quantity: 1 },
    ])
  );
  assert.strictEqual(el.querySelectorAll('img').length, 0, 'a name was drawn as markup');
  assert.match(el.textContent, /onerror/);
});

test('every word on the card is a key the packs can answer', () => {
  /*
   * The coverage scanner reads the two-argument form of i18n.t out of the
   * source, written out in full; a key reached through a variable is
   * invisible to it - never
   * gathered, never translated, falling back to English in every language,
   * which renders perfectly and so never fails. This file has already paid
   * that once, when a local t() helper hid fourteen of its words.
   */
  const dir = path.join(ROOT, 'languages');
  const english = JSON.parse(fs.readFileSync(path.join(dir, '_english.json'), 'utf8'));
  const keys = [
    'lang_cancel_whole_order',
    'lang_remove_everything',
    'lang_remove_one_item',
    'lang_remove_items',
    'lang_fewer_asked',
    'lang_removed',
  ];
  for (const key of keys) {
    assert.ok(english[key], key + ' has no English, so no pack can be asked for it');
    assert.match(
      DOCK,
      new RegExp("i18n\\.t\\('" + key + "',"),
      key + ' is not spelled out, so the scanner cannot see it'
    );
    for (const file of fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f))) {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      assert.ok(pack[key], file + ' has no ' + key);
    }
  }
});
