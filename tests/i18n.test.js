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
const { spawnSync } = require('child_process');

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

  /*
   * Walked, not iterated one level deep. _glossary.json nests its words one
   * object further down, and a shallow loop stringified those objects to
   * "[object Object]", which never matches - so the one file where every word
   * is now authored would have been the one file this test could not see.
   */
  const walk = (node, where, file) => {
    if (typeof node === 'string') {
      if (/[\u0080-\u00FF]{3,}/.test(node)) bad.push(`${file}:${where} = ${node.slice(0, 30)}`);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, where ? `${where}.${k}` : k, file);
    }
  };

  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), '', f);
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
  /* A leading underscore means "not a language pack". _glossary.json is the
     source the packs are seeded from, and its values are objects of languages
     rather than strings. The mojibake test above still reads it, because that
     is the check it must never be exempt from. */
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
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

test('every declared language has a pack, and every pack is declared', () => {
  /*
   * A language in the menu with no file behind it is a menu entry that does
   * nothing. A file nobody declared is work that will never appear on screen -
   * the more disheartening of the two if a contributor wrote it.
   */
  const config = require(path.join(FRONTEND, 'gulpfile.js', 'config.js'));
  const declared = config.LANGUAGES.map((l) => l.code).filter((c) => c !== 'en');
  const onDisk = fs.readdirSync(LANGUAGES_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace(/\.json$/, ''));

  const missing = declared.filter((c) => !onDisk.includes(c));
  assert.deepEqual(missing, [], 'declared with no languages/<code>.json: ' + missing.join(', '));

  const undeclared = onDisk.filter((c) => !declared.includes(c));
  assert.deepEqual(undeclared, [],
    'a pack exists but no LANGUAGES entry offers it: ' + undeclared.join(', '));
});

