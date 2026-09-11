'use strict';

/*
 * Who opened this shop, and did they choose to.
 *
 * Two separate things are recorded when somebody arrives through a shadow link,
 * and both have been wrong in a way nobody could see.
 *
 * WHO. The shop decided owner-versus-support by exact-matching a sentence:
 *
 *     claims.reason === 'owner sign-in from posnic.com'
 *
 * Rewording that sentence in web-api, a different repository that deploys on
 * its own, would have silently reclassified every owner sign-in as support and
 * stopped recording any of them. Nothing would have failed. The console would
 * simply have started saying that customers never open their shops.
 *
 * WHY. Signing up now opens the shop for you, and that writes an activity row
 * like any other session. Without a mark on it, "has this customer opened their
 * shop" answers yes for everybody the instant they sign up, and stops measuring
 * anything.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'controllers', 'shadow-login.controller.js'), 'utf8');
const baseModel = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'models', 'base.model.js'), 'utf8');

test('the owner is identified by a signed claim, not by a sentence', () => {
  assert.match(controller, /claims\.actor === 'owner'/,
    'the actor is still inferred from prose, so rewording it breaks recording silently');
});

test('a token from an older web-api is still honoured', () => {
  /*
   * These deploy separately. Tokens minted before the claim existed are in
   * flight for sixty seconds, and an older web-api may run for longer than
   * that, so the sentence stays accepted as a fallback.
   */
  assert.match(controller, /claims\.reason === 'owner sign-in from posnic\.com'/,
    'dropping the old check strands tokens minted by a web-api that has not deployed yet');
});

test('support sign-ins are still not recorded as the shop being used', () => {
  /*
   * The rule the owner asked for originally: our staff opening a shop to help
   * must never look like the customer using it.
   */
  assert.match(controller, /if \(shadowActor === 'owner'\)/,
    'the activity log is written for every shadow session, including support');
});

test('the automatic open at signup is marked', () => {
  assert.match(controller, /source: claims\.from === 'signup' \? 'signup' : 'owner_link'/,
    'the shop cannot tell an open we performed from one the customer chose');
});

test('an ordinary sign-in carries no source, and the field is bounded', () => {
  /*
   * Most rows are ordinary logins and need no field. And a value arriving from
   * a token is still input, however signed: it is trimmed rather than trusted
   * to be short.
   */
  const doc = baseModel.slice(baseModel.indexOf('const document = {'),
    baseModel.indexOf('const insertResult'));
  assert.match(doc, /\.\.\.\(reqInfo\.source \? \{ source:/,
    'every activity row would carry the field, including the millions that do not need it');
  assert.match(doc, /String\(reqInfo\.source\)\.slice\(0, 32\)/,
    'an unbounded string from a token is written straight into every shop');
});

test('the shadow token record keeps why it was minted', () => {
  /* So a question about one session can be answered from the shop's own
     records rather than from a log on our side. */
  assert.match(controller, /from: claims\.from \|\| null,/,
    'the redeemed-token record does not say what kind of open it was');
});
