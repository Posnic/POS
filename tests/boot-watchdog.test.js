/*
 * A failed boot must never be a silent white page.
 *
 * Owner, after recovering one by clearing his own browser data: "i dont
 * [want] users to face these kind of errors." The white page he recovered
 * from had every request answering 200 and its only witness in a console
 * nobody had open; the working fix - clear this origin's data - is something
 * no shopkeeper could guess.
 *
 * The watchdog lives INLINE in dashboard.html's head, dependency-free, so it
 * still works when the bundle itself is what died - which is precisely the
 * failure it exists for. These tests hold that inline script to its rules.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'dashboard.html'), 'utf8');

const script = (() => {
  const at = html.indexOf('posnic_boot_help');
  assert.ok(at > -1, 'the watchdog is gone from dashboard.html');
  const start = html.lastIndexOf('<script>', at);
  const end = html.indexOf('</script>', at);
  return html.slice(start + '<script>'.length, end);
})();

test('the watchdog compiles on its own', () => {
  // eslint-disable-next-line no-new-func
  new Function(script);
});

test('it depends on nothing the bundle provides', () => {
  /* jQuery, PosnicPro, moment - all arrive with the bundle, and the bundle
     failing to arrive is the scenario. */
  const stripped = script.replace(/\/\*[\s\S]*?\*\//g, '');
  /* Plain substring checks: the jQuery marker written as a regex string
     lost a backslash on the way in and threw "Unterminated group" - a guard
     that crashes reads as a failing dependency check while checking nothing. */
  for (const dep of ['PosnicPro', 'jQuery', '$(', 'moment.', 'hasher.']) {
    assert.ok(!stripped.includes(dep), `the watchdog leans on ${dep}`);
  }
});

test('it captures both error channels and reports once', () => {
  assert.match(script, /addEventListener\('error'/);
  assert.match(script, /addEventListener\('unhandledrejection'/);
  assert.match(script, /if \(reported\) \{ return; \}/);
  assert.match(script, /api\/client-errors/);
});

test('booted means PAINTED, not merely present', () => {
  /* During the white page the sidebar existed in the DOM and measured 0 high
     - existence would have called the broken page healthy. */
  assert.match(script, /offsetHeight > 0/);
});

test('the recovery card offers the fix the owner performed by hand', () => {
  assert.match(script, /localStorage\.clear\(\)/);
  assert.match(script, /sessionStorage\.clear\(\)/);
  assert.match(script, /indexedDB/);
  assert.match(script, /location\.reload\(\)/);
  // and an honest sentence about what resetting costs
  assert.match(script, /signs this browser out/);
});

test('a slow connection gets patience, not a scare', () => {
  /* Keep waiting dismisses and re-arms - fifteen seconds on hotel wifi is
     not a broken till. */
  assert.match(script, /pbh_wait/);
  assert.match(script, /setTimeout\(function \(\) \{ if \(!booted\(\)\) \{ show\(\); \} \}, 20000\)/);
  assert.match(script, /\}, 15000\)/);
});

test('the reporter can never add a second failure', () => {
  const reportFn = script.slice(script.indexOf('function report'), script.indexOf('window.addEventListener'));
  assert.match(reportFn, /try \{/);
  assert.match(reportFn, /catch \(e\)/);
});
