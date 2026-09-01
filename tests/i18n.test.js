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

const moduleFiles = () => fs.readdirSync(MODULES).filter((f) => f.endsWith('.js'));
const read = (f) => fs.readFileSync(path.join(MODULES, f), 'utf8');

/*
 * PosnicPro.js is 200KB+, so a bare indexOf('is: function') lands somewhere
 * unrelated and every assertion built on it becomes meaningless. The i18n
 * object is cut out once, and its members are found inside that.
 */
function i18nSource() {
  const core = fs.readFileSync(CORE, 'utf8');
  const start = core.indexOf('PosnicPro.i18n = {');
  assert.ok(start > 0, 'PosnicPro.i18n is missing');
  const end = core.indexOf('\nPosnicPro.i18n.load();', start);
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

test('no module writes language_herf directly', () => {
  /* Writing the filename without the code leaves i18n.code() answering with
     the language the user just left. i18n.select() writes both. */
  const offenders = moduleFiles().filter((f) => /local\.set\(\s*'language_herf'/.test(read(f)));
  assert.deepEqual(offenders, [], 'these bypass i18n.select(): ' + offenders.join(', '));
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
  const dir = path.join(FRONTEND, 'languages');
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
  /* Parse the languages ARRAY, not every two-letter string in the file -
     require('fs') is not a language, and reading it as one made this test
     demand a languages/fs.json. */
  const arr = /const languages = \[([\s\S]*?)\]/.exec(config);
  assert.ok(arr, 'config.js has no languages array');
  const declared = [...arr[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]);
  assert.ok(declared.includes('en') && declared.includes('ta'), 'config lists en and ta');
  for (const lang of declared) {
    if (lang === 'en') continue;
    assert.ok(fs.existsSync(path.join(FRONTEND, 'languages', `${lang}.json`)),
      `no languages/${lang}.json for declared language ${lang}`);
  }
  const gulp = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js', 'index.js'), 'utf8');
  assert.match(gulp, /buildLangPacks/, 'the build has no language-pack task');
  assert.match(gulp, /parallel\([^)]*buildLangPacks/, 'buildLangPacks is not part of the build');
});

test('every language file is valid JSON with string values', () => {
  const dir = path.join(FRONTEND, 'languages');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    let dict;
    assert.doesNotThrow(() => { dict = JSON.parse(raw); }, `${f} is not valid JSON`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${f}:${k} is not a string`);
    }
  }
});
