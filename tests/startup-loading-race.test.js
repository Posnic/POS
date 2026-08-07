/*
 * The till showed a spinner for ever while every log line claimed success.
 *
 * Two independent pieces of startup raced. loadPageAndReveal() navigates the
 * main window to the dashboard or the login page; separately, a 2.5 second
 * timer shows loading.html if the window is not visible yet, on the reasoning
 * that someone staring at an empty desktop will double-click again.
 *
 * When startup finished at almost exactly 2.5 seconds - 2.75s on the run that
 * caught it - the order came out:
 *
 *   loadPageAndReveal starts navigating to dashboard.html
 *   the timer fires, loadFile('loading.html') ABORTS that navigation
 *   loading.html reaches dom-ready
 *   reveal() fires, because it listened for any dom-ready at all
 *   the promise resolves; the log prints "Dashboard visible" and
 *     "Saved login found - redirected directly to dashboard"
 *   markInterfaceReady writes interface=ready to health-status.json
 *   the user watches a progress ring until they kill the application
 *
 * Nothing reported a failure. did-fail-load ignores error -3, which is exactly
 * what an aborted navigation reports, so the one event that knew the truth was
 * discarded by design.
 *
 * Both halves are fixed: the timer stands down while a real navigation is in
 * flight, and reveal only settles for the page that was actually requested.
 * These read main.js as text - requiring it would start an Electron app.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('the loading screen stands down while the interface is loading', () => {
  /* The timer's only guard was isVisible(), and a page that is still loading is
     not visible - which is precisely the window in which it did damage. */
  const timer = MAIN.slice(
    MAIN.indexOf('Startup is taking a moment') - 1200,
    MAIN.indexOf('Startup is taking a moment') + 200,
  );

  assert.match(
    timer,
    /__posnicInterfaceLoading/,
    'the loading-screen timer no longer checks whether a real navigation is ' +
      'already under way, so it can abort one again',
  );
});

test('the flag is set before navigating and cleared on every exit', () => {
  const fn = MAIN.slice(
    MAIN.indexOf('function loadPageAndReveal'),
    MAIN.indexOf('function updateStartupStatus'),
  );

  assert.match(
    fn,
    /global\.__posnicInterfaceLoading = true/,
    'loadPageAndReveal must claim the window before it navigates',
  );

  /* Cleared in cleanup, not in reveal: revealed, failed and rejected all pass
     through cleanup, and a flag left set would suppress the loading screen for
     the rest of the session. */
  const cleanup = fn.slice(fn.indexOf('const cleanup ='), fn.indexOf('const wantedPage'));
  assert.match(
    cleanup,
    /global\.__posnicInterfaceLoading = false/,
    'the flag must be cleared in cleanup(), which every exit path calls',
  );
});

test('reveal only settles for the page that was requested', () => {
  const fn = MAIN.slice(
    MAIN.indexOf('function loadPageAndReveal'),
    MAIN.indexOf('function updateStartupStatus'),
  );

  assert.ok(
    !/webContents\.once\('dom-ready', reveal\)/.test(fn),
    'listening for any dom-ready is what let loading.html satisfy a wait for ' +
      'the dashboard',
  );
  assert.match(
    fn,
    /webContents\.on\('dom-ready', revealIfCorrectPage\)/,
    'dom-ready must go through the check that compares the loaded page with ' +
      'the requested one',
  );
  assert.match(fn, /isTheRequestedPage/, 'the URL comparison has gone');
});

test('the 3 second fallback still shows something, and says when it had to', () => {
  /* The safety net must stay: a page that genuinely never loads should still
     produce a window rather than a hang. But it should be visible in the log
     that it fired, because it means this race - or one like it - happened. */
  const fn = MAIN.slice(
    MAIN.indexOf('function loadPageAndReveal'),
    MAIN.indexOf('function updateStartupStatus'),
  );

  assert.match(fn, /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*3000\)/, 'the fallback has gone');
  assert.match(
    fn,
    /did not load within 3s/,
    'the fallback fires silently, so a repeat of this bug would again look ' +
      'like success',
  );
});

test('an aborted navigation is still not treated as a failure', () => {
  /* Error -3 is ABORTED and happens routinely - a user clicking through
     quickly, a redirect. It must not reject. The fix is that an abort no
     longer resolves the promise either; it simply does not settle it, and the
     fallback covers the case where nothing else arrives. */
  const fn = MAIN.slice(
    MAIN.indexOf('function loadPageAndReveal'),
    MAIN.indexOf('function updateStartupStatus'),
  );
  assert.match(
    fn,
    /errorCode === -3/,
    'aborted navigations should still be ignored rather than rejected',
  );
});

test('the loading screen is a real file, since the timer loads it', () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'loading.html')),
    'loading.html has gone but the startup timer still loads it',
  );
});
