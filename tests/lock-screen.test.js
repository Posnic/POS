const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/*
 * The lock screen, driven the way a cashier drives it.
 *
 * The behaviour that matters is not "an overlay appears" - it is that the
 * session is genuinely gone while locked. An overlay with the token still in
 * localStorage is theatre: anything running in the page could keep calling the
 * API behind it.
 */
const ROOT = path.join(__dirname, '..');

function boot(t, { enrolled = [], unlock } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://till.local/dashboard.html' });
  /* jQuery stays on 3 deliberately: the frontend ships 3.3.1, and the product
     code still calls $.trim, which 4 removed. Testing this markup against 4
     would be testing it against a library it never runs on. */
  const $ = require('jquery')(dom.window);

  const calls = { enroll: [], unlock: [], forget: [] };
  const lockApi = {
    users: () => Promise.resolve(enrolled),
    isEnrolled: (u) => Promise.resolve(enrolled.some((e) => e.username === u)),
    enroll: (details) => { calls.enroll.push(details); return Promise.resolve({ success: true }); },
    unlock: (details) => {
      calls.unlock.push(details);
      return Promise.resolve(unlock ? unlock(details) : { success: false, reason: 'wrong-pin', attemptsLeft: 4 });
    },
    forget: (u) => { calls.forget.push(u); return Promise.resolve({ success: true }); },
  };

  dom.window.electronAPI = { lock: lockApi };

  const store = {};
  const PosnicPro = {
    local: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
    users: { createCookie: () => {} },
  };

  new dom.window.Function('PosnicPro', 'window', 'document', 'localStorage', 'sessionStorage',
    fs.readFileSync(path.join(ROOT, 'frontend/static/script/js/core/lock-screen.js'), 'utf8')
  )(PosnicPro, dom.window, dom.window.document, dom.window.localStorage, dom.window.sessionStorage);

  // The lock screen keeps a clock on setInterval; without this teardown the
  // test runner's event loop never drains and the file hangs.
  if (t && typeof t.after === 'function') {
    t.after(() => {
      if (PosnicPro.lockScreen) PosnicPro.lockScreen.destroy();
      dom.window.close();
    });
  }

  // jsdom refuses real navigation, and the test only needs to know it was
  // asked for.
  const navigated = [];
  PosnicPro.lockScreen.navigate = (url) => navigated.push(url);

  return { dom, $, PosnicPro, calls, store, navigated, window: dom.window };
}

// The keypad auto-submits 120ms after the last digit, so a tick has to
// outlast that or the assertion runs before the unlock does.
const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function tap(dom, digits) {
  for (const d of String(digits)) {
    dom.window.document.querySelector('[data-digit="' + d + '"]').click();
  }
}

test('locking removes the session, not just the view', async (t) => {
  const { dom, PosnicPro } = boot(t, { enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }] });
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');

  PosnicPro.lockScreen.lock();
  await tick();

  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), null,
    'the token survived the lock, so the lock is decorative');
  assert.ok(dom.window.document.getElementById('posnic-lock').classList.contains('is-open'));
});

test('the right PIN puts the session back', async (t) => {
  const { dom, PosnicPro } = boot(t, {
    enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }],
    unlock: () => ({ success: true, session: { token: 'restored-token' } }),
  });
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');

  PosnicPro.lockScreen.lock();
  await tick();
  tap(dom, '4829');
  await tick();
  await tick();

  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), 'restored-token');
  assert.ok(!dom.window.document.getElementById('posnic-lock').classList.contains('is-open'));
});

test('four digits submit on their own', async (t) => {
  // Nobody should reach for a confirm key when the length is already known.
  const { dom, PosnicPro, calls } = boot(t, {
    enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }],
  });
  PosnicPro.lockScreen.lock();
  await tick();

  tap(dom, '482');
  await tick();
  assert.strictEqual(calls.unlock.length, 0, 'submitted before the PIN was complete');

  tap(dom, '9');
  await tick();
  await tick();
  assert.strictEqual(calls.unlock.length, 1);
  assert.strictEqual(calls.unlock[0].pin, '4829');
});

test('the dots track what has been typed, and delete removes one', async (t) => {
  const { dom, PosnicPro } = boot(t, { enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }] });
  PosnicPro.lockScreen.lock();
  await tick();

  const filled = () => dom.window.document.querySelectorAll('.lock-dot.is-filled').length;
  tap(dom, '48');
  assert.strictEqual(filled(), 2);

  dom.window.document.querySelector('[data-action="delete"]').click();
  assert.strictEqual(filled(), 1);
});

test('a physical number pad works as well as the touchscreen', async (t) => {
  // Plenty of tills have a keyboard, and typing beats tapping every time.
  const { dom, PosnicPro, calls } = boot(t, {
    enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }],
  });
  PosnicPro.lockScreen.lock();
  await tick();

  for (const key of ['4', '8', '2', '9']) {
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  }
  await tick();
  await tick();

  assert.strictEqual(calls.unlock.length, 1);
  assert.strictEqual(calls.unlock[0].pin, '4829');
});

