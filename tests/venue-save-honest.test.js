'use strict';

/*
 * A venue that was typed is a venue that was saved, or the screen says why.
 *
 * The owner typed a hotel on the Restaurant page, pressed Save, saw "Settings
 * saved", came back, and it was gone. The row had a name and no code, and the
 * collector skipped any such row without a word: "added venue not listed".
 *
 * Three things now hold. A venue with a name gets a code from the name if none
 * was typed, and the code is written back into the box so it is seen. Two
 * venues cannot share a code, because the printed QR would not know which
 * hotel it belongs to; that is refused before the request, with both names.
 * And after a save the rows are re-read from the server, so what is on the
 * screen is what is stored, not what was typed.
 *
 * Each saved venue also shows the address its QR codes carry, which is the
 * thing a venue is for and was shown nowhere.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');

const channels = JS.slice(JS.indexOf('PosnicPro.salesChannels = {'), JS.indexOf('PosnicPro.partnerPresets = {'));
assert.ok(channels.length > 1000, 'the salesChannels namespace could not be found');

test('a venue with a name and no code is given one, and shown it', () => {
  const collect = channels.slice(channels.indexOf("$('.partner-venue-row').each"), channels.indexOf('var charges = {};'));
  assert.match(collect, /if \(name && !code\) \{\s*code = name\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, ''\)\.slice\(0, 24\);\s*\$row\.find\('\.venue-code'\)\.val\(code\);/,
    'a code-less venue is still skipped without a word');
  /* the derivation comes BEFORE the skip, or it never runs */
  assert.ok(collect.indexOf('if (name && !code)') < collect.indexOf('if (!name || !code) return;'),
    'the code is derived after the row has already been dropped');
});

test('two venues sharing a code is refused before the request, naming both', () => {
  assert.match(channels, /venueProblems: function \(\)/, 'there is no venue check');
  const save = channels.slice(channels.indexOf('    save: function () {'));
  assert.match(save, /^\s*save: function \(\) \{\s*var problem = PosnicPro\.salesChannels\.venueProblems\(\);\s*if \(problem\) \{ PosnicPro\.alert\('warning', problem\); return; \}/m,
    'save does not ask venueProblems first');
  const check = channels.slice(channels.indexOf('venueProblems: function ()'), channels.indexOf('    save: function () {'));
  assert.match(check, /lang_venue_code_clash/, 'the clash has no sentence');
  assert.match(check, /\{1\}.*\{2\}/, 'the clash sentence does not name both venues');
});

test('after a save, the rows are re-read from the server', () => {
  const at = channels.indexOf("data: JSON.stringify(PosnicPro.salesChannels.payload())");
  assert.ok(at > -1, 'the channel save request could not be found');
  const success = channels.slice(at, at + 1200);
  assert.match(success, /PosnicPro\.salesChannels\.load\(\);/,
    'a row the server normalised or dropped stays on screen looking saved');
});

test('each venue shows the address its QR codes carry', () => {
  assert.match(channels, /fillVenueLinks: function \(\)/, 'nothing builds the venue address');
  assert.match(channels, /'\/order\/' \+ id \+ '\/venue\/' \+ code\.toUpperCase\(\) \+ '\/<' \+ unit \+ '>'/,
    'the address is not the /order/<shop>/venue/<CODE>/<unit> the ordering page serves');
  assert.match(channels, /venue-link/, 'the row has no slot for the address');
  const render = channels.slice(channels.indexOf('renderVenues: function (venues)'), channels.indexOf('renderVenues: function (venues)') + 400);
  assert.match(render, /self\.fillVenueLinks\(\);/, 'the address is not filled after the rows are drawn');
  assert.match(JS, /on\('input', '\.venue-code, \.venue-unit-label, \.venue-name'/, 'the address does not follow what is typed');
});
