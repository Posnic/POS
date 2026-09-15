'use strict';

/*
 * The second screen, and the rules it must never break.
 *
 * Owner: "as of now one screen. but we have option multiple screen is good. we
 * should able get control of it ans show it." And: "make everthing
 * configurable pleaes... dont make everthing fixed."
 *
 * So the till drives as many screens as the machine has, each configured on its
 * own. What is pinned here is not how a ticket looks - that is taste and will
 * change - but the four things that would make a shop switch the feature off,
 * in the order of how badly they hurt:
 *
 *   1. THE TILL KEEPS SELLING. Nothing about a second display may throw into
 *      the boot chain. A kitchen screen is an accessory; the till is the shop.
 *   2. IT NEVER STEALS FOCUS. A waiter typing an order into a window that just
 *      lost focus is how this gets switched off in week one.
 *   3. ABSENT MEANS OFF. A shop with a projector or a customer-facing screen
 *      must not suddenly start showing kitchen tickets on it.
 *   4. IT COMES BACK BY ITSELF. A screen needing somebody to click "open
 *      kitchen display" after every power cut will be dark by Thursday.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const screens = require(path.join(ROOT, 'src', 'kitchen-screen.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'kitchen-screen.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'kitchen-screen.html'), 'utf8');

/* ------------------------------------------------ 1. the till keeps selling */

test('IT LOADS WITH NO ELECTRON AT ALL, and answers instead of throwing', () => {
  /*
   * The blunt version of "must not break the boot chain". This module is
   * required from app startup; if merely loading it could throw, a till with a
   * display driver problem would not start at all.
   */
  assert.doesNotThrow(() => screens.displays());
  assert.deepStrictEqual(screens.displays(), [], 'invented a display out of nothing');
  assert.doesNotThrow(() => screens.configuredIds());
  assert.doesNotThrow(() => screens.closeAll());
  assert.strictEqual(screens.open('nope'), false);
  assert.doesNotThrow(() => screens.close('nope'));
});

test('startup is wrapped, so a screen fault cannot stop the shop', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const at = main.indexOf("require('./kitchen-screen').start()");
  assert.ok(at > -1, 'nothing brings the screens back after a restart');
  /* The call must sit inside a try, not beside one. */
  const before = main.slice(Math.max(0, at - 400), at);
  assert.match(before, /try\s*\{[^}]*$/, 'the startup call is not inside a try block');
});

test('and shutdown closes them, because a frameless window outlives the tray', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const quit = main.slice(main.indexOf("app.on('before-quit'"));
  assert.match(quit.slice(0, 600), /kitchen-screen'\)\.closeAll\(\)/);
});

/* ------------------------------------------------- 2. it never steals focus */

test('THE WINDOW IS SHOWN WITHOUT FOCUS, and cannot take it later', () => {
  /*
   * showInactive rather than show, and focusable:false so a later display
   * event cannot pull the keyboard away from a waiter mid-order. Checked in
   * the source because there is no Electron here to observe it.
   */
  assert.match(SOURCE, /showInactive\(\)/, 'the screen is shown with focus');
  assert.ok(!/\bwin\.show\(\)/.test(SOURCE), 'something calls show(), which focuses');
  assert.match(SOURCE, /focusable:\s*false/);
  assert.match(SOURCE, /skipTaskbar:\s*true/);
});

test('the page cannot be typed into or clicked by accident', () => {
  /* A cook with wet hands, a cat, a stray trolley. There is nothing to press. */
  assert.match(PAGE, /user-select:\s*none/);
  assert.match(PAGE, /cursor:\s*none/);
  assert.ok(!/<button/i.test(PAGE), 'the kitchen screen grew a button');
  assert.ok(!/<input/i.test(PAGE), 'the kitchen screen grew an input');
});

test('it runs with the same sandbox as every other window', () => {
  /* Print windows were once the weakest renderers in the application. This one
     does not repeat that. */
  const block = SOURCE.slice(SOURCE.indexOf('webPreferences'), SOURCE.indexOf('});', SOURCE.indexOf('webPreferences')));
  assert.match(block, /nodeIntegration:\s*false/);
  assert.match(block, /contextIsolation:\s*true/);
  assert.match(block, /sandbox:\s*true/);
  assert.match(block, /webSecurity:\s*true/);
});

/* ---------------------------------------------------- 3. absent means off */

test('A TILL THAT WAS NEVER CONFIGURED DRIVES NOTHING', () => {
  assert.strictEqual(screens.DEFAULTS.enabled, false, 'a new till would grab a screen');
  assert.deepStrictEqual(screens.configuredIds(), []);
});

test('and the default distance is the one the research was done at', () => {
  /* 2.5 m, which is what the numbers in the doc assume. A default of 5 would
     silently make every unconfigured shop unreadable. */
  assert.strictEqual(screens.DEFAULTS.viewingDistanceM, 2.5);
  assert.strictEqual(screens.DEFAULTS.targetArcmin, 20);
});

/* ------------------------------------------------- 4. it comes back by itself */