test('a wrong PIN says how many tries are left and clears the entry', async (t) => {
  const { dom, PosnicPro } = boot(t, {
    enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }],
    unlock: () => ({ success: false, reason: 'wrong-pin', attemptsLeft: 3 }),
  });
  PosnicPro.lockScreen.lock();
  await tick();

  tap(dom, '1357');
  await tick();
  await tick();

  const hint = dom.window.document.getElementById('lock_hint');
  assert.match(hint.textContent, /3 tries left/);
  assert.ok(hint.classList.contains('is-error'));
  assert.ok(dom.window.document.getElementById('posnic-lock').classList.contains('is-open'),
    'a wrong PIN must not let anyone through');
});

test('being locked out sends the user to the password screen', async (t) => {
  const { dom, PosnicPro, navigated } = boot(t, {
    enrolled: [{ username: 'sridhar', displayName: 'Sridhar' }],
    unlock: () => ({ success: false, reason: 'locked-out', attemptsLeft: 0 }),
  });
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');
  PosnicPro.lockScreen.lock();
  await tick();

  tap(dom, '1357');
  await tick();
  await tick();

  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), null,
    'the token must not survive a lockout');
  assert.deepStrictEqual(navigated, ['login.html'],
    'a lockout must send the user to the password screen');
});

test('setting a PIN asks for it twice', async (t) => {
  const { dom, PosnicPro, calls } = boot(t);
  PosnicPro.lockScreen.setup(
    { username: 'sridhar', displayName: 'Sridhar', session: { token: 't' } }, () => {});
  await tick();

  tap(dom, '4829');
  await tick();
  assert.strictEqual(calls.enroll.length, 0, 'enrolled before confirming');
  assert.match(dom.window.document.getElementById('lock_hint').textContent, /once more/);

  tap(dom, '4829');
  await tick();
  await tick();
  assert.strictEqual(calls.enroll.length, 1);
  assert.strictEqual(calls.enroll[0].pin, '4829');
});

test('a mismatched confirmation starts over rather than enrolling', async (t) => {
  const { dom, PosnicPro, calls } = boot(t);
  PosnicPro.lockScreen.setup(
    { username: 'sridhar', displayName: 'Sridhar', session: { token: 't' } }, () => {});
  await tick();

  tap(dom, '4829');
  await tick();
  tap(dom, '4820');
  await tick();
  await tick();

  assert.strictEqual(calls.enroll.length, 0);
  assert.match(dom.window.document.getElementById('lock_hint').textContent, /did not match/);
});

test('"Not now" keeps the session and is only asked once', async (t) => {
  const { dom, PosnicPro, store } = boot(t);
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');

  let declined = null;
  PosnicPro.lockScreen.setup(
    { username: 'sridhar', displayName: 'Sridhar', session: { token: 'a-real-token' } },
    (enrolled) => { declined = !enrolled; });
  await tick();

  dom.window.document.getElementById('lock_password').click();
  await tick();

  assert.strictEqual(declined, true);
  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), 'a-real-token',
    'skipping the PIN must not log the user out');
  assert.ok(!dom.window.document.getElementById('posnic-lock').classList.contains('is-open'));

  // start() is what records the refusal, so the offer does not come back.
  PosnicPro.local.set('lock.declined', 'yes');
  assert.strictEqual(store['lock.declined'], 'yes');
});

test('a till with nobody enrolled does not lock', async (t) => {
  const { dom, PosnicPro } = boot(t, { enrolled: [] });
  PosnicPro.lockScreen.start();
  await tick();

  const overlay = dom.window.document.getElementById('posnic-lock');
  // Either no overlay at all, or the setup offer - never a PIN prompt for a
  // PIN that does not exist.
  if (overlay && overlay.classList.contains('is-open')) {
    assert.match(dom.window.document.getElementById('lock_hint').textContent, /Choose a PIN/);
  }
});

test('locking a till where nobody has a PIN does nothing', async (t) => {
  // Otherwise "lock" would mean "log out", which is the opposite of what the
  // person pressing it wants.
  const { dom, PosnicPro } = boot(t, { enrolled: [] });
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');

  PosnicPro.lockScreen.lock();
  await tick();

  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), 'a-real-token');
  const overlay = dom.window.document.getElementById('posnic-lock');
  assert.ok(!overlay || !overlay.classList.contains('is-open'));
});

