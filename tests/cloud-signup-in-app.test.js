'use strict';

/*
 * Installing the till should not require knowing anything technical.
 *
 * Two things stood between a shopkeeper and a working till, and neither was
 * a question they could answer:
 *
 *   - "Cloud Server", a text box with exactly one correct value, already
 *     filled in, that could only be got wrong;
 *   - "Don't have an account? Create one", which opened a web browser. That
 *     ends the installation: sign up somewhere else, wait for a verification
 *     email, come back later if at all - possibly not even at this machine.
 *
 * The sync address was never the problem: the gateway has always decided it
 * at activation and handed it back, and the till stores what it is told.
 *
 * These tests pin the parts that would fail silently - a field that quietly
 * reappears in front of customers, a spam check quietly dropped, a wait that
 * quietly applies to ordinary sign-ins too.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wizard = fs.readFileSync(path.join(ROOT, 'src', 'install-wizard.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

test('the cloud server is not a question the customer is asked', () => {
  const m = wizard.match(/<input[^>]*id="cloudServer"[^>]*>/);
  assert.ok(m, 'the cloudServer field is gone entirely - the connect handler reads it');
  assert.match(m[0], /type="hidden"/,
    'cloudServer must not be a visible text box: it has one correct value and can only be got wrong');
});

test('support can still reach the server field', () => {
  /* Hidden is right for customers; unreachable would be wrong for support. */
  assert.match(wizard, /id="cloudServerToggle"/);
  assert.match(wizard, /id="cloudServerVisible"/);
  assert.match(wizard, /cloudServerVisible'\)\.addEventListener\('input'/,
    'the visible copy must write into the real field, or a support change does nothing');
});

test('creating an account no longer opens a browser', () => {
  const handler = wizard.match(/signupLink'\)\.addEventListener\([\s\S]*?\}\);/);
  assert.ok(handler, 'the signup link handler was not found');
  assert.ok(!/cloud\?\.signup\(\)/.test(handler[0]),
    'the link must open the in-app form, not shell out to the website');
  assert.match(handler[0], /showSection\('stepCloudSignup'\)/);
});

test('the in-app form asks only what a shopkeeper knows', () => {
  for (const id of ['suBusinessName', 'suName', 'suEmail', 'suPassword']) {
    assert.match(wizard, new RegExp(`id="${id}"`), `${id} is missing from the signup form`);
  }
  /* The web address is derived from the shop name by the server, which already
     does that whenever the website omits one. Asking for it here would be the
     same mistake as the server box. */
  assert.ok(!/id="suSubdomain"/.test(wizard),
    'the customer must not be asked to invent a web address');
});

test('the spam check is kept', () => {
  /*
   * Dropping it for anything claiming to be the installer would put an
   * unauthenticated create-a-shop call on the public internet: the flag
   * saying "I am the desktop app" is trivially forged.
   */
  assert.match(wizard, /id="suCaptchaAnswer"/);
  assert.match(main, /cloud:captcha/);
  assert.match(main, /captchaToken/, 'the answer must be sent to the server, which verifies it');
});

test('a rejected attempt is handed a fresh sum', () => {
  /* The sum is single use. Reusing a spent one fails the spam check instead
     of whatever was actually wrong, which is how people end up stuck. */
  const handler = wizard.match(/suCreateBtn'\)\.addEventListener\([\s\S]*?\n        \}\);/);
  assert.ok(handler, 'the create handler was not found');
  const failureBranch = handler[0].slice(handler[0].indexOf('if (!r || !r.ok)'));
  assert.match(failureBranch, /loadCaptcha\(\)/,
    'a failed create must reload the spam check');
});

test('details already typed are carried across, not asked again', () => {
  const handler = wizard.match(/signupLink'\)\.addEventListener\([\s\S]*?\}\);/)[0];
  assert.match(handler, /suEmail'\)\.value = typedEmail/);
  const create = wizard.match(/suCreateBtn'\)\.addEventListener\([\s\S]*?\n        \}\);/)[0];
  assert.match(create, /cloudEmail'\)\.value = email/,
    'after creating an account the email must be carried to the connect step');
  assert.match(create, /cloudPassword'\)\.value = password/);
});

test('the trial starts without waiting for an email', () => {
  assert.match(main, /startTrialNow: true/,
    'the installer must ask the server to start the shop now - nobody at a till can reach an email');
});

test('waiting for the shop applies only after signing up', () => {
  /*
   * A wrong password must still fail immediately. If the wait applied to every
   * sign-in, a typo would sit behind a five-minute progress bar.
   */
  assert.match(wizard, /waitForShopMs: justSignedUp \? \d+ : 0/);
  assert.match(main, /response\.status === 401 \|\| Date\.now\(\) >= deadline/,
    'a 401 must break the retry loop - no amount of waiting fixes a wrong password');
});

test('the renderer can actually reach the new calls', () => {
  /* A handler with no preload bridge is a handler nothing can call. */
  assert.match(preload, /captcha:\s*\(\) => ipcRenderer\.invoke\('cloud:captcha'\)/);
  assert.match(preload, /createAccount:\s*\(details\) => ipcRenderer\.invoke\('cloud:create-account', details\)/);
  assert.match(main, /ipcMain\.handle\('cloud:create-account'/);
});
