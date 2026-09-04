#!/usr/bin/env node
'use strict';
/*
 * Which screens still read in English, and in which language.
 *
 * Coverage as one number per language answers "how much is done". It does not
 * answer the question an owner actually asks, which is "I picked Tamil and the
 * supplier page is still English - what is missing there?" The keys are
 * already attributed to the files that use them, so the same data grouped by
 * FILE says exactly that, screen by screen.
 *
 *   node tests/tools/i18n-screen.js ta            every screen with a gap
 *   node tests/tools/i18n-screen.js ta --all      every screen, gap or not
 *   node tests/tools/i18n-screen.js ta --list     the missing keys too
 *   node tests/tools/i18n-screen.js --worst       the worst screen per language
 *
 * A screen at 100% still depends on its words being right; this counts what a
 * pack can answer, not whether the answer is good.
 */
const fs = require('fs');
const path = require('path');

const POS = path.resolve(__dirname, '..', '..');
const LANGUAGES = path.join(POS, 'languages');

/* Read by CALLING the coverage tool, not by spawning it: six hundred
   kilobytes of JSON through a pipe truncates, and on CI it did. */
function context() {
  const map = require('./i18n-coverage.js').keysUsed().context;
  const out = {};
  for (const [key, c] of map) out[key] = { english: c.english, where: [...c.where] };
  return out;
}

function pack(code) {
  return JSON.parse(fs.readFileSync(path.join(LANGUAGES, code + '.json'), 'utf8'));
}

/* Every file that renders a key, with the keys that file needs. */
function screens(ctx) {
  const byFile = new Map();
  for (const [key, entry] of Object.entries(ctx)) {
    for (const file of entry.where || []) {
      if (!byFile.has(file)) byFile.set(file, new Set());
      byFile.get(file).add(key);
    }
  }
  return byFile;
}

function report(code, ctx) {
  const dict = pack(code);
  const answered = (k) => typeof dict[k] === 'string' && dict[k].trim() !== '';
  const rows = [];
  for (const [file, keys] of screens(ctx)) {
    const missing = [...keys].filter((k) => !answered(k));
    rows.push({
      file,
      keys: keys.size,
      missing: missing.length,
      percent: keys.size ? Math.round(((keys.size - missing.length) / keys.size) * 100) : 100,
      missingKeys: missing.sort(),
    });
  }
  rows.sort((a, b) => a.percent - b.percent || b.missing - a.missing || a.file.localeCompare(b.file));
  return rows;
}

function languages() {
  return fs.readdirSync(LANGUAGES).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2)).sort();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const code = args.find((a) => /^[a-z]{2}$/.test(a));
  const ctx = context();

  if (args.includes('--worst') || !code) {
    console.log('language  worst screen                                        gap');
    for (const c of languages()) {
      const rows = report(c, ctx).filter((r) => r.missing);
      const w = rows[0];
      console.log(c.padEnd(10) + (w ? w.file.padEnd(52) + String(w.missing).padStart(4) + ' of ' + w.keys
        : 'every screen answers'.padEnd(52)));
    }
    process.exit(0);
  }

  const rows = report(code, ctx);
  const shown = args.includes('--all') ? rows : rows.filter((r) => r.missing);
  console.log(code + ': ' + rows.filter((r) => !r.missing).length + ' of ' + rows.length + ' screens answer every key\n');
  console.log('screen                                              keys  gap    %');
  for (const r of shown) {
    console.log(r.file.padEnd(52) + String(r.keys).padStart(4) + String(r.missing).padStart(5) + String(r.percent).padStart(5));
    if (args.includes('--list')) for (const k of r.missingKeys) console.log('      ' + k + ' = ' + JSON.stringify((ctx[k] || {}).english));
  }
  if (!shown.length) console.log('  (none)');
}
module.exports = { report, screens, context, languages };
