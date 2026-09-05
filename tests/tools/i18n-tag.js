#!/usr/bin/env node
'use strict';
/*
 * Make a template translatable.
 *
 * Wraps every visible text node in <lang class="key">, and marks placeholder,
 * title and aria-label with data-t-<attr>="key", reusing an existing key
 * whenever the English already has one. Keys are minted from the English
 * itself (lang_<slug>), so the same words on two screens share one key and
 * one translation. Dry by default.
 *
 *   node tests/tools/i18n-tag.js            report what would change
 *   node tests/tools/i18n-tag.js --write    do it
 *   node tests/tools/i18n-tag.js --list     print every new key with its English
 *
 * Run it after adding a screen, then hand the new keys to translators with
 * i18n-coverage.js --worksheet <code>. The GSTR report tables, error pages
 * and the email template are left alone on purpose (see SKIP_FILE).
 */
const fs = require('fs');
const path = require('path');

const POS = path.resolve(__dirname, '..', '..');
const FE = POS + '/frontend';
const write = process.argv.includes('--write');
const list = process.argv.includes('--list');

/* Pages left alone, and why. */
const SKIP_FILE = [
  /^modules[\\/]report_gstr/,      // Indian statutory tables: column names are the form's own
  /^error-\d+\.html$/, /^error-email\.html$/,  // server error pages, template boilerplate
  /^customersMailPrint\.html$/,    // an email body the API fills
  /^index\.html$/,                 // a redirect stub for search engines: loads no script,
                                   // so a tag here would never be translated, and its
                                   // <title> is a published contract
];
const ATTRS = ['placeholder', 'title', 'aria-label'];
/* Pages a search engine reads directly. Their <title> is a published
   contract (tests/frontend-discovery-files.test.js pins it), so the words
   inside it stay as they are - the indexed title is worth more than a
   translated browser tab on the way in. */
const SEO_TITLE_PAGE = /^(index|login)\.html$/;

/* Existing keys: english -> key, from the same tool CI uses. */
/* Read by CALLING the coverage tool, not by spawning it: six hundred
   kilobytes of JSON through a pipe truncates, and on CI it did. */
const ctx = require('./i18n-coverage.js').keysUsed().context;   // a Map
const tidy = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const byEnglish = new Map();
for (const [key, c] of ctx) {
  const en = tidy(c.english);
  if (en && !byEnglish.has(en)) byEnglish.set(en, key);
}
const usedKeys = new Set(ctx.keys());

/* New keys: english -> key, minted once per distinct English. */
const minted = new Map();
function keyFor(english) {
  const en = tidy(english);
  if (byEnglish.has(en)) return { key: byEnglish.get(en), reused: true };
  if (minted.has(en)) return { key: minted.get(en), reused: false };
  let slug = en.toLowerCase()
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42).replace(/_+$/, '');
  if (!slug) slug = 'text';
  let key = 'lang_' + slug;
  let n = 2;
  while (usedKeys.has(key) || [...minted.values()].includes(key)) key = 'lang_' + slug + '_' + n++;
  minted.set(en, key);
  return { key, reused: false };
}

