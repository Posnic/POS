const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The feature detail dialogs (FEATURE_PAGES_DESIGN).
 *
 * Every Core feature opens like a marketplace listing. Nine of them opened with
 * nothing but their one-line card description, which reads as unfinished rather
 * than as "no detail available" - so the copy was written on 2026-08-21.
 *
 * These tests exist for the two ways that copy can be wrong in a way nobody
 * notices: a feature that has no entry at all, and a `section` anchor naming a
 * markup block that does not exist. The renderer guards the second with
 * $(info.section).length, so an invented anchor breaks nothing and sits there
 * reading as wired - which is precisely why it needs a test rather than a
 * glance. The first draft of this copy invented SEVEN of them.
 */

const ROOT = path.join(__dirname, '..');
const settingsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
  'utf8',
);
const settingsHtml = fs.readFileSync(
  path.join(ROOT, 'frontend', 'modules', 'settings_write.html'),
  'utf8',
);

const infoBlock = (() => {
  const at = settingsJs.indexOf('PosnicPro.settings.featureInfo = {');
  assert.notStrictEqual(at, -1, 'featureInfo is gone');
  return settingsJs.slice(at, settingsJs.indexOf('\n};', at));
})();

const introKeys = (() => {
  const at = settingsJs.indexOf('INTRO:');
  assert.notStrictEqual(at, -1, 'the feature INTRO list is gone');
  const block = settingsJs.slice(at, settingsJs.indexOf('\n    ],', at));
  return [...block.matchAll(/\['([a-z_0-9]+)',/g)].map((m) => m[1]);
})();

const infoKeys = [...infoBlock.matchAll(/^ {4}([a-z_0-9]+): \{/gm)].map((m) => m[1]);

test('every feature on the intro list has detail copy', () => {
  /* A dialog that opens with only its one-line card description reads as
     unfinished software, not as a feature with little to say. */
  assert.ok(introKeys.length >= 14, 'the intro list shrank unexpectedly');
  const missing = introKeys.filter((k) => !infoKeys.includes(k));
  assert.deepStrictEqual(missing, [], `these features open with no detail: ${missing.join(', ')}`);
});

test('every entry actually says something', () => {
  for (const key of infoKeys) {
    const at = infoBlock.indexOf(`    ${key}: {`);
    const entry = infoBlock.slice(at, infoBlock.indexOf('\n    },', at));
    assert.match(entry, /tagline: '[^']{20,}'/, `${key} has no usable tagline`);
    assert.match(entry, /about: '[^']{60,}'/, `${key} has no usable About text`);
    assert.match(entry, /benefits: \[/, `${key} lists no benefits`);
    assert.match(entry, /how: \[/, `${key} does not say how to use it`);
  }
});

test('every section anchor names a block that exists', () => {
  /* THE ONE THAT MATTERS. `section` names the markup whose controls the dialog
     adopts, and the renderer skips a missing one silently - so an invented
     anchor costs nothing at runtime and looks wired forever. Only four of these
     blocks exist; the first draft of this copy invented seven more. */
  const sections = [...new Set([...infoBlock.matchAll(/section: '#([a-z_0-9]+)'/g)].map((m) => m[1]))];
  assert.ok(sections.length > 0, 'no feature adopts its settings any more');
  for (const id of sections) {
    assert.ok(
      settingsHtml.includes(`id="${id}"`),
      `#${id} is named as a settings section but no markup defines it`,
    );
  }
});

test('the renderer still guards a missing section', () => {
  /* The guard is what makes an invented anchor harmless rather than a crash.
     Removing it would turn the mistake above into a broken dialog. */
  assert.match(
    settingsJs,
    /if \(info\.section && \$\(info\.section\)\.length\)/,
    'a missing section would throw instead of being skipped',
  );
});
