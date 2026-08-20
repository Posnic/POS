const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt } = require('./helpers/source-lookup');

/*
 * Frontend cutover to the per-group settings endpoints (design step S3).
 *
 * S1-S6 built a path where a partial save cannot demand a field it does not
 * own. None of that protects anyone until the screens actually call it, and
 * the screens that mattered are the three PARTIAL saves - the ones behind all
 * three production bugs of 2026-08-20:
 *
 *   - the signature upload, which returned "Default customer is required"
 *     because the shared validator demanded fields from another group
 *   - the feature toggles, which invented sales_prefix:'SAL' and
 *     receiving_prefix:'REC' to get past that same validator
 *   - the quotation defaults
 *
 * The whole-form saves legitimately span groups and stay on the legacy
 * endpoint, which is what the design means by "the god endpoint sees only
 * legacy traffic".
 *
 * The strongest assertion here compares each client payload against the
 * SERVER's own group map, so the two cannot drift apart in either direction.
 */

const ROOT = path.join(__dirname, '..');
const settingsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
  'utf8',
);
const salesJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8',
);
const GROUPS = require(path.join(ROOT, 'api', 'src', 'services', 'settings-groups')).GROUPS;


test('the signature upload posts to the documents endpoint', () => {
  const handler = blockAt(salesJs, "$(document).on('change', '#qe_sig_file', function () {");
  assert.match(handler, /url: 'settings\/group\/documents'/);
  assert.ok(
    !handler.includes('setting/updateCommonSettings'),
    'this exact call is the one that 400d on a field it never sent',
  );
  // and the key it sends really is a documents key
  assert.ok(GROUPS.documents.includes('quote_default_signature'));
});

test('the feature toggles post to the features endpoint', () => {
  const fn = blockAt(settingsJs, '    saveIntro: function () {');
  assert.match(fn, /url: 'settings\/group\/features'/);
  assert.ok(!fn.includes('setting/updateCommonSettings'));
});

test('and they no longer invent values for fields they do not own', () => {
  const fn = blockAt(settingsJs, '    saveIntro: function () {');
  /* sales_prefix:'SAL' and receiving_prefix:'REC' were sent purely to satisfy
     a validator. They were described as ignored, but nothing guaranteed it -
     the day that path stopped skipping them, every shop saving a toggle would
     have had its receipt numbering overwritten with invented values. */
  /* Match the ASSIGNMENT, not the name: the comment above this code explains
     what was removed and names both fields, and a bare substring check would
     read that prose as the bug it describes. */
  assert.ok(
    !/payload\.sales_prefix\s*=/.test(fn),
    'an invented prefix is a live data hazard',
  );
  assert.ok(
    !/payload\.receiving_prefix\s*=/.test(fn),
    'an invented prefix is a live data hazard',
  );
  assert.ok(
    !/modules_only:/.test(fn),
    'the per-group endpoint needs no control word',
  );
});

test('every toggle it sends is genuinely a features key', () => {
  // the payload is built from the INTRO list, so check that list
  const intro = blockAt(settingsJs, '    INTRO: [');
  const keys = [...intro.matchAll(/\['([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `expected the intro list, found ${keys.length} keys`);
  const strays = keys.filter((k) => !GROUPS.features.includes(k));
  assert.deepStrictEqual(
    strays,
    [],
    'a key outside the group would be refused by name, failing the whole save',
  );
});

test('the quotation defaults post to the documents endpoint', () => {
  const handler = blockAt(settingsJs, "$(document).on('click', '#quote_settings_save', function () {");
  assert.match(handler, /url: 'settings\/group\/documents'/);

  // every key in that payload must belong to documents
  const keys = [...handler.matchAll(/^\s{8}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 3, `expected the payload keys, found ${keys.length}`);
  const strays = keys.filter((k) => !GROUPS.documents.includes(k));
  assert.deepStrictEqual(strays, [], 'a foreign key here would be refused by name');
});

test('the plural path - /setting/ is not mounted for the group routes', () => {
  // routes/index.js mounts /settings/group, and /setting only reaches the
  // legacy router; a singular call would 404
  const routes = fs.readFileSync(path.join(ROOT, 'api', 'src', 'routes', 'index.js'), 'utf8');
  assert.match(routes, /router\.use\('\/settings\/group'/);
  for (const src of [settingsJs, salesJs]) {
    assert.ok(
      !/'setting\/group\//.test(src),
      'the group routes are only mounted under the PLURAL settings path',
    );
  }
});

test('the whole-form saves stay on the legacy endpoint, deliberately', () => {
  /* They span several groups plus keys in none of them. Splitting one save
     into four requests would trade a validation bug for a partial-write bug,
     which is worse: half the form saved and half not, with no way to tell. */
  const remaining = (settingsJs.match(/setting\/updateCommonSettings/g) || []).length;
  assert.strictEqual(remaining, 2, `expected the two whole-form saves, found ${remaining}`);
  assert.ok(
    !salesJs.includes('setting/updateCommonSettings'),
    'the sale screen has no whole-form save and should not touch the god endpoint',
  );
});
