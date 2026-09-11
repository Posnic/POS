'use strict';

/*
 * Telling a shopkeeper how to get an API key.
 *
 * "Paste the key from your provider" assumes they have one. Most will never
 * have opened a developer console, and the step people give up on is not
 * pasting the key, it is finding the page that issues one: every provider
 * buries it somewhere different.
 *
 * The part worth testing is not that help text exists. It is that the help
 * text is TRUE for the provider it is shown under, because the two places it
 * differs are both places where being wrong costs something:
 *
 *   - Gemini has a free allowance. Telling somebody they must add a card is
 *     false, and it is exactly the sentence that makes a person close the
 *     page and not come back.
 *   - Anthropic and OpenAI show the key once and never again. Not saying so
 *     means a shopkeeper closes the tab and has to make a second key, which
 *     reads as the software having lost it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');
const js = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');

test('every provider offered has somewhere to get a key', () => {
  /*
   * A provider in the dropdown with no entry here shows the steps with a dead
   * link, which is worse than showing nothing.
   */
  const offered = [...html.matchAll(/<option value="(anthropic|openai|google)"/g)].map((m) => m[1]);
  assert.ok(offered.length >= 3, 'the provider list shrank; check this test still covers it');
  for (const provider of offered) {
    assert.ok(new RegExp(provider + ':\\s*\\{').test(js),
      provider + ' is offered in the dropdown but has no key page');
  }
});

test('the links go to the page that issues a key, not a home page', () => {
  /* "Create an account and find the API section" is the instruction people
     abandon. Deep links or it is not worth writing. */
  assert.match(js, /console\.anthropic\.com\/settings\/keys/, 'the Anthropic key page link is gone');
  assert.match(js, /platform\.openai\.com\/api-keys/, 'the OpenAI key page link is gone');
  assert.match(js, /aistudio\.google\.com\/apikey/, 'the Google key page link is gone');
});

test('the billing step tells the truth for each provider', () => {
  /*
   * Gemini has a free allowance; the other two do not work without credit.
   * One sentence for all three would be wrong for one of them whichever way
   * it was written.
   */
  assert.match(js, /paid:\s*true/, 'no provider is marked as needing payment');
  assert.match(js, /paid:\s*false/, 'no provider is marked as having a free allowance');
  assert.match(js, /lang_ai_howto_2_free/, 'the free-allowance wording is gone');
  assert.match(js, /lang_ai_howto_2_paid/, 'the add-credit wording is gone');
});

test('the "shown once" warning appears only where it is true', () => {
  /* Anthropic and OpenAI show it once. Google lets you look again, and
     warning about something that will not happen is noise that teaches people
     to skim the rest. */
  assert.match(js, /shownOnce:\s*true/, 'nothing warns that a key is shown only once');
  assert.match(js, /shownOnce:\s*false/, 'every provider now claims to show the key only once');
  assert.match(js, /lang_ai_howto_3_again/, 'the you-can-look-again wording is gone');
});

test('the link opens away from the till, safely', () => {
  /*
   * target=_blank without rel=noopener hands the opened page a handle back to
   * this one. On a screen that holds a shop's settings that is not a
   * theoretical concern.
   */
  const anchor = html.match(/<a[^>]*id="ai_key_link"[^>]*>/);
  assert.ok(anchor, 'the key link is gone');
  assert.match(anchor[0], /target="_blank"/, 'the link would navigate away from the settings page');
  assert.match(anchor[0], /rel="noopener noreferrer"/, 'the opened page can reach back into this one');
});

test('what it costs is said plainly, before anybody pays anything', () => {
  /* Somebody being asked to open a billing account deserves to know the
     order of magnitude first. Nine paise a description is the difference
     between "why" and "fine". */
  assert.match(html, /lang_ai_howto_cost/, 'the cost line is gone');
});

test('the help is hidden until a provider is chosen', () => {
  /* Instructions for a provider nobody picked are just noise on the page. */
  assert.match(html, /id="ai_key_help"[^>]*display:none/, 'the help block starts visible');
  assert.match(js, /\$\('#ai_key_help'\)\.toggle\(/, 'nothing shows or hides the help block');
});
