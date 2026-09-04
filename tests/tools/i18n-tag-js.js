#!/usr/bin/env node
'use strict';
/*
 * Reach the English that JavaScript writes.
 *
 *   <th>Bill #</th>                 -> <th><lang class="key">Bill #</lang></th>
 *   <option value="x">All</option>  -> <option value="x" data-t="key">All</option>
 *   title="Sort the list"           -> title="Sort the list" data-t-title="key"
 *   .text('Sort')                   -> .text(PosnicPro.i18n.t('key', 'Sort'))
 *   PosnicPro.alert('error', 'Msg') -> PosnicPro.alert('error', PosnicPro.i18n.t('key', 'Msg'))
 *   cond ? 'Paid' : 'Unpaid'        -> cond ? t('k1', 'Paid') : t('k2', 'Unpaid')
 *   label: 'Customer'               -> label: PosnicPro.i18n.t('key', 'Customer')
 *
 * Only pure literals are touched: anything concatenated, quoted or templated
 * inside the text is left alone, and a tag whose attributes are built by
 * concatenation is skipped (wrap those by hand). The markup forms are
 * translated by PosnicPro.i18n.watch() as they land; the t() forms need
 * nothing - but a t() evaluated when the module LOADS runs before any pack
 * has arrived, so a top-level object literal should carry <lang> markup
 * instead (see PosnicPro.dashboard.SETUP_CARDS). Ternaries that pick a VALUE
 * rather than a label are listed in DENY.
 *
 *   node tests/tools/i18n-tag-js.js            dry run, per-file counts
 *   node tests/tools/i18n-tag-js.js --write    edit in place
 *   node tests/tools/i18n-tag-js.js --list     every new key with its English
 *
 * After --write, run node --check on the touched files: markup inserted into
 * a double-quoted string needs its quotes swapped by hand.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const POS = path.resolve(__dirname, '..', '..');
const FE = POS + '/frontend';
const write = process.argv.includes('--write');
const list = process.argv.includes('--list');

const ctx = JSON.parse(execFileSync(process.execPath,
  [POS + '/tests/tools/i18n-coverage.js', '--json'], { encoding: 'utf8', cwd: POS, maxBuffer: 64 * 1024 * 1024 })).context;
const tidy = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const byEnglish = new Map();
for (const [key, c] of Object.entries(ctx)) {
  const en = tidy(c.english);
  if (en && !byEnglish.has(en)) byEnglish.set(en, key);
}
const usedKeys = new Set(Object.keys(ctx));
const minted = new Map();
function keyFor(english) {
  const en = tidy(english);
  if (byEnglish.has(en)) return byEnglish.get(en);
  if (minted.has(en)) return minted.get(en);
  let slug = en.toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42).replace(/_+$/, '');
  if (!slug) slug = 'text';
  let key = 'lang_' + slug; let n = 2;
  while (usedKeys.has(key) || [...minted.values()].includes(key)) key = 'lang_' + slug + '_' + n++;
  minted.set(en, key);
  return key;
}

/* Plain words: letters first, then letters/digits/spaces and light punctuation;
   never a quote, a plus, a brace or a template marker. */