const SKIP_TEXT = /^[\s\d.,:;!?()\[\]{}%$₹#*+\-–—/|&'"«»…=<>_×]*$/;
const NO_TAG_INSIDE = /^(script|style|textarea|pre|code|lang|noscript|svg)$/i;
const isShortcut = (text) => {
  const parts = String(text).split('+').map((part) => part.trim());
  if (!parts.length || !/^(ctrl|alt|shift|cmd|esc|f\d+)$/i.test(parts[0])) return false;
  return parts.slice(1).every((part) => part.length > 0 && !/\s/.test(part));
};
/* Text that is a template hole, a code fragment, or a bare identifier. */
const NOT_WORDS = (t) => !/[A-Za-z]{2,}/.test(t) || /\{\{|__\w+__|\$\{|<%|\bfunction\b|\bvar\b|=>/.test(t)
  || /^\{\w+\}$/.test(t)                        // a merge token is data, not prose
  || /^[a-z_]+\.[a-z_]+/.test(t)
  || isShortcut(t)                                               // keyboard shortcuts
  || /^View \S+ per page$/.test(t)                              // generated aria-labels
  || /^[A-Z]{1,2}$/.test(t);                                     // a bare initial

function tagHtml(src, file) {
  let out = '';
  let i = 0;
  const n = src.length;
  const stack = []; // open element names
  let changedText = 0, changedAttr = 0, reusedCount = 0;
  const newKeys = [];

  const keepTitle = SEO_TITLE_PAGE.test(file);
  function inNoTag() {
    return stack.some((t) => NO_TAG_INSIDE.test(t) || (keepTitle && t === 'title'));
  }
  function textRun(t) {
    /* keep leading/trailing whitespace outside the tag */
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
    const core = m[2];
    const norm = tidy(core);
    if (!norm || SKIP_TEXT.test(norm) || NOT_WORDS(norm) || norm.length < 2) return t;
    const { key, reused } = keyFor(core);
    if (reused) reusedCount++; else if (!newKeys.includes(key)) newKeys.push(key);
    changedText++;
    return m[1] + '<lang class="' + key + '">' + core + '</lang>' + m[3];
  }
  function tagAttrs(tag) {
    /* tag is the full "<name ...>" string */
    const nameM = /^<\s*([a-zA-Z][\w-]*)/.exec(tag);
    if (!nameM) return tag;
    let res = tag;
    for (const attr of ATTRS) {
      const re = new RegExp('\\s' + attr + '="([^"]{2,})"');
      const am = re.exec(res);
      if (!am) continue;
      if (res.includes(' data-t-' + attr + '=')) continue;
      const val = am[1];
      const norm = tidy(val);
      if (SKIP_TEXT.test(norm) || NOT_WORDS(norm)) continue;
      const { key, reused } = keyFor(val);
      if (reused) reusedCount++; else if (!newKeys.includes(key)) newKeys.push(key);
      changedAttr++;
      res = res.slice(0, am.index + am[0].length) + ' data-t-' + attr + '="' + key + '"' + res.slice(am.index + am[0].length);
    }
    return res;
  }

  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end < 0 ? n : end + 3;
      out += src.slice(i, stop); i = stop; continue;
    }
    if (src[i] === '<') {
      /* find the end of the tag, honouring quotes */
      let j = i + 1, q = null;
      while (j < n) {
        const ch = src[j];
        if (q) { if (ch === q) q = null; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === '>') break;
        j++;
      }
      let tag = src.slice(i, j + 1);
      const closeM = /^<\/\s*([a-zA-Z][\w-]*)/.exec(tag);
      const openM = /^<\s*([a-zA-Z][\w-]*)/.exec(tag);
      if (closeM) {
        const name = closeM[1].toLowerCase();
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.splice(at);
      } else if (openM) {
        const name = openM[1].toLowerCase();
        const selfClosing = /\/\s*>$/.test(tag) || /^(br|hr|img|input|meta|link|source|col|area|base|embed|param|track|wbr)$/.test(name);
        if (!inNoTag() && !/^(lang)$/.test(name)) tag = tagAttrs(tag);
        if (!selfClosing) stack.push(name);
        if (/^(script|style|textarea|pre|code)$/.test(name)) {
          /* copy verbatim to the matching close tag */
          const closeRe = new RegExp('</\\s*' + name + '\\s*>', 'i');
          const rest = src.slice(j + 1);
          const cm = closeRe.exec(rest);
          const stop = cm ? j + 1 + cm.index + cm[0].length : n;
          out += tag + src.slice(j + 1, stop);
          const at = stack.lastIndexOf(name); if (at >= 0) stack.splice(at);
          i = stop; continue;
        }
      }
      out += tag; i = j + 1; continue;
    }
    /* text run */
    let k = src.indexOf('<', i);
    if (k < 0) k = n;
    const t = src.slice(i, k);
    out += inNoTag() ? t : textRun(t);
    i = k;
  }
  return { out, changedText, changedAttr, reusedCount, newKeys };
}

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/^(node_modules|public|static|gulpfile\.js)$/.test(e.name)) htmlFiles(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

let totalText = 0, totalAttr = 0, totalReused = 0;
const allNew = new Map();
for (const f of htmlFiles(FE)) {
  const rel = path.relative(FE, f);
  if (SKIP_FILE.some((re) => re.test(rel))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const r = tagHtml(src, rel);
  if (r.changedText + r.changedAttr === 0) continue;
  totalText += r.changedText; totalAttr += r.changedAttr; totalReused += r.reusedCount;
  for (const k of r.newKeys) allNew.set(k, rel);
  if (write) fs.writeFileSync(f, r.out, 'utf8');
  if (!list) console.log(rel.padEnd(42) + String(r.changedText).padStart(5) + String(r.changedAttr).padStart(6) + String(r.newKeys.length).padStart(6));
}
if (list) {
  for (const [en, key] of minted) console.log(key.padEnd(48) + JSON.stringify(en));
} else {
  console.log('\ntagged text nodes:', totalText, '| attributes:', totalAttr, '| reused existing keys:', totalReused, '| new keys:', minted.size);
  console.log(write ? 'written.' : 'dry run - nothing written. Use --write.');
}
