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

/*
 * Screenshots by convention.
 *
 * The owner has to take these - they are pictures of his running shop. Every
 * other part is built so that dropping a file in
 * static/images/features/<key>-1.png is his only remaining action.
 */
test('a feature with no screenshot costs ONE failed request, not three', () => {
  /* The first version rendered -1, -2 and -3 speculatively. That is three 404s
     every time a dialog opens for a feature with no images - which is every
     feature today - on the same day spent removing wasted requests. Asking for
     the next only after the current one LOADS makes the chain self-extending
     and the empty case cheap. */
  const render = settingsJs.slice(settingsJs.indexOf('var shots = info.shots || [];'));
  const block = render.slice(0, render.indexOf("infoHtml += '<div class=\"q-label\">About"));
  const probes = (block.match(/static\/images\/features\//g) || []).length;
  assert.strictEqual(probes, 1, 'more than one screenshot path is requested up front');
  assert.match(block, /onload="PosnicPro\.settings\._shotNext\(this\);"/, 'the chain never extends');
  assert.match(block, /data-shot-key=/, 'the next probe has no key to build a path from');
});

test('a missing screenshot leaves no trace', () => {
  /* Otherwise a feature with no images keeps a broken-image icon, or an empty
     14px strip with a scroll container holding nothing. */
  const fn = settingsJs.slice(settingsJs.indexOf('PosnicPro.settings._shotMissing = function'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /\$\(img\)\.remove\(\)/, 'the broken frame stays');
  assert.match(body, /if \(!\$strip\.find\('img'\)\.length\) \{ \$strip\.remove\(\); \}/, 'the empty strip stays');
});

test('the probe chain cannot run away', () => {
  /* It is driven by the server answering 200. A directory that somehow served
     every name would ask forever. */
  const fn = settingsJs.slice(settingsJs.indexOf('PosnicPro.settings._shotNext = function'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /n >= PosnicPro\.settings\.MAX_SHOTS/, 'nothing caps the chain');
  assert.match(body, /data-shot-n="' \+ \(n \+ 1\) \+ '"\]'\)\.length\) \{ return; \}/, 'a re-fired onload would duplicate frames');
});

test('an explicit shots list still wins', () => {
  /* Anything that does not fit the naming must remain expressible. */
  const render = settingsJs.slice(settingsJs.indexOf('var shots = info.shots || [];'));
  const block = render.slice(0, render.indexOf("infoHtml += '<div class=\"q-label\">About"));
  assert.match(block, /if \(shots\.length\) \{[\s\S]*\} else if \(key\) \{/, 'the convention must be the FALLBACK, not the rule');
});

test('the drop folder documents itself', () => {
  /* A convention nobody can find is not a convention. */
  const readme = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'images', 'features', 'README.md'),
    'utf8',
  );
  assert.match(readme, /8:5/, 'the required aspect is not stated');
  assert.match(readme, /cropped to fit/i, 'it must warn that another ratio is cropped, not letterboxed');
  for (const key of ['quotes_enable', 'module_themes_enable']) {
    assert.ok(readme.includes(`${key}-1.png`), `${key} is not listed as a filename to add`);
  }
});
