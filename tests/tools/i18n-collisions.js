#!/usr/bin/env node
'use strict';
/*
 * One key, one meaning.
 *
 * A <lang> tag says two things at once: which words to show in English, and
 * which key to look up in every other language. When two DIFFERENT English
 * labels are given the same key, English is still right on both screens and
 * every other language is wrong on one of them - silently, because the person
 * who can see it is not the person reviewing the diff.
 *
 * The branch form was the worst of it. City carried lang_supply_title, State
 * carried lang_customer_title, Country carried lang_address_title. In English
 * the form reads correctly. Pick any other language and City reads "Supplier
 * list", State reads "Customers", Country reads "Address".
 *
 *   node tests/tools/i18n-collisions.js           every key with two meanings
 *   node tests/tools/i18n-collisions.js --write   give the minority its own key
 *
 * The majority meaning keeps the key. Every other site is moved to a key that
 * already means what it says, if one exists - which costs no translation, the
 * words are in the packs already - and otherwise to a new key, which falls
 * back to English until somebody translates it. Markup inside a tag is not a
 * difference: <i class="icon"></i>Close and Close are the same label.
 */
const fs = require('fs');
const path = require('path');

const POS = path.resolve(__dirname, '..', '..');
const FE = path.join(POS, 'frontend');
const SKIP_DIR = /^(node_modules|public|vendor|plugins|lazy)$/;
const VENDOR = /\.min\.js$|[\\/](jquery|bootstrap|select2|moment|summernote|jspdf|html2canvas|sortable|dexie|hasher|crossroads|signals)[^\\/]*\.js$/i;
const TAG = /<lang class="([A-Za-z0-9_-]+)">([\s\S]*?)<\/lang>/g;
/* The same key can be given a second meaning in either of the other two
   forms, and one of them was: lang_new_title means Add in every pack and
   labelled two buttons that say New. */
const DATA_T = /<(title|option)([^>]*)data-t="([A-Za-z0-9_-]+)"([^>]*)>([^<]*)<\/\1>/g;
const CALL = /i18n\.t\(\s*'([A-Za-z0-9_-]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
const ATTR_TAG = /<[a-zA-Z][^<>]*>/g;
const ATTR_KEY = /data-t-(placeholder|title|aria-label)="([A-Za-z0-9_-]+)"/g;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) files(path.join(dir, e.name), out); }
    else if (/\.(html|js)$/.test(e.name) && !VENDOR.test(path.join(dir, e.name))) out.push(path.join(dir, e.name));
  }
  return out;
}

/* The label, as a reader sees it: no markup, no entity noise, no trailing
   colon or asterisk. Two sites that differ only in an icon are one label. */
const label = (s) => String(s)
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()
  .replace(/\s*([:*]+)$/, '$1')     // the colon is part of the label; the space before it is not
  .toLowerCase();

function index() {
  const sites = [];
  for (const file of files(FE)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(FE, file).replace(/\\/g, '/');
    for (const m of src.matchAll(DATA_T)) {
      const text = label(m[5]);
      if (text) sites.push({ file, rel, key: m[3], text, raw: m[0], form: 'data-t' });
    }
    for (const m of src.matchAll(CALL)) {
      const text = label(m[2]);
      if (text) sites.push({ file, rel, key: m[1], text, raw: m[0], form: 't()' });
    }
    for (const t of src.matchAll(ATTR_TAG)) {
      for (const m of t[0].matchAll(ATTR_KEY)) {
        const v = new RegExp('\\s' + m[1] + '="([^"]*)"').exec(t[0]);
        const text = v ? label(v[1]) : '';
        if (text) sites.push({ file, rel, key: m[2], text, raw: t[0], form: 'attr', attr: m[1] });
      }
    }
    for (const m of src.matchAll(TAG)) {
      const text = label(m[2]);
      if (!text) continue;
      sites.push({ file, rel: path.relative(FE, file).replace(/\\/g, '/'), key: m[1], text, raw: m[0] });
    }
  }
  return sites;
}

/* What each key means, and how sure we are: the label most of its sites use. */
function meanings(sites) {
  const byKey = new Map();
  for (const s of sites) {
    if (!byKey.has(s.key)) byKey.set(s.key, new Map());
    const g = byKey.get(s.key);
    g.set(s.text, (g.get(s.text) || 0) + 1);
  }
  return byKey;
}

