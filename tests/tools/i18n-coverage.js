#!/usr/bin/env node
'use strict';

/*
 * How complete is each language, really?
 *
 * Nobody could answer this. The build falls back to the English already inside
 * the <lang> tag when a key is missing, which is the right behaviour - it is
 * why a half-translated language is usable rather than broken - but it is also
 * invisible. Tamil has been 88% translated for months and reads as finished.
 *
 * That invisibility is fine for a customer and useless for deciding whether a
 * language is ready to ship. So this counts, out loud:
 *
 *   - which keys the UI actually uses      (unique <lang class="..."> in HTML)
 *   - which of those each language answers
 *   - which entries a language file carries that nothing uses
 *
 * The third number is the one that surprises people. ta.json carries 313 keys
 * no screen references - 35% of the file - so asking a translator for "the
 * whole file" asks for a third more work than the product has words.
 *
 * Run:  node tests/tools/i18n-coverage.js
 *       node tests/tools/i18n-coverage.js --json      (for CI)
 *       node tests/tools/i18n-coverage.js --missing ta
 *
 * Exits non-zero only with --min <pct>, so it can gate a release without
 * failing every ordinary run.
 *
 * See Intranet docs/MULTI_LANGUAGE_ARCHITECTURE.md for where this is going.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', 'frontend');
const LANG_DIR = path.join(ROOT, 'languages');

/* Output and build artefacts hold the SAME keys already substituted, so
   counting them would double every number and, for public/, would count
   translated text as if it were a source key. */
const SKIP = /^(node_modules|public|dist|build|\.git)$/;

function htmlFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.test(entry.name)) htmlFiles(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith('.html')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function jsFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.test(entry.name)) jsFiles(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith('.js')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/*
 * The key list the product actually needs.
 *
 * Two sources, and both matter. The HTML carries <lang class="key">, and the
 * JavaScript now carries PosnicPro.i18n.t('key', 'English') for the words it
 * writes after the page is built. Counting only the HTML would report every
 * key the JS uses as dead - and a cleanup acting on that would delete exactly
 * the translations the sale screen depends on.
 *
 * A key used on six screens is one string to translate, not six, so this is a
 * Set.
 */
function keysUsed() {
  const used = new Set();
  /* key -> { english, where } so a translator can be handed the sentence and
     the screen, not a list of identifiers. */
  const context = new Map();
  /* Markup indentation is not part of the sentence. A tag broken over three
     lines gives back "Your shop was set up with one\n      trade's sample",
     which is unreadable in a worksheet and would be translated with the
     whitespace baked in. */
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const remember = (key, english, file) => {
    used.add(key);
    if (!context.has(key)) {
      context.set(key, { english: tidy(english), where: new Set() });
    }
    const c = context.get(key);
    if (!c.english && english) c.english = tidy(english);
    c.where.add(path.basename(file));
  };

  let tags = 0;
  for (const file of htmlFiles(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<lang class="([^"]+)">([\s\S]*?)<\/lang>/g)) {
      remember(m[1], m[2], file);
      tags += 1;
    }
    /* Keys the build hoisted onto <title> and <option>. */
    for (const m of html.matchAll(/data-t="([^"]+)"[^>]*>([^<]*)</g)) {
      remember(m[1], m[2], file);
    }
  }
  let calls = 0;
  for (const file of jsFiles(path.join(ROOT, 'static', 'script'))) {
    const js = fs.readFileSync(file, 'utf8');
    for (const m of js.matchAll(/i18n\.t\(\s*'([^']+)'\s*,\s*'([^']*)'/g)) {
      remember(m[1], m[2], file);
      calls += 1;
    }
    /* A t() call with no English fallback still uses the key. */
    for (const m of js.matchAll(/i18n\.t\(\s*'([^']+)'\s*\)/g)) {
      remember(m[1], '', file);
      calls += 1;
    }
  }
  return { used, tags, calls, context };
}

