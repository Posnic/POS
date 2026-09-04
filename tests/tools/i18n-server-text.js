#!/usr/bin/env node
'use strict';
/*
 * The English the server writes.
 *
 * Every save, delete and refusal a shopkeeper sees is a toast, and the words
 * in it come from the API: `res.json({ type: 'success', message: 'Customer
 * added successfully' })`. The frontend prints that string as it arrives -
 * five hundred and seventy-six call sites do - so no <lang> tag and no key
 * can reach it. It is English in every language, on the messages a cashier
 * reads most often.
 *
 * The API cannot carry the keys itself: it is deployed separately, so a till
 * on a new build talking to an older server would get a key it has never seen
 * and print it raw. The English IS the identity instead - what gettext has
 * done for thirty years - so an untranslated or unrecognised message falls
 * back to exactly what it says today, and a server that is a version behind
 * costs nothing.
 *
 *   node tests/tools/i18n-server-text.js           what the API says, and how much is answered
 *   node tests/tools/i18n-server-text.js --write   refresh languages/server/_english.json
 *   node tests/tools/i18n-server-text.js --todo    what a translator should take next
 *
 * Translations live in languages/server/<code>.json, keyed by the English
 * itself. The build ships them as public/languages/msg-<code>.json.
 */
const fs = require('fs');
const path = require('path');

const POS = path.resolve(__dirname, '..', '..');
const API = path.join(POS, 'api');
const OUT = path.join(POS, 'languages', 'server');
const SKIP_DIR = /^(node_modules|\.git|json|coverage)$/;

/* message: '...' in any of the three quotings. A template literal with a
   ${...} in it is skipped: half of that string is a value, not words. */
const B = String.fromCharCode(92);
const NL = B + 'n';                 // a message never spans a line: a match that
                                        // does has run off the end of the literal
const FORMS = [
  new RegExp("message:" + B + "s*'((?:[^'" + NL + B + B + "]|" + B + B + ".)*)'", 'g'),
  new RegExp('message:' + B + 's*"((?:[^"' + NL + B + B + ']|' + B + B + '.)*)"', 'g'),
  new RegExp('message:' + B + 's*`([^`$' + NL + ']*)`', 'g'),
];

/* A message is words a person reads. An identifier, a path or a bare code is
   not, and neither is a fragment with nothing but punctuation in it. */
const isWords = (s) => /[A-Za-z]{3,}/.test(s)
  && s.trim().length > 3
  && !/^[a-z_]+([.-][a-z_]+)+$/.test(s.trim())
  && !/^https?:/.test(s.trim());

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) files(path.join(dir, e.name), out); }
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

function collect() {
  const found = new Map();
  if (!fs.existsSync(API)) return found;
  for (const file of files(API)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const form of FORMS) {
      for (const m of src.matchAll(form)) {
        if (!isWords(m[1])) continue;
        const rel = path.relative(API, file).replace(/\\/g, '/');
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(rel);
      }
    }
  }
  return found;
}

const languages = () => (fs.existsSync(OUT)
  ? fs.readdirSync(OUT).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2)).sort()
  : []);

const pack = (code) => {
  const file = path.join(OUT, code + '.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

function report() {
  const found = collect();
  const english = [...found.keys()].sort();
  const rows = languages().map((code) => {
    const dict = pack(code);
    const answered = english.filter((e) => typeof dict[e] === 'string' && dict[e].trim() !== '').length;
    return { code, answered, total: english.length, percent: english.length ? Math.round((answered / english.length) * 100) : 100 };
  });
  return { english, found, rows };
}

if (require.main === module) {
  const { english, found, rows } = report();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(OUT, { recursive: true });
    const map = {};
    for (const e of english) map[e] = [...found.get(e)].sort();
    fs.writeFileSync(path.join(OUT, '_english.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');
    console.log('languages/server/_english.json: ' + english.length + ' message(s)');
    process.exit(0);
  }
  if (process.argv.includes('--todo')) {
    const code = process.argv[process.argv.indexOf('--todo') + 1];
    const dict = pack(code || '');
    for (const e of english) if (!dict[e]) console.log(JSON.stringify(e));
    process.exit(0);
  }
  console.log('messages the API sends: ' + english.length);
  if (!rows.length) { console.log('no translations yet - languages/server/ is empty'); process.exit(0); }
  for (const r of rows) console.log('  ' + r.code + '  ' + String(r.percent).padStart(3) + '%  (' + r.answered + ' of ' + r.total + ')');
}
module.exports = { collect, report, languages, pack, isWords };
