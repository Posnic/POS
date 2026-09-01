'use strict';

/*
 * Language handling in the frontend.
 *
 * Owner, 2026-09-01: "okay start with tamil."
 *
 * What is pinned here is the shape that made a third language impossible, so
 * it cannot come back:
 *
 *   - the current language was identified by a PAGE FILENAME
 *     ('ta_dashboard.html') compared as a literal in 63 places across 15
 *     files, which is a two-way branch with no room for a third arm;
 *   - the words themselves lived in JavaScript, where no translator could
 *     reach them - and where nine Tamil strings in sales.js had been corrupted
 *     into mojibake and shipped to the sale screen.
 *
 * See Intranet docs/MULTI_LANGUAGE_ARCHITECTURE.md for the full path.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const MODULES = path.join(FRONTEND, 'static', 'script', 'js', 'modules', 'js');
const CORE = path.join(FRONTEND, 'static', 'script', 'js', 'core', 'PosnicPro.js');
/* Language files sit at the repository root so contributors can find them. */
const LANGUAGES_DIR = path.join(__dirname, '..', 'languages');

/*
 * The WHOLE script tree, not just modules/js.
 *
 * The first pass of this work only looked at modules/js, and PosnicPro.js
 * itself quietly kept three filename comparisons and three Tamil words. A test
 * scoped more narrowly than the problem finds nothing and says so confidently.
 *
 * Vendor bundles are excluded: jQuery and friends are not ours to translate,
 * and a minified library is full of byte sequences that look like anything.
 */
const SCRIPTS = path.join(FRONTEND, 'static', 'script');
const SKIP_DIR = /^(vendor|plugins|lazy)$/;
const VENDOR_FILE = /\.min\.js$|^(jquery|bootstrap|select2|moment|summernote|jspdf|html2canvas|sortable|dexie|hasher|crossroads|signals)/i;

