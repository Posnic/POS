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

test('booted means ANY sidebar painted - the layout carries one per section', () => {
  /* One .vertical-menu per section (dashboard, sale, Manage, reports), one
     shown at a time. Measuring only the FIRST declared settings routes dead
     forever: the watchdog itself was the owner's "crash", every 15 seconds,
     only on the module page, over a page that was fine underneath. */
  assert.match(script, /querySelectorAll\('\.vertical-menu, \.vertical-menu-icon'\)/);
  assert.match(script, /offsetHeight > 0\) \{ return true; \}/);
});

test('the card announces itself and never fakes a dead page', () => {
  assert.match(script, /\[watchdog\] boot card shown/);
  /* translucent backdrop: a false alarm must not LOOK like a white page */
  assert.match(script, /rgba\(244,245,247,\.9\)/);
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

/*
 * The journal - "i want to know exact exception and or coding part of cause."
 * And the lesson its first real capture taught: the owner pasted twelve
 * copies of two missing images. Noise must collapse and must never evict
 * the real exception.
 */
test('the card carries View details, Copy, and a live journal', () => {
  assert.match(script, /pbh_details/);
  assert.match(script, /pbh_copy/);
  assert.match(script, /detailsText\(\)/);
  /* resource failures - the old blind spot - are captured too, in the
     CAPTURE phase where they actually fire */
  assert.match(script, /failed to load/);
  assert.match(script, /\}, true\);/);
});

test('identical captures collapse; resource noise gets half the book at most', () => {
  const noteFn = script.slice(script.indexOf('function note'), script.indexOf('function report'));
  assert.match(noteFn, /times \+= 1/);
  assert.match(noteFn, /resources >= 6\) \{ return; \}/);
  assert.match(noteFn, /journal\.length >= 12\) \{ return; \}/);
  /* and the repeat count is visible in the details */
  assert.match(script, /×/);
});

test('the journal rides the beacon so the cause is readable remotely', () => {
  const reportFn = script.slice(script.indexOf('function report'), script.indexOf('function detailsText'));
  assert.match(reportFn, /journal: journal\.slice\(0, 3\)/);
});

test('no partial ships a phantom image - //:0 and src="" fetch the page itself', () => {
  /* An empty src resolves to the DOCUMENT URL; //:0 was a "blank" that
     errors on every render. Both filled the journal's first outing. */
  const glob = fs.readdirSync(path.join(__dirname, '..', 'frontend', 'modules'));
  for (const f of glob.filter((n) => n.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', f), 'utf8');
    assert.ok(!src.includes('src="//:0"'), f + ' ships the //:0 phantom image');
    assert.ok(!src.includes('src=""'), f + ' ships an empty img src');
  }
  const settings = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.ok(!settings.includes('//:0'), 'settings.js sets the //:0 phantom again');
});
