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
/* At the repository root, not under frontend/: a translator should find these
   by looking at the project, not by knowing which build step reads them. */
const LANG_DIR = path.resolve(__dirname, '..', '..', 'languages');

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
/* Block comments, blanked rather than removed, so every offset a later
   regex reports still points at the same place in the file. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

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
    /* Attributes people read: placeholder="English" data-t-placeholder="key"
       in the same tag, in either order. */
    for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
      for (const m of tag[0].matchAll(/data-t-(placeholder|title|aria-label)="([^"]+)"/g)) {
        const en = new RegExp('\\s' + m[1] + '="([^"]*)"').exec(tag[0]);
        remember(m[2], en ? en[1] : '', file);
      }
    }
  }
  let calls = 0;
  for (const file of jsFiles(path.join(ROOT, 'static', 'script'))) {
    /* Block comments only, and only for the markup patterns below: a doc
       comment that shows what a <lang> tag looks like is documentation, not
       a string the app renders. Line comments are left alone because a
       naive // strip eats https:// inside real string literals. */
    const js = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of js.matchAll(/i18n\.t\(\s*'([^']+)'\s*,\s*'([^']*)'/g)) {
      remember(m[1], m[2], file);
      calls += 1;
    }
    /* A t() call with no English fallback still uses the key. */
    for (const m of js.matchAll(/i18n\.t\(\s*'([^']+)'\s*\)/g)) {
      remember(m[1], '', file);
      calls += 1;
    }
    /* Some config data carries its key beside the English - `label: 'Today',
       t: 'lang_this_day'` - because resolving it where the object is built
       would run before any pack exists. The render site does the asking, so
       the key is used even though no t() call names it here. */
    for (const m of js.matchAll(/(?:label|title): '((?:[^'\\]|\\.)*)',\s*t: '([^']+)'/g)) {
      remember(m[2], m[1], file);
    }
    for (const m of js.matchAll(/title: '((?:[^'\\]|\\.)*)',\s*titleKey: '([^']+)'/g)) {
      remember(m[2], m[1], file);
    }
    /* JavaScript renders markup too - table headers, pills, receipt labels -
       and the observer translates it, so its keys are keys the UI uses. */
    /* A key is a word. Anything else between those quotes is JavaScript
       building the class from a variable; that site names its key in the
       config the render site reads, and an earlier pattern counted it. */
    for (const m of js.matchAll(/<lang class="([A-Za-z0-9_-]+)">([^<]*)<\/lang>/g)) {
      remember(m[1], m[2], file);
      tags += 1;
    }
    for (const m of js.matchAll(/data-t="([A-Za-z0-9_-]+)"[^>]*>([^<']*)</g)) {
      remember(m[1], m[2], file);
    }
    /* A tag a module builds is usually split across three concatenated
       literals, so there is no whole tag to match and no closing > to find.
       Anchor on the key and read the plain attribute from the text around
       it, which is where an author writes it. */
    for (const m of js.matchAll(/data-t-(placeholder|title|aria-label)="([A-Za-z0-9_-]+)"/g)) {
      const attr = new RegExp('\\s' + m[1] + '="([^"]*)"');
      const before = js.slice(Math.max(0, m.index - 400), m.index);
      const opened = before.lastIndexOf('<');
      let en = attr.exec(opened >= 0 ? before.slice(opened) : before);
      if (!en) en = attr.exec(js.slice(m.index, m.index + 400));
      remember(m[2], en ? en[1] : '', file);
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

function main() {
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const data = report();

if (flag('--json')) {
  /* A Map stringifies to {} and a Set to {}, so the context would arrive empty
     and every consumer would quietly see no English at all. */
  const plain = { ...data, context: {} };
  for (const [key, c] of data.context) {
    plain.context[key] = { english: c.english, where: [...c.where] };
  }
  console.log(JSON.stringify(plain, null, 2));
  process.exit(0);
}

/*
 * Write languages/_english.json - every key with the English the UI shows.
 *
 * The packs deliberately do not carry the English (it lives in the markup, and
 * that is what makes a missing key fall back correctly). But anything editing a
 * pack from outside this repo - the staff console's language editor - has no
 * way to show a translator WHAT they are translating without it.
 *
 * Generated rather than hand-kept, and pinned by tests/i18n.test.js so it
 * cannot drift: a stale map would show a translator the wrong English, which is
 * a worse failure than not showing any.
 */
/*
 * Record where every pack stands, so a test can refuse to let one slip.
 *
 * A flat floor ("every pack above 95%") is the wrong instrument while the
 * UI is still being tagged faster than the packs are filled: it goes red
 * for weeks and everybody learns to ignore it. A ratchet does not: each
 * pack must stay at or above the point it last reached, and the baseline
 * moves up when translations land. Run this after merging a pack.
 */
if (flag('--write-baseline')) {
  const base = {};
  for (const r of data.rows) if (!r.error && !r.lang.startsWith('_')) base[r.lang] = r.coverage;
  fs.writeFileSync(path.join(__dirname, '..', 'i18n-coverage-baseline.json'),
    JSON.stringify(base, null, 2) + '\n');
  console.log('tests/i18n-coverage-baseline.json: ' + Object.entries(base).map(([k, v]) => k + ' ' + v + '%').join(', '));
  process.exit(0);
}

if (flag('--write-english')) {
  const en = {};
  for (const [key, c] of data.context) if (c.english) en[key] = c.english;
  const sorted = {};
  for (const k of Object.keys(en).sort()) sorted[k] = en[k];
  fs.writeFileSync(path.join(LANG_DIR, '_english.json'), JSON.stringify(sorted, null, 2) + '\n');
  console.log(`languages/_english.json: ${Object.keys(sorted).length} keys`);
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
 * Inconsistencies a non-speaker can find.
 *
 * Nobody who does not speak the language can say whether a translation is
 * good. Two things are wrong regardless of the language, though, and both are
 * mechanical:
 *
 *   - the same English rendered two different ways, so the interface calls one
 *     thing by two names;
 *   - the same translation used for two different English meanings, which
 *     means at least one of them is the wrong word.
 *
 * The second is how "Edit" was found to be labelled "Edited". This narrows
 * hundreds of strings down to a short list worth a speaker's attention - the
 * searching is mechanical, the judgement is not.
 *
 * Long sentences are skipped: they legitimately differ between screens, and
 * including them would bury the labels that matter in noise.
 */
const review = value('--review');
if (review) {
  const row = data.rows.find((r) => r.lang === review);
  if (!row) { console.error(`no language file for "${review}"`); process.exit(1); }
  const dict = JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${review}.json`), 'utf8'));

  const byEnglish = new Map();
  const byTranslation = new Map();
  const add = (map, outer, inner, key) => {
    if (!map.has(outer)) map.set(outer, new Map());
    if (!map.get(outer).has(inner)) map.get(outer).set(inner, []);
    map.get(outer).get(inner).push(key);
  };

  for (const [key, c] of data.context) {
    const en = (c.english || '').trim();
    const ta = dict[key];
    if (!en || typeof ta !== 'string' || !ta.trim()) continue;
    if (en.split(/\s+/).length > 3) continue;
    add(byEnglish, en.toLowerCase(), ta, key);
    add(byTranslation, ta, en.toLowerCase(), key);
  }

  const show = (title, why, map) => {
    console.log('');
    console.log('  === ' + title + ' ===');
    console.log('  ' + why);
    console.log('');
    let found = 0;
    for (const [outer, inners] of [...map].sort()) {
      if (inners.size < 2) continue;
      found += 1;
      console.log('    ' + outer);
      for (const [inner, keys] of inners) {
        console.log('        ' + inner.padEnd(34) + keys.slice(0, 2).join(', '));
      }
    }
    if (!found) console.log('    none');
    return found;
  };

  const a = show('same English, two translations',
    'the interface calling one thing by two names', byEnglish);
  const b = show('same translation, two meanings',
    'at least one of them is the wrong word', byTranslation);
  console.log('');
  console.log(`  ${a + b} thing(s) worth a speaker's eye.`);
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
/*
 * Start a language that does not exist yet.
 *
 * --worksheet needs a language file to compare against, so the FIRST person to
 * offer Hindi had nothing to begin with - the tool could describe how
 * incomplete a language was but not how to start one. This writes a worksheet
 * for every string in the product.
 *
 * Separate from --worksheet on purpose. A typo would otherwise silently
 * generate a worksheet for a language nobody speaks, and the first sign of it
 * would be a pull request adding languages/hj.json.
 */
const starting = value('--new');
if (starting) {
  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(starting)) {
    console.error(`"${starting}" is not a language code. Use e.g. hi, ta, pt-BR.`);
    process.exit(1);
  }
  if (fs.existsSync(path.join(LANG_DIR, `${starting}.json`))) {
    console.error(`languages/${starting}.json already exists - use --worksheet ${starting}`);
    process.exit(1);
  }
  const out = {};
  for (const key of [...data.context.keys()].sort()) {
    const c = data.context.get(key);
    out[key] = {
      english: c.english,
      screen: [...c.where].sort().slice(0, 3).join(', '),
      [starting]: '',
    };
  }
  const file = value('--out') || `${starting}-to-translate.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`  ${Object.keys(out).length} string(s) written to ${file}`);
  console.log(`  Fill in the "${starting}" field on each - you do not have to do them all.`);
  console.log(`  Then:  node tests/tools/i18n-coverage.js --merge ${starting} --out ${file}`);
  console.log(`  and add "${starting}" to LANGUAGES in frontend/gulpfile.js/config.js.`);
  process.exit(0);
}

const sheet = value('--worksheet');
if (sheet) {
  const row = data.rows.find((r) => r.lang === sheet);
  if (!row) {
    console.error(`no languages/${sheet}.json yet.`);
    console.error(`To start that language:  node tests/tools/i18n-coverage.js --new ${sheet}`);
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
  /* A brand-new language has no file yet - --new wrote only the worksheet, so
     this is where the language actually starts existing. */
  const isNew = !fs.existsSync(target);
  const dict = isNew ? {} : JSON.parse(fs.readFileSync(target, 'utf8'));

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
  console.log(`  ${isNew ? 'created' : 'merged into'} ${path.relative(process.cwd(), target)}`
    + ` with ${taken} translation(s)` + (blank ? `, ${blank} left blank` : ''));
  if (isNew) {
    console.log('');
    console.log(`  One more step: add { code: '${merge}', name: '<the language, written in`
      + ` itself>', flag: '<icon>' }`);
    console.log('  to LANGUAGES in frontend/gulpfile.js/config.js, or the app will not offer it.');
  }
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
}

/* Required as a module by the frontend build (for index.json's coverage
   numbers) and by the tests; run as a script by people and CI. */
if (require.main === module) main();
module.exports = { keysUsed, report, languages };
