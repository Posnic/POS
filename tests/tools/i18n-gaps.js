#!/usr/bin/env node
'use strict';
/*
 * The English the packs cannot reach.
 *
 * A word on the screen is translatable only if it sits inside <lang>, carries
 * data-t, or is an attribute marked data-t-<attr>. Everything else is English
 * in every language - and it is invisible until somebody who chose Thai walks
 * into a screen full of it. This lists it, per template, so the sweep can be
 * ordered and so a test can hold the number down.
 *
 *   node tests/tools/i18n-gaps.js            per-file counts
 *   node tests/tools/i18n-gaps.js --list     every string, per file
 *   node tests/tools/i18n-gaps.js --json     for the test
 *
 * Pages left alone on purpose: the GSTR report tables (statutory column names
 * matched against a government form), the server error pages, and the email
 * body the API fills.
 */
const fs = require('fs');
const path = require('path');

const FE = path.resolve(__dirname, '..', '..', 'frontend');
const SKIP_FILE = [/^modules[\\/]report_gstr/, /^error-\d+\.html$/, /^error-email\.html$/,
  /^customersMailPrint\.html$/,
  /^index\.html$/];                 // a redirect stub for search engines, as in i18n-tag.js
/* Their <title> is a published contract pinned by frontend-discovery-files. */
const SEO_TITLE_PAGE = /^(index|login)\.html$/;
const SKIP_TEXT = /^[\s\d.,:;!?()\[\]{}%$₹#*+\-–—/|&'"«»…=<>_×]*$/;
const NOT_WORDS = (t) => !/[A-Za-z]{2,}/.test(t)
  || /\{\{|__\w+__|\$\{|<%|\bfunction\b|\bvar\b|=>/.test(t)
  || /^[a-z_]+\.[a-z_]+/.test(t)
  || /^(ctrl|alt|shift|cmd|esc|f\d+)(\s*\+\s*\S+)*$/i.test(t)
  || /^View \S+ per page$/.test(t)
  || /^[A-Z]{1,2}$/.test(t);

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/^(node_modules|public|static|gulpfile\.js)$/.test(e.name)) htmlFiles(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

function scan(file, rel) {
  let html = fs.readFileSync(file, 'utf8')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '<textarea></textarea>')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<lang class="[^"]*">[\s\S]*?<\/lang>/g, '<lang></lang>')
    .replace(/<(title|option)([^>]*data-t="[^"]*"[^>]*)>[^<]*<\/\1>/g, '<$1$2></$1>');
  if (rel && SEO_TITLE_PAGE.test(rel)) html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title></title>');
  const found = [];
  let m;
  const text = />([^<]+)</g;
  while ((m = text.exec(html))) {
    const raw = m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;|&minus;/g, '-').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length < 2 || SKIP_TEXT.test(raw) || NOT_WORDS(raw)) continue;
    found.push({ kind: 'text', text: raw });
  }
  const attrs = /<[a-zA-Z][^>]*>/g;
  while ((m = attrs.exec(html))) {
    const tag = m[0];
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = new RegExp('\\s' + attr + '="([^"]{2,})"').exec(tag);
      if (!v || tag.includes(' data-t-' + attr + '=')) continue;
      const raw = v[1].trim();
      if (SKIP_TEXT.test(raw) || NOT_WORDS(raw)) continue;
      found.push({ kind: attr, text: raw });
    }
  }
  return found;
}

function report() {
  const rows = [];
  for (const f of htmlFiles(FE)) {
    const rel = path.relative(FE, f);
    if (SKIP_FILE.some((re) => re.test(rel))) continue;
    const found = scan(f, rel.replace(/\\/g, '/'));
    if (found.length) rows.push({ file: rel.replace(/\\/g, '/'), found });
  }
  rows.sort((a, b) => b.found.length - a.found.length);
  const total = rows.reduce((n, r) => n + r.found.length, 0);
  return { total, rows };
}

if (require.main === module) {
  const data = report();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(data, null, 1)); process.exit(0); }
  if (process.argv.includes('--list')) {
    for (const r of data.rows) { console.log('\n## ' + r.file); for (const x of r.found) console.log('  [' + x.kind + '] ' + x.text); }
  } else {
    console.log('file                                      bare');
    for (const r of data.rows) console.log(r.file.padEnd(42) + String(r.found.length).padStart(4));
  }
  console.log('\nbare English the packs cannot reach:', data.total);
}
module.exports = { report, scan };