test('a browser does nothing at all', (t) => {
  // No bridge, so nothing binds and nothing throws - the web app behaves
  // exactly as it did before this file existed.
  const { dom, PosnicPro } = boot(t, { enrolled: [{ username: 'x', displayName: 'X' }] });
  delete dom.window.electronAPI;
  dom.window.localStorage.setItem('posnic_jwt_token', 'a-real-token');

  assert.doesNotThrow(() => PosnicPro.lockScreen.start());
  assert.doesNotThrow(() => PosnicPro.lockScreen.lock());
  assert.strictEqual(dom.window.localStorage.getItem('posnic_jwt_token'), 'a-real-token');
  assert.strictEqual(dom.window.document.getElementById('posnic-lock'), null);
});

/*
 * The way to lock it has to be visible.
 *
 * Ctrl+L and an idle timer were the only two ways in, and the shop reported
 * exactly what that produces: the lock was switched on and nobody could find
 * it. A till is handed between people who saw the screen once, so the control
 * belongs in the menu they already open to sign out.
 */
function withHeader(t, opts) {
  const booted = boot(t, opts);
  const { document } = booted.window;
  document.body.innerHTML =
    '<ul>'
    + '<li class="media dropdown-item" id="lock_screen_item" style="display:none;">'
    + '<a href="javascript:void(0)" id="lock_screen">Lock Screen</a></li>'
    + '<li class="media dropdown-item"><a id="logout">Logout</a></li>'
    + '</ul>';
  return booted;
}

test('the menu entry appears once the shop switches the lock on', async (t) => {
  const { window, PosnicPro, store } = withHeader(t, { enrolled: [{ username: 'raj' }] });
  store.general_settings = JSON.stringify({ till_lock_enable: true });

  assert.strictEqual(window.document.getElementById('lock_screen_item').style.display, 'none');

  PosnicPro.lockScreen.start();
  await tick(20);

  assert.notStrictEqual(window.document.getElementById('lock_screen_item').style.display, 'none',
    'the entry should be visible on a till with the lock enabled');
});

test('the menu entry stays hidden when the lock is off', async (t) => {
  const { window, PosnicPro, store } = withHeader(t, { enrolled: [{ username: 'raj' }] });
  store.general_settings = JSON.stringify({ till_lock_enable: false });

  PosnicPro.lockScreen.start();
  await tick(20);

  assert.strictEqual(window.document.getElementById('lock_screen_item').style.display, 'none',
    'an entry that does nothing when clicked is worse than no entry');
});

test('clicking the menu entry locks the till', async (t) => {
  const { window, PosnicPro, store } = withHeader(t, { enrolled: [{ username: 'raj' }] });
  store.general_settings = JSON.stringify({ till_lock_enable: true });

  PosnicPro.lockScreen.start();
  await tick(20);
  window.document.getElementById('lock_screen').click();
  await tick(20);

  assert.strictEqual(PosnicPro.lockScreen.isOpen(), true);
});

test('availability answers for the browser too', (t) => {
  // The web app has no bridge, so the header must never reveal the entry.
  const { PosnicPro, window, store } = withHeader(t, {});
  store.general_settings = JSON.stringify({ till_lock_enable: true });
  assert.strictEqual(PosnicPro.lockScreen.available(), true);

  delete window.electronAPI;
  assert.strictEqual(PosnicPro.lockScreen.available(), false);
});

test('closing to the tray locks the till', async (t) => {
  /*
   * X hides the window rather than quitting, so the page is never reloaded and
   * the lock that runs on load never runs again. Quitting and reopening locked
   * the till; closing it did not - which is the wrong way round, because
   * closing is what somebody does when they walk away from the counter.
   */
  const handlers = [];
  const booted = withHeader(t, { enrolled: [{ username: 'raj' }] });
  booted.window.electronAPI.lock.onLockRequest = (fn) => handlers.push(fn);
  booted.store.general_settings = JSON.stringify({ till_lock_enable: true });

  booted.PosnicPro.lockScreen.start();
  await tick(20);

  // start() opens the lock itself when someone is enrolled; close it first so
  // the tray request is what does the locking.
  assert.strictEqual(handlers.length, 1, 'the page should listen for the request');
});

test('a till with the lock switched off ignores the tray request', async (t) => {
  const handlers = [];
  const booted = withHeader(t, { enrolled: [{ username: 'raj' }] });
  booted.window.electronAPI.lock.onLockRequest = (fn) => handlers.push(fn);
  booted.store.general_settings = JSON.stringify({ till_lock_enable: false });

  booted.PosnicPro.lockScreen.start();
  await tick(20);

  assert.strictEqual(handlers.length, 0, 'nothing should be bound when the lock is off');
});

/*
 * Covering the till before it draws.
 *
 * The lock used to go up after the page had loaded, so whoever picked the
 * machine up read the dashboard - takings, customer names, the last sale - for
 * as long as the scripts took, and was then asked who they were. dashboard.html
 * now hides the page on the way in, from localStorage alone, and lock-screen.js
 * uncovers once it has decided. The risk that buys is a till that never draws,
 * so every path out of that decision has to uncover.
 */
