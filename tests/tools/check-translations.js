#!/usr/bin/env node
'use strict';

/*
 * Is every language file safe to ship?
 *
 * Written for a first-time contributor, so every failure says what is wrong,
 * where, and what to do about it. A check that prints a stack trace at somebody
 * offering their first pull request is a check that loses the contributor.
 *
 * Run:  node tests/tools/check-translations.js
 *
 * Exits non-zero if anything here would reach a shopkeeper's screen broken.
 */

const fs = require('fs');
const path = require('path');

const LANG_DIR = path.resolve(__dirname, '..', '..', 'languages');
const CONFIG = path.resolve(__dirname, '..', '..', 'frontend', 'gulpfile.js', 'config.js');

const problems = [];
const notes = [];
const fail = (file, what, fix) => problems.push({ file, what, fix });

/* ------------------------------------------------------------- the files --- */

let files = [];
try {
  files = fs.readdirSync(LANG_DIR)
    .filter((f) => f.endsWith('.json'))
    /* _glossary.json is the source the packs are seeded from, not a pack: its
       values are objects of languages, not strings. Underscore means "not a
       language file" so a future sibling needs no change here. */
    .filter((f) => !f.startsWith('_'));
} catch (e) {
  console.error(`Cannot read ${LANG_DIR}: ${e.message}`);
  process.exit(1);
}

if (!files.length) {
  console.error('No language files found. That cannot be right.');
  process.exit(1);
}

/*
 * Mojibake: UTF-8 bytes decoded as Latin-1 or cp1252 and saved back.
 *
 * The single most important check here, because it is the one a reviewer
 * cannot do. Nine Tamil strings shipped to the sale screen this way and were
 * live for months. cp1252 matters as well as Latin-1: bytes 0x80-0x9F become
 * punctuation like U+2021, so a Latin-1-only test misses half of it.
 */
const CP1252 = {
  0x20AC: 1, 0x201A: 1, 0x0192: 1, 0x201E: 1, 0x2026: 1, 0x2020: 1, 0x2021: 1,
  0x02C6: 1, 0x2030: 1, 0x0160: 1, 0x2039: 1, 0x0152: 1, 0x017D: 1, 0x2018: 1,
  0x2019: 1, 0x201C: 1, 0x201D: 1, 0x2022: 1, 0x2013: 1, 0x2014: 1, 0x02DC: 1,
  0x2122: 1, 0x0161: 1, 0x203A: 1, 0x0153: 1, 0x017E: 1, 0x0178: 1,
};
function looksLikeMojibake(text) {
  let run = 0;
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    const suspicious = (c >= 0x80 && c <= 0xFF) || CP1252[c];
    run = suspicious ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

for (const file of files) {
  const full = path.join(LANG_DIR, file);
  const code = file.replace(/\.json$/, '');
  const raw = fs.readFileSync(full, 'utf8');

  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code)) {
    fail(file, `"${code}" is not a language code`,
      'Name the file after the language: hi.json, ta.json, pt-BR.json.');
    continue;
  }

  /* A BOM makes JSON.parse throw with a message that helps nobody. */
  if (raw.charCodeAt(0) === 0xFEFF) {
    fail(file, 'starts with a byte-order mark',
      'Save as "UTF-8" rather than "UTF-8 with BOM".');
  }

  let dict;
  try {
    dict = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    fail(file, `is not valid JSON - ${e.message}`,
      'A missing comma or a trailing one. Most editors will point at the line.');
    continue;
  }

  if (Array.isArray(dict) || typeof dict !== 'object' || dict === null) {
    fail(file, 'is not a set of key/value pairs',
      'The file should look like { "lang_save_title": "..." }.');
    continue;
  }

  let empty = 0;
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== 'string') {
      fail(file, `${key} is a ${Array.isArray(value) ? 'list' : typeof value}, not text`,
        'Every translation is a plain string.');
      continue;
    }
    if (!value.trim()) { empty += 1; continue; }
    if (looksLikeMojibake(value)) {
      fail(file, `${key} looks like mojibake: ${value.slice(0, 30)}`,
        'The file was saved in the wrong encoding. Save it as UTF-8 and redo '
        + 'that entry. If your editor offers ANSI or Western, do not use it.');
    }
    if (/^\s|\s$/.test(value)) {
      notes.push(`${file}: ${key} has a leading or trailing space`);
    }
  }
  if (empty) notes.push(`${file}: ${empty} entr(ies) are blank and will show English`);
}

/* ------------------------------------------------- declared vs delivered --- */

try {
  const config = fs.readFileSync(CONFIG, 'utf8');
  const block = /const LANGUAGES = \[([\s\S]*?)\n\];/.exec(config);
  if (block) {
    const declared = [...block[1].matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
    const unreviewed = [...block[1].matchAll(/code:\s*'([^']+)'[^\n]*reviewed:\s*false/g)].map((m) => m[1]);
    if (unreviewed.length) {
      notes.push(`${unreviewed.length} language(s) ship marked beta until a speaker reviews `
        + `them: ${unreviewed.join(', ')}`);
    }
    for (const code of declared) {
      if (code === 'en') continue;
      if (!files.includes(`${code}.json`)) {
        fail('config.js', `declares "${code}" but there is no languages/${code}.json`,
          `Either add the file or remove the entry.`);
      }
    }
    for (const file of files) {
      const code = file.replace(/\.json$/, '');
      if (!declared.includes(code)) {
        /* Not a failure: the file is harmless. But the app will not offer it,
           which is almost certainly not what the contributor intended. */
        notes.push(`${file} exists but is not in LANGUAGES in config.js, `
          + 'so the app will not offer it in the language menu');
      }
    }
  }
} catch (e) {
  notes.push(`could not read config.js: ${e.message}`);
}

/* -------------------------------------------------------------- the word --- */

console.log(`Checked ${files.length} language file(s): ${files.join(', ')}`);

for (const n of notes) console.log(`  note: ${n}`);

if (!problems.length) {
  console.log('');
  console.log('All good.');
  process.exit(0);
}

console.log('');
console.log(`${problems.length} problem(s):`);
for (const p of problems) {
  console.log('');
  console.log(`  ${p.file}: ${p.what}`);
  console.log(`    -> ${p.fix}`);
}
console.log('');
console.log('See docs/TRANSLATING.md. Ask on the issue if any of this is unclear -');
console.log('an unclear error message is a bug in this check, not in your work.');
process.exit(1);