function ourScripts(dir = SCRIPTS, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) ourScripts(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.js') && !VENDOR_FILE.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const moduleFiles = () => ourScripts().map((f) => path.relative(SCRIPTS, f));
const read = (f) => fs.readFileSync(path.join(SCRIPTS, f), 'utf8');

/*
 * PosnicPro.js is 200KB+, so a bare indexOf('is: function') lands somewhere
 * unrelated and every assertion built on it becomes meaningless. The i18n
 * object is cut out once, and its members are found inside that.
 */
function i18nSource() {
  const core = fs.readFileSync(CORE, 'utf8');
  const start = core.indexOf('PosnicPro.i18n = {');
  assert.ok(start > 0, 'PosnicPro.i18n is missing');
  const end = core.indexOf('\nPosnicPro.i18n.load()', start);
  assert.ok(end > start, 'PosnicPro.i18n is not closed as expected');
  return core.slice(start, end);
}
/*
 * One member's source.
 *
 * Done by locating boundaries rather than with one regex: "select: function"
 * contains "t: function" as a substring, and in multiline mode `$` matches the
 * end of a LINE, so a lookahead alternation on `$` truncates every match at
 * the first newline and each assertion then passes or fails on nothing.
 */
function member(name) {
  const src = i18nSource();
  const starts = [...src.matchAll(/^ {4}([a-z_]+): function/gm)]
    .map((m) => ({ name: m[1], at: m.index }));
  const i = starts.findIndex((x) => x.name === name);
  assert.ok(i >= 0, 'PosnicPro.i18n has no ' + name + '(). Found: '
    + starts.map((x) => x.name).join(', '));
  const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
  return src.slice(starts[i].at, end);
}

/* ------------------------------------------------- the language is a code --- */

test('no module decides the language by comparing a page filename', () => {
  /*
   * This is the thing that capped us at two languages. A filename comparison
   * is a two-way branch; a third language does not fit without editing every
   * one of them.
   */
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const offenders = moduleFiles().filter((f) => /ta_dashboard\.html/.test(code(read(f))));
  assert.deepEqual(offenders, [],
    'these still identify the language by filename: ' + offenders.join(', '));
});

test('i18n.select() is the only thing that writes the language', () => {
  /*
   * Writing the filename without the code leaves i18n.code() answering with
   * the language the user just left, until the next reload.
   *
   * select() is the sanctioned writer and lives in PosnicPro.js, so the check
   * is not "nobody writes it" but "nobody else does" - and that it is written
   * inside select() rather than somewhere that merely happens to be in the
   * same file.
   */
  const offenders = moduleFiles()
    .filter((f) => f !== path.join('js', 'core', 'PosnicPro.js'))
    .filter((f) => /local\.set\(\s*'language_herf'/.test(read(f)));
  assert.deepEqual(offenders, [], 'these bypass i18n.select(): ' + offenders.join(', '));

  const core = fs.readFileSync(CORE, 'utf8');
  const writes = (core.match(/local\.set\(\s*'language_herf'/g) || []).length;
  assert.equal(writes, 1, 'the core should write language_herf exactly once');
  assert.match(member('select'), /local\.set\(\s*'language_herf'/,
    'the one write is not inside select()');
});

test('the language check has one implementation', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  assert.match(core, /PosnicPro\.i18n\s*=\s*\{/, 'PosnicPro.i18n is missing');
  for (const fn of ['code:', 'is:', 't:', 'select:', 'load:']) {
    assert.ok(core.includes(fn), 'PosnicPro.i18n has no ' + fn);
  }
});

test('an existing Tamil shop is migrated, not reset', () => {
  /*
   * Installs already hold language_herf='ta_dashboard.html' and nothing else.
   * Deriving the code from it is what stops every Tamil shop silently
   * reverting to English on upgrade.
   */
  const codeFn = member('code');
  assert.match(codeFn, /language_herf/, 'code() does not read the legacy value');
  assert.match(codeFn, /\[a-z\]\{2\}/, 'code() does not extract a code from the filename');
});

/* ------------------------------------------------ English always survives --- */

test('t() falls back to the English it was given', () => {
  /*
   * The whole safety property. Before the pack loads, if it 404s, if a key is
   * missing or a language is half done, the caller gets real English - never
   * "undefined", which is what the HTML build used to ship.
   */
  const tFn = member('t');
  assert.match(tFn, /return english/, 't() does not fall back to English');
  assert.match(tFn, /trim\(\)\s*!==\s*''/, 't() treats an empty translation as translated');
});

test('English fetches no language pack at all', () => {
  /* Nothing to fetch means nothing that can fail for most shops. */
  const loadFn = member('load');
  assert.match(loadFn, /code === 'en'/, 'English still tries to load a pack');
});

/* ------------------------------------------------------------- mojibake --- */

test('no module JS contains mojibake', () => {
  /*
   * 'à®ªà¯à®¤à®¿à®¯' is the Tamil word புதிய with its UTF-8 bytes read as
   * Latin-1. Nine of these were live on the sale screen. They are invisible in
   * review and unmistakable to a Tamil shopkeeper.
   */
  const bad = [];
  for (const f of moduleFiles()) {
    const hits = read(f).match(/[\u0080-\u00FF]{3,}/g) || [];
    if (hits.length) bad.push(`${f} (${hits.length}): ${hits[0]}`);
  }
  assert.deepEqual(bad, [], 'mojibake found:\n  ' + bad.join('\n  '));
});

test('no language file contains mojibake', () => {
  const dir = LANGUAGES_DIR;
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const dict = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(dict)) {
      if (/[\u0080-\u00FF]{3,}/.test(String(v))) bad.push(`${f}:${k} = ${String(v).slice(0, 30)}`);
    }
  }
  assert.deepEqual(bad, [], 'mojibake in a language file:\n  ' + bad.join('\n  '));
});

/* ------------------------------------------------------ the packs ship --- */

test('the build emits a pack for every non-English language', () => {
  const config = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'config.js'), 'utf8');
  /* Parse the LANGUAGES list, not every two-letter string in the file -
     require('fs') is not a language, and reading it as one made this test
     demand a languages/fs.json. */
  const arr = /const LANGUAGES = \[([\s\S]*?)\n\];/.exec(config);
  assert.ok(arr, 'config.js has no LANGUAGES list');
  const declared = [...arr[1].matchAll(/code: '([a-z]{2})'/g)].map((m) => m[1]);
  assert.ok(declared.includes('en') && declared.includes('ta'), 'config lists en and ta');
  for (const lang of declared) {
    if (lang === 'en') continue;
    assert.ok(fs.existsSync(path.join(LANGUAGES_DIR, `${lang}.json`)),
      `no languages/${lang}.json for declared language ${lang}`);
  }
  const gulp = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'index.js'), 'utf8');
  assert.match(gulp, /buildLangPacks/, 'the build has no language-pack task');
  assert.match(gulp, /parallel\([^)]*buildLangPacks/, 'buildLangPacks is not part of the build');
});

