/*
 * The settings windows: their tabs, and the theme laid over them.
 *
 * Two faults shipped together in one installer, from opposite directions.
 *
 * Clicking Receipt Printer blanked the window. switchTab clears .active from
 * every panel and then looks the requested one up in tabMap - and tabMap had no
 * 'receipt' key, so it cleared everything and showed nothing. It looked fine
 * until you clicked, because that panel is marked active in the markup and
 * starts out visible. The first click was what broke it.
 *
 * And every gradient button rendered as an empty white box. window-theme.css
 * opened with `button, .btn { background-image: none !important }` to strip the
 * template gradients. Those buttons are styled inline as
 * `background: linear-gradient(...); color: #fff` - the shorthand leaves
 * background-color transparent, so the gradient IS the background. An
 * !important rule beats a plain inline style, so they lost their only
 * background, kept their white text, and became white on white.
 *
 * Both are the same shape of mistake: something was taken away without checking
 * what depended on it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The windows this file covers: every top-level page wearing window-theme. */
const WINDOWS = fs.readdirSync(path.join(ROOT, 'src'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => 'src/' + f)
  .filter((f) => read(f).includes('window-theme.css'));

test('the themed windows are the four settings windows', () => {
  assert.ok(WINDOWS.length >= 4, `expected at least 4, found ${WINDOWS.join(', ')}`);
});

/* ---- tabs ------------------------------------------------------------- */

for (const win of WINDOWS) {
  const html = read(win);
  if (!/function switchTab/.test(html)) continue;

  test(`${win}: every tab button lands on a panel`, () => {
    const called = [...html.matchAll(/switchTab\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(called.length > 0, 'no tab buttons found');

    const map = html.slice(html.indexOf('const tabMap'));
    const known = [...map.slice(0, map.indexOf('}')).matchAll(/'([^']+)':\s*'([^']+)'/g)];
    const byName = new Map(known.map((m) => [m[1], m[2]]));

    for (const name of new Set(called)) {
      const panel = byName.get(name);
      assert.ok(panel,
        `switchTab('${name}') has no entry in tabMap. switchTab hides every ` +
        `panel before showing the requested one, so an unmapped name blanks ` +
        `the window - which is exactly what Receipt Printer did.`);
      assert.ok(html.includes(`id="${panel}"`),
        `tabMap sends '${name}' to #${panel}, which is not in the page`);
    }
  });

  test(`${win}: no panel is orphaned`, () => {
    /* A panel nothing maps to can never be reached - dead markup that reads
       like a working feature. */
    const map = html.slice(html.indexOf('const tabMap'));
    const targets = new Set(
      [...map.slice(0, map.indexOf('}')).matchAll(/'[^']+':\s*'([^']+)'/g)].map((m) => m[1]));
    const panels = [...html.matchAll(/id="(\w+Tab)"\s+class="tab-content/g)].map((m) => m[1]);

    for (const panel of panels) {
      assert.ok(targets.has(panel), `#${panel} exists but no tab reaches it`);
    }
  });
}

/* ---- the theme laid over them ----------------------------------------- */

const THEME = read('src/window-theme.css');

/* Declaration blocks, minus comments. */
function blocks(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

test('no rule takes a background away without putting one back', () => {
  /* The whole bug in one sentence. A rule that clears background-image and
     leaves no colour hands the element whatever is behind it - and any inline
     text colour chosen to sit on the removed background is now wrong. */
  for (const { selector, body } of blocks(THEME)) {
    if (!/background-image\s*:\s*none/.test(body)) continue;

    const setsColour = /background\s*:\s*(?!none)/.test(body)
      || /background-color\s*:/.test(body);

    assert.ok(setsColour,
      `"${selector}" clears background-image but sets no background colour. ` +
      `Buttons styled inline with a gradient have no background-color of their ` +
      `own, so this makes them transparent while their white text stays.`);
  }
});

test('no bare element selector restyles every button in the window', () => {
  /* These windows are not ours to restyle wholesale - they each have their own
     stylesheet and their own inline styling. Overriding by tag catches buttons
     this file has never seen. */
  for (const { selector, body } of blocks(THEME)) {
    if (!/!important/.test(body)) continue;

    const parts = selector.split(',').map((s) => s.trim());
    assert.ok(!parts.includes('button'),
      `"${selector}" targets every button by tag with !important; ` +
      `scope it to a class this file also gives a background and a colour.`);
  }
});

test('a rule that sets text colour either sets a background or steps aside', () => {
  /* Colour without background is only safe where this file painted the surface.
     Anywhere else it can hand an element text the same colour as itself, so
     those rules exclude anything carrying an inline background. */
  const SURFACES = ['.header', '.app-header', '.tab', '.nav-tabs', '.tab-button'];

  for (const { selector, body } of blocks(THEME)) {
    if (!/(^|[;{\s])color\s*:/.test(body)) continue;
    if (/background/.test(body)) continue;          // sets both - safe
    if (/::placeholder/.test(selector)) continue;   // no background of its own

    const guarded = selector.split(',').every((s) =>
      /:not\(\[style\*="background"\]\)/.test(s)
      || SURFACES.some((surface) => s.trim().startsWith(surface)));

    assert.ok(guarded,
      `"${selector}" sets a text colour with no background and no guard. ` +
      `Add :not([style*="background"]) so markup that painted itself keeps ` +
      `the text colour it chose.`);
  }
});

test('the accent buttons still say what colour their text is', () => {
  /* Whatever else changes, a button this file claims must declare both halves
     - that is the invariant the empty white boxes violated. */
  const claimed = blocks(THEME).filter(({ selector }) =>
    /\.btn-primary|\.btn-secondary|\.primary-button|\.secondary-button/.test(selector));

  assert.ok(claimed.length >= 2, 'the button rules have gone missing');
  for (const { selector, body } of claimed) {
    assert.match(body, /background\s*:/, `"${selector}" sets no background`);
    assert.match(body, /color\s*:/, `"${selector}" sets no text colour`);
  }
});

test('a release is gated on the whole of CI, not a subset of it', () => {
  /* This has been wrong in both directions.

     First release.yml ran `npx jest tests/unit`, which ignores
     jest.ci.config.js and so ignores the known-failure quarantine - nineteen
     failing tests meant the gate failed on every tag, set higher than main by
     accident rather than by decision.

     Then it ran the CI jest config and nothing else, which is the opposite
     mistake: a tag could ship with drifted API docs, a lint error, or a module
     required at runtime and missing from the package, because every check that
     catches those lives in ci.yml and a release never called it.

     Now it calls ci.yml. Copying the jobs across would let the two drift, and
     the drift is the bug. */
  const release = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(release, /uses:\s*\.\/\.github\/workflows\/ci\.yml/,
    'release.yml must call ci.yml so a tag meets the same bar as a pull request');
  assert.match(ci, /^\s*workflow_call:/m,
    'ci.yml must be callable, or the release job cannot reach it');

  /* The build job has to depend on it. A gate that runs alongside the build
     rather than before it is decoration.

     Matched on the dependency rather than on how it is spelled: `needs` takes
     either a single job or a list, and asserting the string form meant adding
     a second gate broke this test without breaking anything real. */
  const buildNeeds = release.slice(release.indexOf('\n  build:'));
  const needsLine = buildNeeds.slice(0, 400).match(/needs:\s*(\[[^\]]*\]|\S+)/);
  assert.ok(needsLine, 'the build job declares no dependencies at all');
  assert.match(needsLine[1], /verify/,
    'the build job must wait for the CI gate');
  assert.match(needsLine[1], /gate/,
    'the build job must also wait for the release gate, or an unsigned build ' +
    'with update verification off could still be published');

  /* Everything the installer bundles is generated and gitignored, so a fresh
     checkout has none of it. Calling electron-builder directly - which is what
     this did - skips the prebuild hook that produces it locally and packages an
     app with its extraResources missing. */
  assert.match(release, /npm run prepare:bundle/,
    'the release build must prepare the bundle, or it ships without one');
});
