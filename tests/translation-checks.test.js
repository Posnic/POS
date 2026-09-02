'use strict';

/*
 * The checks that stand between a first-time contributor and a broken shop
 * screen.
 *
 * Every one of these is tested by actually breaking a language file and
 * confirming the checker says so, because a validator nobody has seen fail is
 * indistinguishable from one that passes everything. The mojibake case is not
 * hypothetical: nine Tamil strings reached the sale screen that way and were
 * live for months.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'tools', 'check-translations.js');
const REPO = path.join(__dirname, '..');

/*
 * Run the checker against a throwaway copy of the repository layout, so a test
 * can write a deliberately broken language file without touching the real one.
 * Only the two paths the checker reads are recreated.
 */
function checkWith(files, configLanguages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-tr-'));
  fs.mkdirSync(path.join(dir, 'languages'));
  fs.mkdirSync(path.join(dir, 'frontend', 'gulpfile.js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'tools'), { recursive: true });

  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'languages', name),
      typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  }
  const langs = configLanguages || ['en', ...Object.keys(files).map((f) => f.replace(/\.json$/, ''))];
  fs.writeFileSync(path.join(dir, 'frontend', 'gulpfile.js', 'config.js'),
    'const LANGUAGES = [\n'
    + langs.map((c) => `    { code: '${c}', name: '${c}', flag: 'us' },`).join('\n')
    + '\n];\n', 'utf8');
  fs.copyFileSync(TOOL, path.join(dir, 'tests', 'tools', 'check-translations.js'));

  const r = spawnSync(process.execPath, [path.join(dir, 'tests', 'tools', 'check-translations.js')],
    { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* ------------------------------------------------------------ it passes --- */

test('a good language file passes', () => {
  const r = checkWith({ 'ta.json': { lang_save_title: 'சேமி' } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /All good/);
});

test('blank entries are a note, not a failure', () => {
  /* A half-translated language is the normal case and must stay mergeable -
     every blank falls back to English. */
  const r = checkWith({ 'ta.json': { lang_a: 'சேமி', lang_b: '', lang_c: '   ' } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /blank/);
});

/* ------------------------------------------------------------- it fails --- */

test('mojibake is caught', () => {
  /*
   * The check a human reviewer cannot do. This is the exact byte sequence that
   * was live on the sale screen: புதிய, read as Latin-1.
   */
  const moji = Buffer.from('புதிய', 'utf8').toString('latin1');
  const r = checkWith({ 'ta.json': { lang_new_title: moji } });
  assert.equal(r.code, 1, 'mojibake should fail the check');
  assert.match(r.out, /mojibake/i);
  assert.match(r.out, /UTF-8/, 'the fix should name the encoding');
});

test('cp1252 mojibake is caught too, not just Latin-1', () => {
  /*
   * Bytes 0x80-0x9F have no Latin-1 meaning, so Windows substitutes
   * punctuation - 0x87 becomes U+2021. A Latin-1-only check misses these, and
   * an earlier version of this detector did exactly that and passed a visibly
   * corrupt file.
   */
  const r = checkWith({ 'ta.json': { lang_save_title: 'à' + String.fromCharCode(0x00AE) + String.fromCharCode(0x2021) + 'à®®à®¿' } });
  assert.equal(r.code, 1, 'cp1252 mojibake should fail');
  assert.match(r.out, /mojibake/i);
});

test('broken JSON is caught, and says so kindly', () => {
  const r = checkWith({ 'ta.json': '{ "lang_a": "x",, }' });
  assert.equal(r.code, 1);
  assert.match(r.out, /not valid JSON/);
  assert.match(r.out, /comma/i, 'the message should suggest what to look for');
});

test('a byte-order mark is caught', () => {
  const r = checkWith({ 'ta.json': '﻿{ "lang_a": "x" }' });
  assert.equal(r.code, 1);
  assert.match(r.out, /byte-order mark/);
});

test('a value that is not text is caught', () => {
  const r = checkWith({ 'ta.json': { lang_a: 42 } });
  assert.equal(r.code, 1);
  assert.match(r.out, /not text/);
});

test('a file named after something that is not a language is caught', () => {
  const r = checkWith({ 'notalanguage.json': { lang_a: 'x' } });
  assert.equal(r.code, 1);
  assert.match(r.out, /not a language code/);
});

test('a language declared in config with no file is caught', () => {
  const r = checkWith({ 'ta.json': { lang_a: 'x' } }, ['en', 'ta', 'hi']);
  assert.equal(r.code, 1);
  assert.match(r.out, /declares "hi"/);
});

test('a file the app will not offer is a note, not a failure', () => {
  /* Harmless, but almost certainly not what the contributor intended - they
     are one line of config away from it actually appearing. */
  const r = checkWith({ 'ta.json': { lang_a: 'x' }, 'hi.json': { lang_a: 'y' } }, ['en', 'ta']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /will not offer it/);
});

/* --------------------------------------------------- it is worth reading --- */

test('every failure says what to do about it', () => {
  /*
   * An error message that only says what is wrong sends a newcomer to ask, or
   * to give up. This is a contribution surface before it is a test.
   */
  const r = checkWith({ 'ta.json': '{ bad json' });
  assert.equal(r.code, 1);
  assert.match(r.out, /->/, 'failures should carry a suggested fix');
  assert.match(r.out, /TRANSLATING\.md/, 'it should point at the guide');
  assert.match(r.out, /bug in this check/, 'and invite a report if it is unclear');
});
