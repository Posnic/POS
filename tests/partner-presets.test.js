'use strict';
/*
 * The preset list in the settings screen has to match KNOWN_PARTNERS on the
 * server.
 *
 * The ids are not cosmetic: they are what a sale stores in channel_partner and
 * what the commission report groups by. A preset that writes "swiggy_" or
 * "Swiggy" creates a second partner holding half the month, and neither total
 * is the real one. Two copies of a list is one thing to keep true; this is the
 * check that makes it one.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { KNOWN_PARTNERS } = require(path.join(ROOT, 'api', 'src', 'utils', 'sales-channels.js'));

function presets() {
  const src = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
    'utf8'
  );
  const at = src.indexOf('PosnicPro.partnerPresets = {');
  assert.ok(at !== -1, 'the preset list is gone or was renamed');
  const block = src.slice(at, src.indexOf('    ],', at));

  return [...block.matchAll(/\{ id: '([^']+)', label: '([^']+)', channel: '([^']+)' \}/g)].map(
    (m) => ({ id: m[1], label: m[2], channel: m[3] })
  );
}

test('every preset is a partner the server already knows', () => {
  const unknown = presets().filter((p) => !KNOWN_PARTNERS[p.id]);
  assert.deepStrictEqual(
    unknown.map((p) => p.id),
    [],
    'these presets would create a partner id the server has never seen'
  );
});

test('each one names the same channel the server puts it on', () => {
  /* Swiggy on ecommerce rather than marketplace would file its orders under
     the wrong heading in every channel report, quietly and for ever. */
  const wrong = presets()
    .filter((p) => KNOWN_PARTNERS[p.id].channel !== p.channel)
    .map((p) => `${p.id}: screen says ${p.channel}, server says ${KNOWN_PARTNERS[p.id].channel}`);
  assert.deepStrictEqual(wrong, []);
});

test('the labels match, so a shop sees the name it expects', () => {
  const wrong = presets()
    .filter((p) => KNOWN_PARTNERS[p.id].label !== p.label)
    .map((p) => `${p.id}: "${p.label}" vs "${KNOWN_PARTNERS[p.id].label}"`);
  assert.deepStrictEqual(wrong, []);
});

test('the big ones are actually offered', () => {
  /* Named explicitly. A list that silently shrank to two entries would still
     pass every check above. */
  const ids = presets().map((p) => p.id);
  for (const must of ['swiggy', 'zomato']) {
    assert.ok(ids.includes(must), `${must} is not offered as a preset`);
  }
  assert.ok(ids.length >= 5, `only ${ids.length} presets offered`);
});