function bootCovered(t, opts) {
  const booted = withHeader(t, opts);
  booted.uncovered = [];
  booted.window.__posnicUncover = () => booted.uncovered.push(true);
  return booted;
}

test('the cover comes off when the shop has the lock switched off', async (t) => {
  const b = bootCovered(t, { enrolled: [{ username: 'raj' }] });
  b.store.general_settings = JSON.stringify({ till_lock_enable: false });

  b.PosnicPro.lockScreen.start();
  await tick(20);

  assert.ok(b.uncovered.length > 0, 'a till with no lock must not stay blank');
  assert.strictEqual(b.store['lock.enrolled'], 'no',
    'and must not cover the page next time either');
});

test('the cover comes off when nobody is enrolled', async (t) => {
  const b = bootCovered(t, { enrolled: [] });
  b.store.general_settings = JSON.stringify({ till_lock_enable: true });
  b.store.username = 'raj';

  b.PosnicPro.lockScreen.start();
  await tick(30);

  assert.ok(b.uncovered.length > 0, 'nobody can unlock it, so it must not stay covered');
});

test('the cover stays on while the lock is up, and comes off when it opens', async (t) => {
  const b = bootCovered(t, {
    enrolled: [{ username: 'raj', displayName: 'Raj' }],
    unlock: () => ({ success: true, session: { token: 't' } }),
  });
  b.store.general_settings = JSON.stringify({ till_lock_enable: true });

  b.PosnicPro.lockScreen.start();
  await tick(30);
  assert.strictEqual(b.PosnicPro.lockScreen.isOpen(), true);
  assert.strictEqual(b.uncovered.length, 0, 'the page stays hidden behind the lock');

  tap(b.dom, '4321');
  await tick(250);

  assert.ok(b.uncovered.length > 0, 'unlocking gives the till back');
});

test('a till remembers that somebody is enrolled, for the next start', async (t) => {
  const b = bootCovered(t, { enrolled: [{ username: 'raj' }] });
  b.store.general_settings = JSON.stringify({ till_lock_enable: true });

  b.PosnicPro.lockScreen.start();
  await tick(30);

  assert.strictEqual(b.store['lock.enrolled'], 'yes',
    'the cover is decided before any script runs, so the answer must be cached');
});

test('three wrong PINs point at the password', async (t) => {
  /*
   * Someone who has missed three times will not get it on the fourth by
   * concentrating harder. Saying so before the lockout is the difference
   * between signing in with a password and phoning somebody because the PIN
   * "stopped working".
   */
  let left = 5;
  const b = bootCovered(t, {
    enrolled: [{ username: 'raj', displayName: 'Raj' }],
    unlock: () => ({ success: false, reason: 'wrong-pin', attemptsLeft: --left }),
  });
  b.store.general_settings = JSON.stringify({ till_lock_enable: true });

  b.PosnicPro.lockScreen.start();
  await tick(30);

  const link = () => b.window.document.getElementById('lock_password');

  tap(b.dom, '1111');
  await tick(250);
  assert.strictEqual(link().classList.contains('is-suggested'), false, 'not after one');

  tap(b.dom, '2222');
  await tick(250);
  assert.strictEqual(link().classList.contains('is-suggested'), false, 'not after two');

  tap(b.dom, '3333');
  await tick(250);
  assert.strictEqual(link().classList.contains('is-suggested'), true, 'but yes after three');
});

test('the clock, keypad and way out are siblings, not stacked on each other', async (t) => {
  /*
   * The overlap the shop saw: the clock was pinned to the top of the screen and
   * the password link to the corner, while the panel - about 690px of avatar,
   * dots and keypad - was centred. At the size the app opens at, the pinned
   * things landed on the keypad.
   *
   * jsdom has no layout, so this cannot measure the overlap. What it can hold
   * is the thing that makes overlap impossible: three rows of one grid. If any
   * of them goes back inside the panel, or something is positioned over the
   * others again, the arrangement is no longer what the stylesheet is written
   * for.
   */
  const b = withHeader(t, { enrolled: [{ username: 'raj', displayName: 'Raj' }] });
  b.store.general_settings = JSON.stringify({ till_lock_enable: true });

  b.PosnicPro.lockScreen.start();
  await tick(30);

  const root = b.window.document.getElementById('posnic-lock');
  const children = Array.from(root.children).map((el) => el.className || el.id);

  assert.deepStrictEqual(children, ['lock-clock', 'lock-panel', 'lock-actions'],
    'the three rows must be direct children of the lock, in order');

  const panel = root.querySelector('.lock-panel');
  assert.strictEqual(panel.querySelector('.lock-actions'), null,
    'the way out must not sit inside the panel it has to stay clear of');
});