test('every language file is valid JSON with string values', () => {
  const dir = LANGUAGES_DIR;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    let dict;
    assert.doesNotThrow(() => { dict = JSON.parse(raw); }, `${f} is not valid JSON`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${f}:${k} is not a string`);
    }
  }
});

/* -------------------------------------------------- one tree, not N (L3) --- */

test('the build writes one page per screen, not one per language', () => {
  /*
   * Translating at build time wrote a complete second copy of every page for
   * each language: 2.3MB of duplicated markup to deliver 43KB of Tamil, and
   * ~23MB by the tenth language. The words are fetched at runtime now, so the
   * output must not depend on how many languages exist.
   */
  const html = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'html.js'), 'utf8');
  assert.ok(!/\$\{lang\}_\$\{item\}|lang === 'en' \? item :/.test(html),
    'the build still names output files after a language');
  assert.match(html, /markTranslatable/, 'the build does not mark pages for runtime translation');
});

test('the build sweeps per-language pages a previous build left', () => {
  /* A stale ta_dashboard.html still loads and still looks right, frozen at
     whatever the app said the day it was written. */
  const html = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'html.js'), 'utf8');
  assert.match(html, /\^\[a-z\]\{2\}_\.\+\\.html\$/, 'nothing removes stale per-language pages');
});

test('title and option carry the key on the parent, never a nested tag', () => {
  /*
   * Inside <title> and <option> the parser does not build an element for a
   * nested tag, so leaving one there prints angle brackets at the customer.
   */
  const html = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'html.js'), 'utf8');
  const fn = html.slice(html.indexOf('function markTranslatable'));
  assert.match(fn, /title\|option/, 'title and option are not special-cased');
  assert.match(fn, /data-t=/, 'the key is not hoisted onto the parent');
});

test('the marker element cannot affect layout', () => {
  /*
   * 1,351 places that used to contain bare text now contain an inline element
   * around it. display:contents removes its box entirely, so spacing is
   * unchanged on screens nobody will re-check by hand.
   */
  const css = fs.readFileSync(
    path.join(FRONTEND, 'static', 'style', 'css', 'modules', 'font.css'), 'utf8');
  assert.match(css, /lang\s*\{[^}]*display:\s*contents/,
    'lang elements have no display:contents rule');
});

test('the runtime translates both shapes', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const applyFn = member('apply');
  assert.match(applyFn, /lang\[class\]/, 'apply() does not translate <lang> tags');
  assert.match(applyFn, /\[data-t\]/, 'apply() does not translate hoisted keys');
  assert.match(applyFn, /if \(!dict\) return/, 'English should do no work at all');
  assert.ok(core.includes('DOMContentLoaded'), 'apply() never runs on its own');
});

/* ------------------------------------------------ offline, and delivery --- */

test('the service worker caches the language pack', () => {
  /*
   * Pages ship in English and the words arrive by fetch, so without this a
   * Tamil shop that loses its connection silently reverts to English - on a
   * till, in front of a customer.
   */
  const sw = fs.readFileSync(path.join(FRONTEND, 'sw-template.js'), 'utf8');
  assert.match(sw, /LANGUAGE_PACK\s*=/, 'the worker does not recognise a language pack');
  assert.match(sw, /REFERENCE\.test\(url\.pathname\) \|\| LANGUAGE_PACK\.test\(url\.pathname\)/,
    'the pack is not routed to the caching branch');
});

test('the pack is cached on first use, never precached', () => {
  /*
   * Precaching every language would put the weight back that this whole
   * exercise removed: a shop should download the one language it chose.
   */
  const sw = fs.readFileSync(path.join(FRONTEND, 'sw-template.js'), 'utf8');
  const precacheLine = sw.split('\n').find((l) => /const PRECACHE/.test(l)) || '';
  assert.ok(!/languages/.test(precacheLine), 'language packs are precached');
});

test('the language-pack pattern matches packs and nothing else', () => {
  const sw = fs.readFileSync(path.join(FRONTEND, 'sw-template.js'), 'utf8');
  const m = /const LANGUAGE_PACK = (\/.*\/);/.exec(sw);
  assert.ok(m, 'LANGUAGE_PACK is not a literal regex');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  for (const good of ['/languages/ta.json', '/languages/hi.json', '/languages/pt-BR.json']) {
    assert.ok(re.test(good), 'should match ' + good);
  }
  /* Not user uploads, not scripts, not anything that merely says "languages". */
  for (const bad of ['/uploads/languages/x.json', '/api/languages.json', '/languages/ta.js', '/settings.json']) {
    assert.ok(!re.test(bad), 'should NOT match ' + bad);
  }
});

test('the signed asset bundle carries the packs', () => {
  /*
   * The owner suggested S3. The asset channel already ships frontend/public
   * signed, staged and revertible, and the packs are written into that tree -
   * so delivery needed no new code and no second, weaker door. This pins that
   * the bundler still walks the whole tree rather than a list that could
   * forget them.
   */
  const bundler = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'build-asset-bundle.js'), 'utf8');
  assert.match(bundler, /frontend', 'public'/, 'the bundler no longer reads frontend/public');
  assert.match(bundler, /walk\(assetsDir, assetsDir\)/, 'the bundler no longer walks the tree');
  const skip = /const skip = new Set\(\[([^\]]*)\]\)/.exec(bundler);
  assert.ok(skip && !/languages/.test(skip[1]), 'language packs are excluded from the bundle');
});

/* ------------------------------------- adding a language is data only (L5) --- */

test('the language menu is generated, not hand-written', () => {
  /*
   * The header carried one <a> per language, so adding a language meant
   * editing markup - the last place it was still a code change. One English
   * entry stays in the HTML on purpose: if the list cannot be read, the menu
   * must still offer something rather than nothing.
   */
  const header = fs.readFileSync(path.join(FRONTEND, 'layouts', 'header.html'), 'utf8');
  const entries = (header.match(/<a class="dropdown-item"[^>]*data-code=/g) || []).length;
  assert.equal(entries, 1, 'the header should hold exactly one fallback entry, not one per language');
  assert.ok(!/data-id="[a-z]{2}_/.test(header), 'the menu still points at per-language filenames');

  const dash = fs.readFileSync(path.join(FRONTEND, 'static', 'script', 'js', 'modules', 'js', 'dashboard.js'), 'utf8');
  assert.match(dash, /languages\/index\.json/, 'the menu is not built from the shipped list');
  assert.match(dash, /\$\('#change_language'\)\.on\('click', 'a'/,
    'the handler is not delegated, so generated entries would be dead');
});

test('the build publishes the list the menu reads', () => {
  const gulp = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'index.js'), 'utf8');
  assert.match(gulp, /index\.json/, 'no language list is published');
  const config = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'config.js'), 'utf8');
  assert.match(config, /const LANGUAGES = \[/, 'languages carry no display names');
  /* A language a speaker cannot recognise is not offered to them. */
  assert.match(config, /name: 'தமிழ்'/, 'Tamil is not named in Tamil');
});

test('stylesheets are written once, not once per language', () => {
  /*
   * This looped the languages and wrote the same path every time - the
   * filename never carried the language - so every stylesheet was rewritten
   * once per language for no effect. Pointless work that grows with the list.
   */
  const css = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'css.js'), 'utf8');
  assert.ok(!/languages\.forEach/.test(css), 'CSS is still written once per language');
});
