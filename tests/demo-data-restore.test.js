const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, cssReader, stripComments } = require('./helpers/source-lookup');

/*
 * Putting the sample data back, with something to watch while it happens.
 *
 * Owner ask: "when demo data enabled again. we can do insert data by progress
 * bar."
 *
 * Switching Demo Data off only HIDES, so turning it back on is usually
 * instant - the rows never went anywhere. This is for the shop that removed
 * the samples for good: without it the switch appears to do nothing, because
 * there is nothing left to unhide.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const settingsJs = stripComments(
  read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
);
const installSvc = stripComments(read('api', 'src', 'services', 'install.service.js'));
const routes = read('api', 'src', 'routes', 'items.routes.js');
const cssRule = cssReader(read('frontend', 'static', 'style', 'css', 'custom.css'));

/*
 * reseedDemoData is bounded by NAME, not brace-matched.
 *
 * Its signature destructures, so matching braces from the marker stops at
 * that pair and returns a few characters. Every assertion against them would
 * fail - and a doesNotMatch would pass while proving nothing.
 */
const reseed = (() => {
  const from = installSvc.indexOf('async reseedDemoData');
  const to = installSvc.indexOf('async _insertBusinessTypeDemoData');
  assert.notStrictEqual(from, -1, 'reseedDemoData is gone');
  assert.ok(to > from, 'reseedDemoData no longer sits above _insertBusinessTypeDemoData');
  return installSvc.slice(from, to);
})();

/* ------------------------------------------------------------------ *
 * When it runs
 * ------------------------------------------------------------------ */

test('it runs only when the switch has just been turned ON', () => {
  /*
   * Calling this on every features save would put a progress bar in front of
   * somebody who changed the tax switch, which is its own small insult.
   */
  const fn = blockAt(settingsJs, 'PosnicPro.settings.restoreDemoDataIfEmpty = function ()');
  assert.match(fn, /if \(!on \|\| was !== false\) \{ return; \}/, 'it fires for states other than off-to-on');
});

test('the previous state is captured when settings load', () => {
  /* off->on cannot be told from on->on without knowing what it was. */
  assert.match(settingsJs, /_demoWasOn = data\.module_demo_data_enable !== false/);
});

test('"already here" is not reported as a failure', () => {
  /*
   * The ordinary case: the switch only hides, so the rows are usually still
   * there. The shop asked to see the samples and is about to - telling them
   * something went wrong would be false.
   */
  const fn = blockAt(settingsJs, 'PosnicPro.settings.restoreDemoDataIfEmpty = function ()');
  assert.match(fn, /\/already\/i\.test/, 'an already-seeded shop is shown an error');
});

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

test('the bar never reaches the end on its own', () => {
  /*
   * The server does the work in one request and cannot report a percentage.
   * A bar that marches to 100% and then sits there says the work is finished
   * when it is not, which is worse than showing no bar at all.
   */
  const mod = blockAt(settingsJs, 'PosnicPro.settings.demoProgress = {');
  assert.match(mod, /Math\.min\(90/, 'the crawl is not capped below 100');
  const close = blockAt(settingsJs, 'close: function (message, ok)');
  assert.match(close, /_set\(100/, 'the end is never reached even on the answer');
});

test('the ticker is stopped when the work finishes', () => {
  /* A left-running interval would keep moving a bar on a hidden modal, and
     the next open would start from wherever it had crept to. */
  const close = blockAt(settingsJs, 'close: function (message, ok)');
  assert.match(close, /clearInterval/);
});

test('the steps say what is being added, not just that something is', () => {
  const mod = blockAt(settingsJs, 'PosnicPro.settings.demoProgress = {');
  for (const word of ['products', 'sales', 'quotes']) {
    assert.match(mod, new RegExp(word, 'i'), `the steps never mention ${word}`);
  }
});

test('the bar is styled and respects reduced motion', () => {
  assert.match(cssRule('.demo-progress-bar {', '.demo-progress-track {'), /width/);
  assert.match(
    read('frontend', 'static', 'style', 'css', 'custom.css'),
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.demo-progress-bar \{ transition: none; \}/,
    'the bar keeps sliding for people who asked it not to',
  );
});

/* ------------------------------------------------------------------ *
 * The server side
 * ------------------------------------------------------------------ */

test('seeding twice is refused', () => {
  /* Two of every sample, with no way to tell which pair to delete. */
  const fn = reseed;
  assert.match(fn, /if \(already\)/, 'nothing checks for existing demo data');
  assert.match(fn, /already here/i, 'the refusal does not say why');
});

test('deleted samples do not count as present', () => {
  /* Removing demo data soft-deletes the items. If those still counted, a shop
     that cleared the samples could never get them back. */
  const fn = reseed;
  assert.match(fn, /del_status: \{ \$nin/, 'binned items still block a re-seed');
});

test('the shop gets back the pack it had, not the default', () => {
  const fn = reseed;
  assert.match(fn, /previous && previous\.demo_pack/, 'the previous pack is ignored');
});

test('it reuses the shop’s own supplier, unit and tax', () => {
  /* Otherwise the samples arrive with a second set of everything beside the
     shop's own. */
  const fn = reseed;
  for (const c of ['suppliers', 'unit', 'grouptax']) {
    assert.ok(fn.includes(`collection('${c}')`), `${c} is not read from the shop`);
  }
});

test('the endpoint exists and is a POST', () => {
  /* DELETE /demo removes, POST /demo restores - one noun, two verbs. */
  assert.match(routes, /router\.post\('\/demo', bindController\(itemsController\.reseedDemoData\)\)/);
  assert.match(routes, /router\.delete\('\/demo', bindController\(itemsController\.purgeDemoData\)\)/);
});
