'use strict';

/*
 * A sign-in screen has no session. That is not something to shout about.
 *
 * Owner, opening a freshly downloaded till: "i see same error as soon firts
 * time cloud download. i think as suggest i dont want auto login. but remove
 * this error."
 *
 * The red toast said "You are not logged in!" across the sign-in form, and it
 * read as the cloud sign-in having failed. Nothing had failed. The page fetches
 * its theme and its settings before anybody has typed a password, the server
 * answers 401 because there is no session yet, and the failure handler toasted
 * whatever sentence came back with it.
 *
 * What must NOT change: a wrong password still has to say so, and every 401
 * away from the sign-in screen still has to send the person back to it.
 *
 * These tests run the shipped failure handler itself, lifted out of ajax.js and
 * handed a fake till, so they exercise the branching rather than describe it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'ajax.js'),
  'utf8'
);

/** The `request.fail(...)` handler, lifted whole out of ajax.js. */
function handlerSource() {
  const marker = 'request.fail(function (xhr, status, error) {';
  const start = SRC.indexOf(marker);
  assert.notStrictEqual(start, -1, 'the failure handler moved or changed shape');
  const open = SRC.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) return SRC.slice(open, i + 1); }
  }
  throw new Error('unbalanced braces in the failure handler');
}

/**
 * Run it. `at` is the page the browser is on, `url` the call that failed.
 * Returns the toasts raised and wherever the browser was sent.
 */
function fail({ at = '/login.html', url = 'setting/getThemeSettings', status = 401, body = null, hasFailureCallback = false } = {}) {
  const toasts = [];
  let wentTo = null;

  const PosnicPro = {
    alert: (type, message) => toasts.push({ type, message }),
    i18n: { t: (key, english) => english },
    local: { get: () => 'ravi' },
    users: { createCookie: () => {} },
    themeManager: null,
    csrfToken: null,
  };
  const fakeWindow = {
    get location() { return { pathname: at }; },
    set location(v) { wentTo = v; },
  };
  const xhr = {
    status,
    responseJSON: body,
    responseText: body ? JSON.stringify(body) : '',
    getResponseHeader: () => null,
  };
  const $ = () => ({ remove() {} });

  const body_ = 'function (xhr, status, error) ' + handlerSource();
  const run = new Function(
    '$', 'PosnicPro', 'window', 'navigator', 'localStorage', 'console', 'url', 'failure',
    'return ' + body_ + ';'
  )(
    $, PosnicPro, fakeWindow, { userAgent: 'Mozilla' }, { removeItem() {}, setItem() {} },
    { debug() {}, error() {}, log() {} },
    url, hasFailureCallback ? () => {} : null
  );

  run(xhr, 'error', 'error');
  return { toasts, wentTo, PosnicPro };
}

test('asking for settings before signing in says nothing at all', () => {
  const { toasts, wentTo } = fail({
    at: '/login.html',
    url: 'setting/getGeneralSettings',
    status: 401,
    body: { type: 'error', message: 'You are not logged in!' },
  });
  assert.deepStrictEqual(toasts, [], 'the sign-in screen still shouts about having no session');
  assert.strictEqual(wentTo, null, 'the sign-in screen redirected to itself');
});

test('a 401 with no body on the sign-in screen is just as quiet', () => {
  /* Otherwise it falls through to "Something went wrong", which is worse:
     it does not even say what. */
  const { toasts } = fail({ at: '/login.html', url: 'setting/getThemeSettings', status: 401, body: null });
  assert.deepStrictEqual(toasts, []);
});

test('the root path counts as the sign-in screen', () => {
  const { toasts } = fail({
    at: '/', url: 'setting/getGeneralSettings', status: 401,
    body: { type: 'error', message: 'You are not logged in!' },
  });
  assert.deepStrictEqual(toasts, []);
});

test('a wrong password still says so', () => {
  const { toasts } = fail({
    at: '/login.html', url: 'users/verify', status: 401,
    body: { type: 'error', message: 'Wrong username or password' },
  });
  assert.deepStrictEqual(toasts, [{ type: 'error', message: 'Wrong username or password' }],
    'signing in can now fail silently, which is worse than the toast we removed');
});

test('single sign-on failing still says so', () => {
  const { toasts } = fail({
    at: '/ssoauth.html', url: 'users/ssoClientLogin', status: 401,
    body: { type: 'error', message: 'That link has expired' },
  });
  assert.strictEqual(toasts.length, 1);
});

test('anything that is not a 401 still speaks up on the sign-in screen', () => {
  const { toasts } = fail({
    at: '/login.html', url: 'setting/getGeneralSettings', status: 500,
    body: { type: 'error', message: 'Database unreachable' },
  });
  assert.deepStrictEqual(toasts, [{ type: 'error', message: 'Database unreachable' }]);
});

test('a 401 away from the sign-in screen still sends the person back to it, with the reason', () => {
  const { wentTo } = fail({
    at: '/dashboard.html', url: 'sales', status: 401,
    body: { type: 'error', message: 'Your session has expired.' },
  });
  assert.match(String(wentTo), /^login\.html\?msg=/, 'an expired session no longer returns to sign-in');
  assert.match(String(wentTo), /Your%20session%20has%20expired\./, 'the reason was dropped on the way');
});

test('the quiet branch is decided by the status code, not by the sentence', () => {
  /* The server has at least five ways of saying "not authenticated" and grew
     another the day a secret was rotated. Matching sentences is what made this
     handler unreliable in the first place. */
  assert.match(SRC, /var noSessionYet = onAuthPage && xhr && xhr\.status === 401 && !signInCall;/);
  assert.match(SRC, /var signInCall = \/users\\\/\(verify\|ssoClientLogin\)\/i\.test\(String\(url \|\| ''\)\);/,
    'the sign-in calls are matched some other way; check a wrong password still speaks');
});
