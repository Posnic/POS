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
  let tags = 0;
  for (const file of htmlFiles(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<lang class="([^"]+)">/g)) {
      used.add(m[1]);
      tags += 1;
    }
  }
  let calls = 0;
  for (const file of jsFiles(path.join(ROOT, 'static', 'script'))) {
    const js = fs.readFileSync(file, 'utf8');
    for (const m of js.matchAll(/i18n\.t\(\s*'([^']+)'/g)) {
      used.add(m[1]);
      calls += 1;
    }
  }
  return { used, tags, calls };
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
  const { used, tags, calls } = keysUsed();
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
  return { needed: used.size, tags, calls, rows };
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
