'use strict';

/*
 * The sign-in screen stops telling you that you are not signed in.
 *
 * Owner, on a first cloud install: "i see same error as soon firts time cloud
 * download... i dont want auto login. but remove this error."
 *
 * The page loads, something in the shared bundle asks the API a question that
 * needs a session, the API correctly says there is none, and the shopkeeper
 * gets a red alert reading "You are not logged in! Please log in to get
 * access." on the screen whose entire purpose is that they are not logged in
 * yet. It was the first thing a new cloud install put in front of somebody.
 *
 * The trap in fixing it: a WRONG PASSWORD also comes back 401, with "Incorrect
 * email or password" (users.controller login, httpStatus.UNAUTHORIZED).
 * Suppressing 401s on this page by status alone would leave the Log in button
 * doing nothing at all when the password is wrong - a far worse bug than the
 * one being fixed. So the two are told apart by where the request went.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AJAX = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'ajax.js'), 'utf8');
const USERS = fs.readFileSync(path.join(ROOT, 'api', 'src', 'controllers', 'users.controller.js'), 'utf8');

test('an expected 401 on the sign-in screen is silent', () => {
  assert.match(AJAX, /var unauthenticatedOnAuthPage = onAuthPage\s*&& xhr && xhr\.status === 401/,
    'the quiet case is not recognised');
  assert.match(AJAX, /if \(unauthenticatedOnAuthPage\) \{/, 'nothing acts on it');
  assert.match(AJAX, /console\.debug\('\[auth\] no session yet on the sign-in screen/,
    'it is silent to a developer too, which makes it look like nothing happened');
});

test('the sign-in attempt itself still speaks, because a wrong password is a 401', () => {
  /* If this ever becomes a plain status check, a wrong password shows nothing
     and the button appears dead. */
  assert.match(AJAX, /&& !\/login\/i\.test\(String\(url \|\| ''\)\)/,
    'a failed sign-in would be swallowed along with the background reads');
  /* And the reason that matters: the server really does answer 401 here. */
  assert.match(USERS, /new AppError\('Incorrect email or password', httpStatus\.UNAUTHORIZED\)/,
    'the login failure status changed; re-check the rule in ajax.js');
});

test('everything that is not this case still shows, on every other page', () => {
  const fail = AJAX.slice(AJAX.indexOf('request.fail(function (xhr, status, error) {'));
  assert.match(fail, /\} else if \(!isThemeSettingsMissing && response && response\.message\) \{\s*PosnicPro\.alert\(/,
    'the ordinary error toast was removed rather than narrowed');
  /* A 401 away from the sign-in screen must still send the user back to it. */
  assert.match(fail, /401/, 'the redirect on an expired session is gone');
});

test('no auto sign-in was added, because that was not wanted', () => {
  /* Owner: "i dont want auto login." Activation hands the till a device
     credential, not a person, and nothing here should quietly change that. */
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.ok(!/autoLogin|signInAfterActivation|autoSignIn/i.test(main),
    'something now signs a user in after cloud activation');
});
