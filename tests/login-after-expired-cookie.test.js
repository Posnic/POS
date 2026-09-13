'use strict';

/*
 * A shop with an expired login can still sign in.
 *
 * Reported on pugazhfashion26: "Your session security token is missing or
 * expired. Refresh and try again", on every login attempt, until the site's
 * storage was cleared. Three things conspired: the login cookie is kept for
 * seven days while the token inside it lasts one; the CSRF middleware bound a
 * token to the dead cookie; and the page only learned tokens from responses
 * that succeeded, which on a login page with a dead cookie is none of them.
 *
 * The server side is pinned in api/tests/unit/middleware. This pins the page
 * side, and that the three pieces stay wired the way they have to be.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const AJAX = read('frontend', 'static', 'script', 'js', 'core', 'ajax.js');
const CSRF = read('api', 'src', 'middleware', 'csrf.js');
const AUTH = read('api', 'src', 'middleware', 'auth.js');

test('the page learns the token from a refused answer too, not only from a successful one', () => {
  const fail = AJAX.slice(AJAX.indexOf('request.fail(function (xhr, status, error) {'));
  assert.match(fail, /getResponseHeader\('X-CSRF-TOKEN'\)/, 'a failed request drops the token it was handed');
  assert.match(fail, /PosnicPro\.csrfToken = refreshed;/);
  const done = AJAX.slice(AJAX.indexOf('request.done('), AJAX.indexOf('request.fail('));
  assert.match(done, /getResponseHeader\('X-CSRF-TOKEN'\)/, 'the successful path stopped learning the token');
});

test('a cookie that does not verify is not a credential, and the token secret survives a restart', () => {
  assert.match(CSRF, /if \(cookie && liveCookie\(cookie\)\) return `jwt:\$\{cookie\}`;/, 'a dead cookie still binds a token');
  assert.match(CSRF, /jwt\.verify\(token, key\);/, 'the cookie is not verified before it is trusted');
  assert.match(CSRF, /createHmac\('sha256', String\(base\)\)\.update\('posnic:csrf'\)/, 'the token secret is random per process again');
  assert.ok(CSRF.indexOf("process.env.CSRF_SECRET") < CSRF.indexOf("ephemeralSecret('CSRF_SECRET')"), 'an explicit secret is not preferred');
});

test('a dead cookie is cleared as it is refused, by both guards, and only when the cookie carried it', () => {
  assert.match(AUTH, /const dropDeadCookie = \(req, res, token\) => \{\s*if \(!token \|\| !req\.cookies \|\| req\.cookies\.jwt !== token\) return;/);
  const protect = AUTH.slice(AUTH.indexOf('const protect = async (req, res, next) => {'), AUTH.indexOf('const isLoggedIn ='));
  assert.strictEqual((protect.match(/dropDeadCookie\(req, res, token\);/g) || []).length, 2, 'protect does not clear the cookie on both bad-token answers');
  const guard = AUTH.slice(AUTH.indexOf('const auth = async (req, res, next) => {'), AUTH.indexOf('const getTokenFromRequest ='));
  assert.match(guard, /dropDeadCookie\(req, res, getTokenFromRequest\(req\)\);/, 'the heartbeat guard leaves the dead cookie in place');
});