function languages() {
  try {
    return fs.readdirSync(LANG_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

function report() {
  const { used, tags, calls, context } = keysUsed();
  const rows = [];
  for (const lang of languages()) {
    let dict = {};
    try {
      dict = JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${lang}.json`), 'utf8'));
    } catch (e) {
      rows.push({ lang, error: e.message });
      continue;
    }
    const have = new Set(Object.keys(dict));
    /* A key present but empty is not translated. Falling for that would report
       a language as finished because somebody generated the skeleton. */
    const answered = [...used].filter((k) => have.has(k) && String(dict[k]).trim() !== '');
    const missing = [...used].filter((k) => !answered.includes(k)).sort();
    const unused = [...have].filter((k) => !used.has(k)).sort();
    rows.push({
      lang,
      entries: have.size,
      needed: used.size,
      translated: answered.length,
      missing,
      unused,
      coverage: used.size ? Math.round((answered.length / used.size) * 100) : 0,
    });
  }
  return { needed: used.size, tags, calls, context, rows };
}

/* ------------------------------------------------------------------ cli --- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const data = report();

if (flag('--json')) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const only = value('--missing');
if (only) {
  const row = data.rows.find((r) => r.lang === only);
  if (!row) {
    console.error(`no language file for "${only}" in ${LANG_DIR}`);
    process.exit(1);
  }
  console.log(`${row.missing.length} key(s) the UI uses that ${only} does not answer:`);
  for (const k of row.missing) console.log('  ' + k);
  process.exit(0);
}

/*
 * A file to hand a translator.
 *
 * --missing prints identifiers, which is the wrong thing to give a person:
 * nobody can translate "lang_conversion_factor_title" without knowing it says
 * "Conversion factor" and sits on the item screen. This writes JSON with the
 * English and the screen beside every blank, so it can be filled in and handed
 * straight back - it is already the shape of a language file.
 */
const sheet = value('--worksheet');
if (sheet) {
  const row = data.rows.find((r) => r.lang === sheet);
  if (!row) {
    console.error(`no language file for "${sheet}" in ${LANG_DIR}`);
    process.exit(1);
  }
  const out = {};
  for (const key of row.missing) {
    const c = data.context.get(key) || { english: '', where: new Set() };
    out[key] = {
      english: c.english,
      screen: [...c.where].sort().slice(0, 3).join(', '),
      [sheet]: '',
    };
  }
  const file = value('--out') || `${sheet}-to-translate.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`  ${row.missing.length} string(s) written to ${file}`);
  console.log(`  Fill in the "${sheet}" field on each, then:`);
  console.log(`    node tests/tools/i18n-coverage.js --merge ${sheet} --out ${file}`);
  process.exit(0);
}

/*
 * Take a filled-in worksheet back.
 *
 * Merging by hand is where a language file gets a duplicate key or loses its
 * sort order. Blank entries are skipped rather than written, because an empty
 * string counts as untranslated everywhere else and writing one would report
 * the language as finished while showing the customer nothing.
 */
const merge = value('--merge');
if (merge) {
  const file = value('--out') || `${merge}-to-translate.json`;
  if (!fs.existsSync(file)) {
    console.error(`no worksheet at ${file}`);
    process.exit(1);
  }
  const sheetData = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = path.join(LANG_DIR, `${merge}.json`);
  const dict = JSON.parse(fs.readFileSync(target, 'utf8'));

  let taken = 0;
  let blank = 0;
  const suspect = [];
  for (const [key, entry] of Object.entries(sheetData)) {
    const value_ = entry && typeof entry === 'object' ? entry[merge] : entry;
    if (typeof value_ !== 'string' || value_.trim() === '') { blank += 1; continue; }
    /* The same check the build applies: Latin-1 wreckage where the language
       should be means the file was saved in the wrong encoding somewhere. */
    if (/[\u0080-\u00FF]{3,}/.test(value_)) { suspect.push(key); continue; }
    dict[key] = value_.trim();
    taken += 1;
  }
  if (suspect.length) {
    console.error(`  REFUSING: ${suspect.length} entr(ies) look like mojibake: ${suspect.slice(0, 5).join(', ')}`);
    console.error('  Save the worksheet as UTF-8 and try again.');
    process.exit(1);
  }
  const sorted = {};
  for (const k of Object.keys(dict).sort()) sorted[k] = dict[k];
  fs.writeFileSync(target, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  console.log(`  merged ${taken} translation(s) into ${path.relative(process.cwd(), target)}`
    + (blank ? `, ${blank} left blank` : ''));
  console.log('  run this tool with no arguments to see the new coverage.');
  process.exit(0);
}

console.log('');
console.log(`  The UI uses ${data.needed} distinct keys `
  + `(${data.tags} <lang> tags in HTML, ${data.calls} t() calls in JS).`);
console.log('  English is not listed: it lives in the markup, so it is always 100%.');
console.log('');
console.log('  language   entries   translated   coverage   unused');
console.log('  ' + '-'.repeat(56));
for (const r of data.rows) {
  if (r.error) {
    console.log('  ' + r.lang.padEnd(11) + 'could not be read: ' + r.error);
    continue;
  }
  console.log('  ' + r.lang.padEnd(11)
    + String(r.entries).padStart(7)
    + String(r.translated + '/' + r.needed).padStart(13)
    + String(r.coverage + '%').padStart(11)
    + String(r.unused.length).padStart(9));
}
console.log('');
for (const r of data.rows) {
  if (r.error) continue;
  if (r.missing.length) {
    console.log(`  ${r.lang}: ${r.missing.length} untranslated, e.g. ${r.missing.slice(0, 4).join(', ')}`);
  }
  if (r.unused.length) {
    console.log(`  ${r.lang}: ${r.unused.length} entries nothing uses - dead weight a new language should not inherit`);
  }
}
console.log('');
console.log('  --missing <lang> lists them all; --json for CI.');

const min = value('--min');
if (min) {
  const short = data.rows.filter((r) => !r.error && r.coverage < Number(min));
  if (short.length) {
    console.error(`\n  FAILED: ${short.map((r) => `${r.lang} at ${r.coverage}%`).join(', ')} below ${min}%`);
    process.exit(1);
  }
}
