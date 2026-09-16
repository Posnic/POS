'use strict';

/*
 * The screen on the wall finally has something on it.
 *
 * WHAT WAS THERE
 *
 * kitchen-screen.js can open a window on any display, size its type for the
 * room from a real viewing distance, and push a list of tickets into it.
 * `setTickets` is the ONLY way anything ever reaches those windows, and it was
 * exported and called from nowhere at all.
 *
 * So a screen hung on a kitchen wall showed an empty list for ever. And the
 * bug had the worst shape a bug can have: setup mode fills the window with
 * SAMPLE tickets, so the preview a shopkeeper uses to position the screen
 * looked perfect, and the thing did nothing the moment service started. The
 * owner has this on his list to try for the first time.
 *
 * The tests here are the wiring as much as the behaviour, for the tenth time
 * in this codebase.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const feed = require(path.join(ROOT, 'src', 'kitchen-screen-feed.js'));
const SCREEN = read('src/kitchen-screen.js');
const MAIN = read('src/main.js');
const ROUTES = read('api/src/routes/sales.routes.js');
const REPO = read('api/src/repositories/sale.repository.js');

/* --------------------------------------------------------------- the wiring */

test('SOMETHING CALLS setTickets, which nothing did', () => {
  /*
   * The whole bug in one assertion. If this ever fails again, a kitchen screen
   * is blank in service and perfect in preview, which is how it went unnoticed
   * the first time.
   */
  const source = read('src/kitchen-screen-feed.js');
  assert.match(source, /screens\(\)\.setTickets\(tickets\)/);
  assert.match(SCREEN, /function setTickets\(/);
});

test('and the feed is started with the screens, and stopped with them', () => {
  assert.match(MAIN, /require\('\.\/kitchen-screen-feed'\)/);
  assert.match(MAIN, /feed\.start\(\{ branchId \}\)/);
  assert.match(MAIN, /require\('\.\/kitchen-screen-feed'\)\.stop\(\);/);
  /* Started only once a branch is known: a poll with no branch asks a
     question with no answer, every five seconds, for ever. */
  assert.match(MAIN, /if \(branchId\) \{\n\s*feed\.start/);
});

test('there is an endpoint for it to ask', () => {
  assert.match(ROUTES, /'\/kitchenScreenTickets'/);
  assert.match(ROUTES, /ensureKioskKey/);
  assert.match(REPO, /async kitchenScreenTickets\(branchId/);
});

test('it ships in the packaged build', () => {
  /* build.files is an allowlist: a file left out resolves in development and
     is simply absent on a shop's machine. */
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('src/kitchen-screen-feed.js'));
  assert.ok(pkg.build.files.includes('src/kitchen-screen.js'));
});

/* ------------------------------------------------- what it shows, and what not */

test('A SCREEN SHOWS WHAT IS OPEN, not what has yet to print', () => {
  /*
   * The obvious idea is to feed this from the print poll, and it is wrong
   * twice over: that poll returns only what has NOT printed, so a ticket would
   * vanish off the wall the instant it came out of the printer - exactly when
   * the kitchen starts cooking it - and it claims what it hands out, so a
   * ticket taken by the other till would never appear at all.
   */
  const method = REPO.slice(REPO.indexOf('async kitchenScreenTickets(branchId'));
  const body = method.slice(0, method.indexOf('\n  }\n'));
  assert.ok(!/last_printed_change_index/.test(body), 'the screen is reading the print queue');
  assert.ok(!/kot_claimed_by/.test(body), "the screen is subject to another till's claim");
  /* It leaves the wall when the table is settled, which is the only boundary
     this product actually has - nothing marks a dish done. */
  assert.match(body, /payment_status: \{ \$nin: \['Paid', 'Cancelled'\] \}/);
});

test('and it carries nothing a kitchen wall should not show', () => {
  /*
   * A kitchen screen hangs where customers and staff can both see it. Prices,
   * customers and phone numbers have no business travelling to it, and a
   * projection is the only place that can be guaranteed.
   */
  const method = REPO.slice(REPO.indexOf('async kitchenScreenTickets(branchId'));
  const body = method.slice(0, method.indexOf('\n  }\n')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const field of ['customer', 'total', 'price', 'mobile', 'payment_mode']) {
    assert.ok(!new RegExp(`\\b${field}`).test(body.split('projection:')[1] || ''),
      `the screen is being sent ${field}`);
  }
});

/* ------------------------------------------------------- it feeds, or holds */

test('a good read reaches the screens', async () => {
  const sent = [];
  const screens = require(path.join(ROOT, 'src', 'kitchen-screen.js'));
  const real = screens.setTickets;
  screens.setTickets = (list) => sent.push(list);
  try {
    const out = await feed.tick({
      branchId: 'b1',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [{ table: '6', orderNumber: 'K1', items: [] }] }),
      }),
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.count, 1);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0][0].table, '6');
  } finally {
    screens.setTickets = real;
  }
});

test('A BLIP DOES NOT CLEAR A KITCHEN WALL', async () => {
  /*
   * The tickets already up are still the truth as far as anybody in that room
   * is concerned. A screen that empties itself every time the API hiccups is a
   * screen nobody in a kitchen will trust, and an untrusted screen is worse
   * than no screen because somebody still has to look at it.
   */
  const sent = [];
  const screens = require(path.join(ROOT, 'src', 'kitchen-screen.js'));
  const real = screens.setTickets;
  screens.setTickets = (list) => sent.push(list);
  try {
    await feed.tick({
      branchId: 'b1',
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ table: '9', items: [] }] }) }),
    });
    const after = await feed.tick({
      branchId: 'b1',
      fetchImpl: async () => {
        throw new Error('the shop is not answering');
      },
    });
    assert.strictEqual(after.ok, false);
    assert.strictEqual(sent.length, 2, 'the wall was not refreshed at all');
    assert.strictEqual(sent[1][0].table, '9', 'the wall was cleared by a network blip');
  } finally {
    screens.setTickets = real;
  }
});

test('a refusal is not treated as an empty kitchen either', async () => {
  const out = await feed.tick({
    branchId: 'b1',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.why, 'refused');
});

test('and with no branch it asks nothing at all', async () => {
  let asked = 0;
  const out = await feed.tick({
    branchId: '',
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, json: async () => ({ data: [] }) };
    },
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(asked, 0, 'it asked a question with no answer');
});

test('it asks this machine the same way the printer does', () => {
  /* A second copy of "where is my API" is a second thing to drift. */
  const source = read('src/kitchen-screen-feed.js');
  assert.match(source, /require\('\.\/kot-manager'\)\.kotApiUrl\(\)/);
  assert.match(read('src/kot-manager.js'), /module\.exports\.kotApiUrl = kotApiUrl;/);
});

test('starting twice leaves one timer, and stopping releases it', () => {
  const first = feed.start({ branchId: 'b1', everyMs: 60000 });
  const second = feed.start({ branchId: 'b1', everyMs: 60000 });
  assert.notStrictEqual(first, second, 'start did not replace the old timer');
  feed.stop();
  /* And a shop with no branch never starts one. */
  assert.strictEqual(feed.start({ branchId: '' }), null);
});