test('the glossary agrees with itself', () => {
  /*
   * The glossary is the one file where a mistake reaches every screen of a
   * language at once, so it is worth more checking than a single key.
   */
  const glossary = JSON.parse(
    fs.readFileSync(path.join(LANGUAGES_DIR, '_glossary.json'), 'utf8'));
  const known = new Set(glossary.languages);

  const strays = [];
  for (const [term, byLang] of Object.entries(glossary.terms)) {
    for (const [code, word] of Object.entries(byLang)) {
      if (!known.has(code)) strays.push(`${term}: "${code}" is not in the languages list`);
      if (typeof word !== 'string') strays.push(`${term}.${code} is not text`);
      else if (word !== word.trim()) strays.push(`${term}.${code} has a stray space: "${word}"`);
    }
  }
  assert.deepEqual(strays, [], 'glossary problems:\n  ' + strays.join('\n  '));

  /* Terms that must never be translated: a shopkeeper matches GST and its
     relatives against a government form, character for character. */
  assert.ok(glossary.doNotTranslate.includes('GST'), 'GST is not protected from translation');
  for (const term of glossary.doNotTranslate) {
    assert.ok(!Object.prototype.hasOwnProperty.call(glossary.terms, term),
      `${term} is marked do-not-translate but has translations in the glossary`);
  }
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

/* --------------------------------------- every language ships, honestly --- */

test('every declared language ships by default, and says whether a speaker has read it', () => {
  /*
   * Owner, 2026-09-02: ship them all; the community improves them over time.
   *
   * A gate that hides a language until it is perfect is a language nobody
   * will ever correct - the people who could fix it are exactly the people who
   * would have picked it. What ships instead of the gate is honesty: every
   * entry says whether a speaker has read it, and the menu turns that into a
   * "beta" mark beside the name. Every missing word is still English.
   */
  const config = require(path.join(FRONTEND, 'gulpfile.js', 'config.js'));
  assert.ok(!config.reviewedOnly,
    'POSNIC_REVIEWED_LANGUAGES_ONLY is set in the test environment, so this proves nothing');
  assert.deepEqual(config.shippedLanguages.map((l) => l.code), config.LANGUAGES.map((l) => l.code),
    'the default build leaves a declared language out');
  for (const l of config.LANGUAGES) {
    assert.equal(typeof l.reviewed, 'boolean', l.code + ' does not say whether it was reviewed');
  }
  const reviewed = config.LANGUAGES.filter((l) => l.reviewed).map((l) => l.code);
  assert.ok(reviewed.includes('en') && reviewed.includes('ta'), 'English and Tamil are the reviewed pair');
});

test('an installer can still ask for reviewed languages only', () => {
  /* The env is read when config.js loads, so it has to be a fresh process. */
  const r = spawnSync(process.execPath, ['-e',
    'console.log(JSON.stringify(require(process.argv[1]).shippedLanguages.map((l) => l.code)))',
    path.join(FRONTEND, 'gulpfile.js', 'config.js')],
    { encoding: 'utf8', env: { ...process.env, POSNIC_REVIEWED_LANGUAGES_ONLY: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), ['en', 'ta']);
});

test('the shipped list carries direction, review state and coverage', () => {
  /*
   * index.json is what the menu reads. Direction lets the menu entry itself
   * render right-to-left; reviewed drives the beta mark; coverage is the
   * number a translator wants to see move, computed by the SAME tool the
   * coverage report and the translations CI use, so the build cannot
   * disagree with them.
   */
  const gulp = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'index.js'), 'utf8');
  assert.match(gulp, /reviewed: !!l\.reviewed/, 'index.json entries do not carry reviewed');
  assert.match(gulp, /entry\.coverage =/, 'index.json entries do not carry coverage');
  assert.match(gulp, /i18n-coverage\.js/, 'coverage is not computed by the tool CI uses');
  const config = require(path.join(FRONTEND, 'gulpfile.js', 'config.js'));
  assert.equal(config.LANGUAGES.find((l) => l.code === 'ar').dir, 'rtl', 'Arabic is not declared right-to-left');
});

test('the menu marks an unreviewed language as beta and settles a first run from the browser', () => {
  const dash = fs.readFileSync(path.join(FRONTEND, 'static', 'script', 'js', 'modules', 'js', 'dashboard.js'), 'utf8');
  assert.match(dash, /l\.reviewed === false/, 'the menu ignores the reviewed flag');
  assert.match(dash, />beta</, 'an unreviewed language is not marked');
  /* The first run is settled ONCE, in the core, so login and dashboard agree;
     the menu only waits for it. */
  const core = fs.readFileSync(CORE, 'utf8');
  assert.match(core, /PosnicPro\.i18n\.ready = /, 'the core publishes no ready promise');
  assert.match(core, /i18n\.detect\(list/, 'a first run does not consult the browser language');
  assert.match(core, /i18n\.chosen\(\)/, 'detection is not gated on "never chosen"');
  assert.match(dash, /i18n\.ready\.then/, 'the menu does not wait for the settled language');
  /* The old ready() wrote English back as if somebody had chosen it, which
     would have stopped detection from ever running. */
  assert.ok(!/select\('dashboard\.html'\)/.test(dash), 'the dashboard still writes English as a choice');
});

/* --------------------------------------- the document knows its language --- */

test('the runtime sets the document language and direction', () => {
  /*
   * <html lang> is what screen readers, spell-checkers, hyphenation and font
   * fallback read. dir="rtl" is the whole of Arabic's text layout. Both come
   * from the code, before any pack arrives, so direction never waits on a
   * fetch.
   */
  const markFn = member('mark');
  assert.match(markFn, /documentElement\.setAttribute\('lang'/, 'html lang is not set');
  assert.match(markFn, /'dir'/, 'html dir is not set');
  assert.match(i18nSource(), /_rtl:\s*\{[^}]*\bar:/, 'Arabic is not in the right-to-left set');
  assert.match(member('change'), /i18n\.mark\(\)/, 'switching language does not re-mark the document');
  assert.match(member('load'), /i18n\.mark\(\)/, 'direction waits on the pack fetch');
});

test('first-run detection is a BCP 47 lookup over what the build ships', () => {
  /* RFC 4647 lookup: the full tag first ('pt-BR'), then its primary subtag
     ('pt'), through the browser's preference list in order; English last. */
  const detectFn = member('detect');
  assert.match(detectFn, /nav\.languages/, 'detect() ignores the browser preference list');
  assert.match(detectFn, /split\('-'\)\[0\]/, 'detect() does not fall back to the primary subtag');
  assert.match(detectFn, /return 'en'/, 'detect() has no English fallback');
  /* And asking for the code must not count as choosing - that is what kept
     every fresh install silently pinned to English. */
  assert.ok(!/stored = m \? m\[1\] : 'en'/.test(member('code')), 'code() still writes English back as a choice');
});

test('switching back to English restores the words the page shipped with', () => {
  /*
   * English lives in the markup, not in any pack. Once a translation has
   * overwritten it, the only way back was a reload. apply() now keeps the
   * shipped markup on the element the first time it replaces it.
   */
  assert.match(member('apply'), /_english/, 'apply() does not keep the English before overwriting it');
  assert.match(member('restore'), /_english/, 'restore() does not read the kept English');
  assert.match(member('change'), /restore\(\)/, 'change() never restores English');
});

test('the RTL stylesheet rides the pages a shopkeeper sees, and loads last', () => {
  const map = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'pages_css_js_map.json'), 'utf8'));
  for (const page of ['dashboard', 'login', 'forgotpassword']) {
    const css = map[page].css;
    assert.equal(css[css.length - 1], 'static/style/css/rtl.css', page + ' does not load rtl.css last');
  }
  const rtl = fs.readFileSync(path.join(FRONTEND, 'static', 'style', 'css', 'rtl.css'), 'utf8');
  assert.match(rtl, /\[dir="rtl"\] \.leftbar/, 'the sidebar is not mirrored');
  assert.match(rtl, /\[dir="rtl"\] \.topbar/, 'the top bar is not mirrored');
  /* Every rule is scoped: an LTR page must pay nothing for this sheet. */
  const unscoped = rtl.split('\n').filter((l) => /^[.#a-z]/.test(l) && !/^\[dir/.test(l));
  assert.deepEqual(unscoped, [], 'rules not scoped under [dir="rtl"]: ' + unscoped.join(' | '));
});

test('no language pack slips below the point it reached', () => {
  /*
   * A ratchet, not a floor. tests/i18n-coverage-baseline.json records where
   * every pack stood the last time translations were merged; a pack may only
   * go up from there. A flat floor would sit red for as long as the UI is
   * being tagged faster than the packs are filled - and a red test everybody
   * has learned to ignore protects nothing.
   *
   * One point of slack covers key churn: a screen edit that renames a key
   * costs a pack a fraction of a percent before anybody has had a chance to
   * translate the new name.
   *
   *     node tests/tools/i18n-coverage.js --worksheet <code>   what is missing
   *     node tests/tools/i18n-coverage.js --write-baseline     after merging
   */
  const { report } = require(path.join(__dirname, 'tools', 'i18n-coverage.js'));
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-coverage-baseline.json'), 'utf8'));
  const rows = report().rows.filter((r) => !r.error && !r.lang.startsWith('_'));
  assert.ok(rows.length >= 17, 'expected the seventeen packs, found ' + rows.length);
  const slipped = rows.filter((r) => r.coverage < (baseline[r.lang] || 0) - 1)
    .map((r) => r.lang + ' at ' + r.coverage + '% (baseline ' + baseline[r.lang] + '%)');
  assert.deepEqual(slipped, [], 'packs below their baseline:\n  ' + slipped.join('\n  '));
  const unknown = rows.filter((r) => !(r.lang in baseline)).map((r) => r.lang);
  assert.deepEqual(unknown, [], 'packs with no baseline (run --write-baseline): ' + unknown.join(', '));
});


test('the English map the console edits against is not stale', () => {
  /*
   * languages/_english.json is what the staff console shows a translator
   * beside each box - the sentence they are translating. The packs do not
   * carry the English themselves (it lives in the markup, which is what makes
   * a missing key fall back correctly), so this file is the only copy an
   * editor outside this repo can read.
   *
   * Generated by `node tests/tools/i18n-coverage.js --write-english`. Pinned
   * here because a stale map shows the wrong English, and somebody would
   * translate it faithfully - a worse failure than showing none, since it
   * looks right on both sides.
   */
  const { report } = require(path.join(__dirname, 'tools', 'i18n-coverage.js'));
  const expected = {};
  for (const [key, c] of report().context) if (c.english) expected[key] = c.english;

  const file = path.join(__dirname, '..', 'languages', '_english.json');
  assert.ok(fs.existsSync(file), 'languages/_english.json is missing - run i18n-coverage.js --write-english');
  const actual = JSON.parse(fs.readFileSync(file, 'utf8'));

  const missing = Object.keys(expected).filter((k) => !(k in actual));
  const extra = Object.keys(actual).filter((k) => !(k in expected));
  const changed = Object.keys(expected).filter((k) => k in actual && actual[k] !== expected[k]);
  assert.deepEqual({ missing, extra, changed }, { missing: [], extra: [], changed: [] },
    'languages/_english.json is out of date - run: node tests/tools/i18n-coverage.js --write-english');
});

/* ------------------------------------------- what JavaScript draws, too --- */

test('the runtime watches for markup drawn after load', () => {
  const watchFn = member('watch');
  assert.match(watchFn, /MutationObserver/, 'watch() does not observe the document');
  assert.match(watchFn, /if \(!PosnicPro\.i18n\._dict\) return/, 'English still pays for the observer');
  const core = fs.readFileSync(CORE, 'utf8');
  assert.match(core, /^PosnicPro\.i18n\.watch\(\);/m, 'nothing starts the observer');
});

test('attributes people read are translated', () => {
  assert.match(i18nSource(), /_attrs: \['placeholder', 'title', 'aria-label'\]/, 'the attribute list is missing');
  assert.match(member('apply'), /data-t-' \+ attrs\[a\]/, 'apply() ignores data-t-<attr>');
  assert.match(member('restore'), /data-en-' \+ attrs\[a\]/, 'restore() ignores the kept attributes');
});

test('the coverage tool counts keys JavaScript renders as markup', () => {
  const tool = fs.readFileSync(path.join(__dirname, 'tools', 'i18n-coverage.js'), 'utf8');
  assert.match(tool, /JavaScript renders markup too/, 'JS <lang> tags are not counted');
  assert.match(tool, /data-t-\(placeholder\|title\|aria-label\)/, 'attribute keys are not counted');
});

test('the screens the owner checked carry keys, not bare English', () => {
  /*
   * develop.posnic.io, 2026-09-02: the dashboard greeting and totals, the
   * quick-action buttons, the sales list headers, the receipt panel and the
   * supplier list were English in every language. Each is pinned here by a
   * string that must now be reachable through a key.
   */
  const html = (f) => fs.readFileSync(path.join(FRONTEND, 'modules', f), 'utf8');
  const js = (f) => fs.readFileSync(path.join(MODULES, f), 'utf8');
  assert.match(html('dashboard.html'), /<lang class="[^"]+">Totals<\/lang>/, 'Totals is bare');
  assert.match(html('dashboard.html'), /<lang class="[^"]+">Gross profit<\/lang>/, 'Gross profit is bare');
  assert.match(html('dashboard.html'), /<lang class="[^"]+">Sales History<\/lang>/, 'Sales History button is bare');
  assert.match(js('dashboard.js'), /i18n\.t\('[^']+', 'Good Morning'\)/, 'the greeting is bare');
  assert.match(js('sales.js'), /<th><lang class="[^"]+">Bill #<\/lang><\/th>/, 'the sales list header is bare');
  assert.match(js('sales.js'), /<lang class="[^"]+">Subtotal<\/lang>/, 'the receipt panel is bare');
  assert.match(js('suppliers.js'), /<th><lang class="[^"]+">Name<\/lang><\/th>/, 'the supplier list header is bare');
  const core = fs.readFileSync(CORE, 'utf8');
  assert.match(core, /_sort_label"><lang class="[^"]+">Sort<\/lang>/, 'the Sort control is bare');
});

/* ------------------------------------------- nothing bare on the screen --- */

test('bare English in the templates stays rare', () => {
  /*
   * develop.posnic.io, 2026-09-02: the owner picked Tamil and found the
   * dashboard totals, the list headers, the receipt panel and the supplier
   * screen still in English. None of it was inside <lang>, so no pack could
   * reach it. Every template was swept; this holds the sweep. A new screen
   * that adds bare text fails here, and the fix is one command:
   *
   *     node tests/tools/i18n-tag.js --write
   */
  const { report } = require(path.join(__dirname, 'tools', 'i18n-gaps.js'));
  const data = report();
  const shown = data.rows.map((r) => r.file + ': ' + r.found.map((x) => x.text).slice(0, 3).join(' | '));
  assert.ok(data.total <= 2, 'bare English the packs cannot reach (' + data.total + '):\n  ' + shown.join('\n  '));
});

test('the sweep tools live in the repository', () => {
  for (const tool of ['i18n-tag.js', 'i18n-tag-js.js', 'i18n-gaps.js']) {
    const file = path.join(__dirname, 'tools', tool);
    assert.ok(fs.existsSync(file), tool + ' is missing');
    assert.ok(!/D:\/Claude|C:\\Users/.test(fs.readFileSync(file, 'utf8')), tool + ' carries a machine-specific path');
  }
});

test('no module asks for a translation while it is still loading', () => {
  /*
   * This one shipped, and it took the whole dashboard down.
   *
   * PosnicPro.js is a single object literal thousands of lines long. A t()
   * call written INSIDE that literal runs while the literal is still being
   * built, at which point the name PosnicPro is not bound yet - so
   * PosnicPro.i18n throws, the rest of the file never executes, and the app
   * boots with an empty core object. Nothing catches it: the page simply
   * stops working.
   *
   * It is wrong even where it does not throw. A t() evaluated at load resolves
   * before any pack has been fetched, freezing English into a config object
   * that switching language afterwards can never reach.
   *
   * So config data carries plain English and is translated where it is
   * rendered; t() belongs inside functions, which run when they are called.
   *
   * Detected by running each module against a stub that answers every global,
   * so nothing else can throw, and watching which t() calls fire. Guessing
   * from braces was tried first and quietly missed the fifty-six calls that
   * caused the outage.
   *
   *     node tests/tools/i18n-load-time.js            what fires, and where
   *     node tests/tools/i18n-load-time.js --write    move them back to English
   */
  const { total, sitesByFile } = require(path.join(__dirname, 'tools', 'i18n-load-time.js'));
  const detail = Object.entries(sitesByFile)
    .map(([file, sites]) => file + ': ' + sites.map((x) => 'line ' + x.line + ' "' + x.english + '"').join(', '));
  assert.equal(total, 0, 't() runs while these modules are still loading:\n  ' + detail.join('\n  '));
});

test('a brand is spelled, not translated', () => {
  /*
   * Six translators in a row reported the same fight, and each one lost it
   * differently: "Provider Way2sms", "TextLocal", "Msimbo wa Pharmacode",
   * "Stile Turbo C", "بوابة Razorpay". None of them was being careless. The
   * validator they worked against rejects a value identical to its English -
   * the right default, since that is what a skipped row looks like - and it
   * had no exemption for a proper noun, so the only way to pass was to change
   * the name. A payment tab that no longer names the payment provider.
   *
   * languages/_glossary.json carries the list, and this is the exemption:
   * where a key's whole English IS one of those names, every pack spells it
   * the same way. Descriptive names are deliberately absent from that list -
   * Soft Dark, Warm Night and Diamond are words, and a theme picker in Thai
   * should read in Thai.
   */
  const glossary = JSON.parse(fs.readFileSync(path.join(LANGUAGES_DIR, '_glossary.json'), 'utf8'));
  const english = JSON.parse(fs.readFileSync(path.join(LANGUAGES_DIR, '_english.json'), 'utf8'));
  assert.ok(Array.isArray(glossary.brands) && glossary.brands.length, 'the glossary lists no brands');
  const brands = new Set(glossary.brands.map((b) => b.toLowerCase()));
  const keys = Object.keys(english).filter((k) => brands.has(String(english[k]).trim().toLowerCase()));
  assert.ok(keys.length, 'no key carries a brand as its whole English');

  const wrong = [];
  for (const file of fs.readdirSync(LANGUAGES_DIR).filter((f) => /^[a-z]{2}\.json$/.test(f))) {
    const pack = JSON.parse(fs.readFileSync(path.join(LANGUAGES_DIR, file), 'utf8'));
    for (const key of keys) {
      const value = pack[key];
      if (typeof value !== 'string' || value.trim() === '') continue;   // untranslated is fine
      if (value !== english[key]) {
        wrong.push(file.slice(0, 2) + '.' + key + ' = ' + JSON.stringify(value)
          + ', should be ' + JSON.stringify(english[key]));
      }
    }
  }
  assert.deepEqual(wrong, [], 'a brand was rewritten:\n  ' + wrong.join('\n  '));
});