test('all three display events are handled, not just the obvious one', () => {
  /*
   * Handling only display-removed leaves a window stranded at coordinates that
   * no longer exist - on Windows an invisible window still rendering tickets.
   * A television switched off at the wall arrives as metrics-changed, not as
   * removed, which is the one everybody forgets.
   */
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    assert.match(SOURCE, new RegExp("'" + event + "'"), event + ' is not handled');
  }
});

test('a display that comes back is reopened without anybody clicking', () => {
  const watch = SOURCE.slice(SOURCE.indexOf('function watch'));
  assert.match(watch, /configuredIds\(\)/, 'nothing reopens a configured screen');
  assert.match(watch, /close\(id\)/, 'nothing drops a window whose screen has gone');
});

/* ------------------------------------------------------ everything is a setting */

test('EVERY NUMBER ON THE SCREEN IS A SETTING', () => {
  /* Owner: "even you can make settings about font and other stuff." */
  for (const key of [
    'viewingDistanceM', 'diagonalInches', 'targetArcmin', 'safeAreaPercent',
    'showTable', 'showItems', 'showItemNotes', 'showAge',
    'maxItemsPerCard', 'amberAfterMin', 'redAfterMin',
    'compactAfter', 'pageDwellSeconds', 'greyAfterMin', 'theme',
  ]) {
    assert.ok(key in screens.DEFAULTS, key + ' is not configurable');
  }
});

test('the page takes its sizes from the configuration, never from the stylesheet', () => {
  /*
   * The failure this prevents: somebody hard-codes a font size that looks right
   * on the machine they are developing on, and every kitchen further than that
   * gets an unreadable screen with no way to fix it.
   */
  assert.match(PAGE, /applyFit/, 'the page does not apply a computed fit');
  assert.match(PAGE, /setProperty\('--font'/);
  assert.match(PAGE, /setProperty\('--columns'/);
});

test('a setting is stored per display, so two screens differ', () => {
  /* One kitchen screen and one pass screen want different things, and the
     owner asked for multiple screens explicitly. */
  assert.match(SOURCE, /kitchenScreens/, 'settings are not keyed by display');
  const configure = SOURCE.slice(SOURCE.indexOf('function configure'));
  assert.match(configure, /\[id\]:\s*next/, 'one display overwrites another');
});

/* -------------------------------------------------------------- the content */

test('AN ITEM NOTE IS NEVER DROPPED TO SAVE ROOM', () => {
  /*
   * "less spicy" is the line that costs a plate of food when it is missed, and
   * this whole area has already been in trouble for losing notes on the way to
   * the kitchen. It may be switched off deliberately; it may not be quietly
   * squeezed out by a layout.
   */
  assert.strictEqual(screens.DEFAULTS.showItemNotes, true);
  /* The class is applied by el('div', 'note', ...), not written as markup, so
     look for what the page actually does. Searching for class="note" was
     checking for a spelling this page never uses. */
  assert.match(PAGE, /el\('div', 'note'/, 'the card never builds a note line');
  assert.match(PAGE, /\.note \{/, 'the note line has no styling of its own');
  const noteCss = PAGE.slice(PAGE.indexOf('.note {'), PAGE.indexOf('}', PAGE.indexOf('.note {')));
  assert.ok(!/display:\s*none/.test(noteCss), 'notes can be hidden by the stylesheet');
});

test('age is carried by shape as well as colour', () => {
  /* Roughly one man in twelve cannot separate red from green reliably, and a
     kitchen is exactly that audience. */
  assert.match(PAGE, /\.ticket\.warm\s*\{[^}]*border-left-width/, 'amber changes only the hue');
  assert.match(PAGE, /\.ticket\.late\s*\{[^}]*border-left-width/, 'red changes only the hue');
  assert.match(PAGE, /el\('div', 'bar'\)/, 'no non-colour signal for how long it has waited');
  assert.match(PAGE, /\.ticket\.late \.bar > i/, 'the bar does not change with the state');
});

test('a sample service exists for placing a screen, and it carries a note', () => {
  /*
   * The only place "can the cook read this?" can be answered is standing where
   * the cook stands. The sample has to contain the hard cases - a long dish
   * name and a note - or it proves the easy thing and not the real one.
   */
  const sample = screens.sampleTickets();
  assert.ok(sample.length >= 3);
  assert.ok(sample.some((t) => t.items.some((i) => i.note)), 'no note in the test service');
  assert.ok(sample.some((t) => t.items.some((i) => i.name.length >= 18)), 'no long dish name');
  assert.ok(sample.every((t) => t.table && t.placedAt), 'a sample ticket is missing its basics');
});

test('nothing vanishes off a kitchen screen on its own', () => {
  /* An aged ticket greys, it does not disappear. Something leaving the screen
     without a person acting is how an order gets forgotten. */
  assert.ok(screens.DEFAULTS.greyAfterMin > 0);
  assert.match(PAGE, /\.ticket\.grey/, 'aged tickets have no greyed state');
});

test('the packaged build ships all three files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const f of ['src/kitchen-screen.js', 'src/kitchen-screen-fit.js', 'src/kitchen-screen.html']) {
    assert.ok(pkg.build.files.includes(f), f + ' would not ship');
  }
});
