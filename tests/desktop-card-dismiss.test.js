'use strict';

/*
 * Closing the desktop-app card has to close it.
 *
 * The card sits under the login form on every web login, and its small x is
 * the only way out of it. The dismissal remembers itself in localStorage,
 * which is right - but localStorage is not merely unreliable, it THROWS: a
 * private window, or a browser set to block site data, raises on both get and
 * set rather than returning null.
 *
 * That made the handler order load-bearing. With setItem first, the throw
 * happened before el.remove(), so on those browsers clicking the x did
 * nothing at all - the card stayed exactly where it was, and the one thing a
 * dismiss button must never do is refuse to dismiss. Closing is what the
 * click asked for; remembering is the nice-to-have that may fail.
 *
 * The read is guarded for the same reason: an unguarded getItem threw inside
 * the injector and took the rest of it down with it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const login = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'login.html'),
  'utf8'
);

/* The card's dismiss handler, from the x's onclick to the end of the body. */
function dismissHandler() {
  const start = login.indexOf("posnic_app_card_x').onclick");
  assert.notStrictEqual(start, -1, 'the dismiss handler moved or was renamed');
  const end = login.indexOf('})();', start);
  assert.notStrictEqual(end, -1, 'could not find the end of the injector');
  return login.slice(start, end);
}

test('the card is removed before the choice is stored', () => {
  const body = dismissHandler();
  const removeAt = body.indexOf('el.remove()');
  const setAt = body.indexOf('localStorage.setItem');
  assert.notStrictEqual(removeAt, -1, 'the handler no longer removes the card');
  assert.notStrictEqual(setAt, -1, 'the handler no longer remembers the choice');
  assert.ok(
    removeAt < setAt,
    'el.remove() must come BEFORE setItem - storage that throws would otherwise '
      + 'leave the card on screen after the user clicked to close it'
  );
});

test('storing the choice cannot throw out of the handler', () => {
  const body = dismissHandler();
  const setAt = body.indexOf('localStorage.setItem');
  const tryAt = body.lastIndexOf('try', setAt);
  assert.ok(
    tryAt !== -1 && tryAt < setAt,
    'setItem must sit inside a try/catch - it throws where site data is blocked'
  );
});

test('reading the choice cannot throw out of the injector', () => {
  const readAt = login.indexOf("getItem('posnic_web_ok')");
  assert.notStrictEqual(readAt, -1, 'the dismissal guard is gone - the card would show forever');
  const tryAt = login.lastIndexOf('try', readAt);
  const guardStart = login.indexOf("navigator.userAgent.indexOf('Electron')");
  assert.ok(
    tryAt !== -1 && tryAt > guardStart && tryAt < readAt,
    'getItem must sit inside a try/catch - it throws in a private window'
  );
});

test('the dismissal is not among the keys logout clears', () => {
  /*
   * Logout clears named keys one by one. If posnic_web_ok were ever added to
   * that list, every logout would resurrect the card on the very next page
   * the user sees - which is the login page carrying it.
   */
  const users = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'users.js'),
    'utf8'
  );
  const start = users.indexOf('logoutCheck: function');
  assert.notStrictEqual(start, -1, 'logoutCheck moved');
  const scope = users.slice(start, start + 4000);
  assert.ok(
    !scope.includes('posnic_web_ok'),
    'logout must not clear posnic_web_ok - the dismissal is meant to outlive the session'
  );
});