const TXT = "[A-Z][A-Za-z0-9 #&;.,!?()/:%-]{1,90}";
const isWords = (t) => /[A-Za-z]{2,}/.test(t) && !/[{}'"+`]/.test(t);
/* Ternaries that pick a VALUE, not a label: a select's option value, an order
   type the API stores, an HTTP method, a date format, a CSV export cell. */
const DENY = new Set(['Received|Open', 'Take away|Dine-in', 'Active|Inactive', 'PUT|POST',
  'FullReturn|PartialReturn', 'MM/DD/YYYY|DD/MM/YYYY']);
const TAGS = 'th|td|label|h[1-6]|small|strong|b|em|span|button|a|p|li|legend|div';

function codemod(src) {
  let n = 0;
  const t = (en) => "PosnicPro.i18n.t('" + keyFor(en) + "', '" + en + "')";

  /* markup with plain text content */
  src = src.replace(new RegExp('<(' + TAGS + ')(\\s[^<>\']*)?>(' + TXT + ')</\\1>', 'g'), (m, tag, attrs, text) => {
    if (!isWords(text) || /<lang /.test(m)) return m;
    n++;
    return '<' + tag + (attrs || '') + '><lang class="' + keyFor(text) + '">' + text + '</lang></' + tag + '>';
  });
  /* <option> keeps its text: the parser drops elements inside it */
  src = src.replace(new RegExp('<option(\\s[^<>\']*)?>(' + TXT + ')</option>', 'g'), (m, attrs, text) => {
    if (!isWords(text) || /data-t=/.test(m)) return m;
    n++;
    return '<option' + (attrs || '') + ' data-t="' + keyFor(text) + '">' + text + '</option>';
  });
  /* attributes people read, inside markup strings */
  src = src.replace(/\s(placeholder|title|aria-label)="([^"'<>+]{2,90})"(?![^<>]*data-t-\1=)/g, (m, attr, text) => {
    if (!isWords(text) || !/^[A-Z]/.test(text)) return m;
    n++;
    return ' ' + attr + '="' + text + '" data-t-' + attr + '="' + keyFor(text) + '"';
  });
  /* .text('...') / .html('...') / .attr('title', '...') / .attr('placeholder', '...') */
  src = src.replace(new RegExp("\\.(text|html)\\('(" + TXT + ")'\\)", 'g'), (m, fn, text) => {
    if (!isWords(text)) return m; n++; return '.' + fn + '(' + t(text) + ')';
  });
  src = src.replace(new RegExp("\\.attr\\('(title|placeholder)',\\s*'(" + TXT + ")'\\)", 'g'), (m, attr, text) => {
    if (!isWords(text)) return m; n++; return ".attr('" + attr + "', " + t(text) + ')';
  });
  /* toasts */
  src = src.replace(new RegExp("PosnicPro\\.alert\\('(error|success|warning|info)',\\s*['\"](" + TXT + ")['\"]\\)", 'g'), (m, kind, text) => {
    if (!isWords(text)) return m; n++; return "PosnicPro.alert('" + kind + "', " + t(text) + ')';
  });
  /* object-literal labels: sort options (l), filter fields (label), page and
     modal titles, placeholders, onboarding hints. All consumed at mount time,
     through esc() or .text(), so t() is the right form, not markup. */
  src = src.replace(new RegExp("\\b(l|label|title|placeholder|searchPlaceholder|hint|message|dateField)(\\s*:\\s*)'(" + TXT + ")'", 'g'), (m, prop, sep, text) => {
    if (!isWords(text)) return m; n++; return prop + sep + t(text);
  });
  /* a ternary between two plain literals */
  src = src.replace(new RegExp("\\? '(" + TXT + ")' : '(" + TXT + ")'", 'g'), (m, a, b) => {
    if (!isWords(a) || !isWords(b) || DENY.has(a + '|' + b)) return m; n++; return '? ' + t(a) + ' : ' + t(b);
  });
  /* singular/plural count words: (x === 1 ? ' sale' : ' sales') */
  src = src.replace(/\(([\w.]+) === 1 \? ' ([a-z][a-z ]{1,30})' : ' ([a-z][a-z ]{1,30})'\)/g, (m, v, one, many) => {
    n++; return "' ' + (" + v + ' === 1 ? ' + t(one) + ' : ' + t(many) + ')';
  });
  return { src, n };
}

function jsFiles() {
  const out = [];
  for (const f of fs.readdirSync(FE + '/static/script/js/modules/js')) if (f.endsWith('.js')) out.push(FE + '/static/script/js/modules/js/' + f);
  for (const f of fs.readdirSync(FE + '/static/script/js/core')) if (f.endsWith('.js')) out.push(FE + '/static/script/js/core/' + f);
  return out;
}

let total = 0;
for (const f of jsFiles()) {
  const src = fs.readFileSync(f, 'utf8');
  const r = codemod(src);
  if (!r.n) continue;
  total += r.n;
  if (write) fs.writeFileSync(f, r.src, 'utf8');
  if (!list) console.log(path.relative(FE, f).padEnd(52) + String(r.n).padStart(5));
}
if (list) for (const [en, key] of minted) console.log(key.padEnd(48) + JSON.stringify(en));
else console.log('\nsites changed:', total, '| new keys:', minted.size, write ? '| written.' : '| dry run.');