function slugFor(text, taken) {
  let slug = text.replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42).replace(/_+$/, '');
  if (!slug) slug = 'text';
  let key = 'lang_' + slug;
  let n = 2;
  while (taken.has(key)) key = 'lang_' + slug + '_' + n++;
  return key;
}

function plan() {
  const sites = index();
  const byKey = meanings(sites);

  /* A key that says exactly one thing can be reused by anything that says the
     same thing - the words are already in every pack. */
  const englishFor = JSON.parse(fs.readFileSync(path.join(POS, 'languages', '_english.json'), 'utf8'));
  const unambiguous = new Map();
  for (const [key, g] of byKey) {
    if (g.size !== 1) continue;
    const only = [...g.keys()][0];
    /* and the packs must have been translated against that same label, or
       reusing the key would import a translation of something else */
    if (label(englishFor[key] === undefined ? '' : englishFor[key]) !== only) continue;
    if (!unambiguous.has(only)) unambiguous.set(only, key);
  }

  const taken = new Set(byKey.keys());
  const minted = new Map();
  const moves = [];
  /*
   * Which meaning keeps the key is not a vote. Every pack was translated
   * against languages/_english.json, so what that file records IS what the
   * translations say - lang_tax_title reads "Denomination Field" there, and
   * "Champ de coupures" in French, while labelling nineteen things called
   * Tax. The map wins wherever it names one of the labels in use.
   */
  const englishMap = JSON.parse(fs.readFileSync(path.join(POS, 'languages', '_english.json'), 'utf8'));
  for (const [key, g] of byKey) {
    if (g.size === 1) continue;
    const recorded = label(englishMap[key] === undefined ? '' : englishMap[key]);
    const majority = g.has(recorded) ? recorded
      : [...g].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    for (const site of sites) {
      if (site.key !== key || site.text === majority) continue;
      let to = unambiguous.get(site.text);
      if (!to) {
        if (!minted.has(site.text)) { const k = slugFor(site.text, taken); taken.add(k); minted.set(site.text, k); }
        to = minted.get(site.text);
      }
      moves.push({ ...site, from: key, to, majority, fresh: !unambiguous.has(site.text) });
    }
  }
  return { sites, byKey, moves, minted };
}

function write(moves) {
  const byFile = new Map();
  for (const m of moves) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file).push(m);
  }
  let done = 0;
  for (const [file, list] of byFile) {
    let src = fs.readFileSync(file, 'utf8');
    for (const m of list) {
      const to = m.form === 'attr'
        ? m.raw.replace('data-t-' + m.attr + '="' + m.from + '"', 'data-t-' + m.attr + '="' + m.to + '"')
        : m.form === 'data-t' ? m.raw.replace('data-t="' + m.from + '"', 'data-t="' + m.to + '"')
        : m.form === 't()' ? m.raw.replace("'" + m.from + "'", "'" + m.to + "'")
          : m.raw.replace('<lang class="' + m.from + '">', '<lang class="' + m.to + '">');
      const i = src.indexOf(m.raw);
      if (i < 0) { console.log('  ! vanished in ' + m.rel + ': ' + m.raw.slice(0, 60)); continue; }
      src = src.slice(0, i) + to + src.slice(i + m.raw.length);
      done++;
    }
    fs.writeFileSync(file, src, 'utf8');
  }
  return done;
}

if (require.main === module) {
  const { byKey, moves, minted } = plan();
  const clashes = [...byKey].filter(([, g]) => g.size > 1);
  if (process.argv.includes('--write')) {
    const done = write(moves);
    console.log(done + ' site(s) moved to a key that means what they say');
    console.log(minted.size + ' new key(s); run i18n-coverage.js --write-english');
    process.exit(0);
  }
  for (const [key, g] of clashes) {
    console.log(key + '  ->  ' + [...g].sort((a, b) => b[1] - a[1]).map(([t, n]) => JSON.stringify(t) + ' x' + n).join('   '));
  }
  console.log('\n' + clashes.length + ' key(s) carry more than one meaning, over '
    + moves.length + ' site(s) that read wrong in every language but English.');
  console.log(moves.filter((m) => !m.fresh).length + ' can move to a key that is already translated; '
    + minted.size + ' new key(s) needed. --write does it.');
}
module.exports = { index, meanings, plan, label };
