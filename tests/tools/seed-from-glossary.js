#!/usr/bin/env node
'use strict';

/*
 * Fill the language packs from the shared glossary.
 *
 *   node tests/tools/seed-from-glossary.js            what would change
 *   node tests/tools/seed-from-glossary.js --write    do it
 *   node tests/tools/seed-from-glossary.js --write ta only that language
 *
 * A key gets a translation from languages/_glossary.json when its English text
 * matches a glossary term exactly. That is the whole rule, and it is deliberately
 * narrow: no stemming, no partial matches, no clever composition. "Sale Details"
 * does not get the word for "Sale" glued to the word for "Details", because word
 * order and grammar make that wrong in most of the languages here, and a plausible
 * wrong phrase is far more expensive than an English one - somebody has to notice
 * it before they can fix it.
 *
 * THE ONE RULE THAT MATTERS: an existing translation is never overwritten. A
 * person who has translated a key has looked at the screen it appears on, which
 * this file has not. Their work wins, always. That is also what makes the seeder
 * safe to run again after contributions land.
 *
 * Rerun this whenever the glossary changes. It is idempotent.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LANG_DIR = path.join(ROOT, 'languages');
const GLOSSARY = path.join(LANG_DIR, '_glossary.json');

const args = process.argv.slice(2);
const write = args.includes('--write');
const only = args.filter((a) => !a.startsWith('--'));

/* ------------------------------------------------------------ the glossary --- */

let glossary;
try {
  glossary = JSON.parse(fs.readFileSync(GLOSSARY, 'utf8'));
} catch (e) {
  console.error(`Cannot read languages/_glossary.json: ${e.message}`);
  process.exit(1);
}

/*
 * Serialised with one line per term, which is not cosmetic. The point of the
 * glossary is that a reviewer can see every language for a word at once; broken
 * across thirteen lines it stops being a table and a diff stops being readable.
 */
function serialiseGlossary(g) {
  const order = g.languages;
  const rows = Object.entries(g.terms).map(([term, byLang]) => {
    const pairs = order
      .filter((code) => byLang[code] && byLang[code].trim())
      .map((code) => `${JSON.stringify(code)}: ${JSON.stringify(byLang[code])}`);
    return `    ${JSON.stringify(term)}: {${pairs.join(', ')}}`;
  });
  const head = JSON.stringify(
    { _readme: g._readme, languages: g.languages, doNotTranslate: g.doNotTranslate, notes: g.notes },
    null, 2,
  );
  return `${head.slice(0, -2)},\n\n  "terms": {\n${rows.join(',\n')}\n  }\n}\n`;
}

/* --------------------------------------------------------- what the UI says --- */

/*
 * The English for every key, taken from the same tool the coverage report uses
 * rather than re-derived here. Two implementations of "what English does this key
 * show" would drift, and the one that drifted would be this one.
 */
let context;
try {
  const out = execFileSync(process.execPath,
    [path.join(__dirname, 'i18n-coverage.js'), '--json'], /* The key list outgrew the 1 MB default buffer once every screen was tagged. */
    { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  context = JSON.parse(out).context;
} catch (e) {
  console.error(`Could not read the key list: ${e.message}`);
  console.error('  -> node tests/tools/i18n-coverage.js --json  should print JSON.');
  process.exit(1);
}

const keysByEnglish = new Map();
for (const [key, entry] of Object.entries(context)) {
  const english = (entry.english || '').trim();
  if (!english) continue;
  if (!keysByEnglish.has(english)) keysByEnglish.set(english, []);
  keysByEnglish.get(english).push(key);
}

/* ------------------------------------------------------------------- seed --- */

const codes = (only.length ? only : glossary.languages)
  .filter((c) => c !== 'en');

let totalAdded = 0;
const unusedTerms = new Set(Object.keys(glossary.terms));

for (const code of codes) {
  const file = path.join(LANG_DIR, `${code}.json`);
  let pack = {};
  let existed = false;
  /*
   * Read first and let a missing file tell us it is missing, rather than
   * asking existsSync and then reading - between the two answers the file can
   * change, and the check-then-act is what CodeQL flags as a race.
   */
  {
    let raw = null;
    try {
      raw = fs.readFileSync(file, 'utf8');
      existed = true;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`Cannot read languages/${code}.json: ${e.message}`);
        process.exitCode = 1;
        continue;
      }
    }
    try {
      if (raw !== null) pack = JSON.parse(raw);
    } catch (e) {
      console.error(`languages/${code}.json is not valid JSON: ${e.message}`);
      process.exitCode = 1;
      continue;
    }
  }

  let added = 0;
  let kept = 0;
  for (const [term, byLang] of Object.entries(glossary.terms)) {
    const word = (byLang[code] || '').trim();
    if (!word) continue;
    const keys = keysByEnglish.get(term) || [];
    if (keys.length) unusedTerms.delete(term);
    for (const key of keys) {
      if ((pack[key] || '').trim()) { kept += 1; continue; }
      pack[key] = word;
      added += 1;
    }
  }

  totalAdded += added;
  const sorted = {};
  for (const key of Object.keys(pack).sort()) sorted[key] = pack[key];

  const done = Object.values(sorted).filter((v) => String(v).trim()).length;
  const label = existed ? '' : '  (new)';
  console.log(`${code}${label}  +${added} seeded, ${kept} already translated, `
    + `${done}/${Object.keys(context).length} keys now have words`);

  if (write) fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/* -------------------------------------------------------------- and back --- */

if (write) {
  fs.writeFileSync(GLOSSARY, serialiseGlossary(glossary), 'utf8');
}

console.log('');
if (unusedTerms.size) {
  /*
   * A term nobody uses is usually a typo in the glossary key - "Sales history"
   * where the screen says "Sales History" - and silently does nothing. Worth
   * saying out loud, because the symptom is a translation that never appears.
   */
  console.log(`${unusedTerms.size} glossary term(s) match no key in the app:`);
  for (const t of unusedTerms) console.log(`  ${t}`);
  console.log('  -> check the spelling and capitalisation against the English on screen.');
  console.log('');
}

if (!write) {
  console.log(`${totalAdded} translation(s) would be filled in. Nothing written.`);
  console.log('  -> run again with --write to apply.');
} else {
  console.log(`${totalAdded} translation(s) filled in.`);
  console.log('  -> node tests/tools/check-translations.js');
}
