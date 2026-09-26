'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const config = require('../frontend/gulpfile.js/config');
const english = require('../languages/_english.json');

test('the European and additional language packs exist with honest review metadata', () => {
  const required = 'bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv nb is sq bs mk sr uk ru tr zh-CN zh-TW ja ko vi bn ur fa he mr gu pa ms tl'.split(' ');
  for (const code of required) {
    const language = config.LANGUAGES.find(l => l.code === code);
    assert.ok(language, code);
    if (code === 'en') continue;
    const pack = require('../languages/' + code + '.json');
    assert.ok(Object.keys(pack).length > 50, code);
    if (language.stage === 'starter') assert.equal(language.reviewed, false, code);
  }
  assert.equal(new Set(config.LANGUAGES.map(l => l.code)).size, config.LANGUAGES.length);
});

test('Dutch has every current UI key without empty filler values', () => {
  const dutch = require('../languages/nl.json');
  for (const key of Object.keys(english)) assert.ok(dutch[key] && dutch[key].trim(), key);
});

test('the translator catalogue keeps escaped apostrophes and the complete sentence', () => {
  const { context } = require('./tools/i18n-coverage').keysUsed();
  assert.equal(context.get('lang_ai_live_voice_off').english,
    "Off: the microphone works turn by turn, with the phone's own voice");
});

test('the picker finds native names, English names and regional codes', async () => {
  const source = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/dashboard.js'), 'utf8');
  const start = source.indexOf('(function buildLanguageMenu() {');
  const end = source.indexOf('}());', start) + 5;
  const dom = new JSDOM('<div id="change_language"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => config.LANGUAGES });
  w.PosnicPro = { local: { set() {} }, i18n: { t: (k, text) => text, ready: Promise.resolve(), code: () => 'en' } };
  w.$ = () => ({ html() {} });
  w.posnicLanguageStyling = () => {};
  w.eval(source.slice(start, end));
  await new Promise(resolve => setImmediate(resolve));
  const input = w.document.querySelector('[data-language-search]');
  for (const [query, code] of [['Dutch', 'nl'], ['Nederlands', 'nl'], ['Cestina', 'cs'], ['zh-TW', 'zh-TW'], ['Urdu', 'ur']]) {
    input.value = query;
    input.dispatchEvent(new w.Event('input'));
    const rows = [...w.document.querySelectorAll('a[data-code]')].filter(row => row.style.display !== 'none');
    assert.ok(rows.some(row => row.dataset.code === code), query);
  }
  input.value = 'no-such-language';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(w.document.querySelector('[data-language-empty]').hidden, false);
  dom.window.close();
});


test('glossary seeding retains brand names and future metadata', t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-glossary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tests/tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'languages'));
  fs.copyFileSync(path.join(root, 'tests/tools/seed-from-glossary.js'), path.join(dir, 'tests/tools/seed-from-glossary.js'));
  fs.writeFileSync(path.join(dir, 'tests/tools/i18n-coverage.js'),
    'console.log(JSON.stringify({context:{lang_save:{english:"Save"}}}))');
  const glossary = { _readme: [], languages: ['nl'], doNotTranslate: ['SKU'], notes: {},
    brands: ['Posnic'], reviewPolicy: 'native speaker', terms: { Save: { nl: 'Opslaan' } } };
  fs.writeFileSync(path.join(dir, 'languages/_glossary.json'), JSON.stringify(glossary));
  const result = spawnSync(process.execPath, [path.join(dir, 'tests/tools/seed-from-glossary.js'), '--write'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'languages/_glossary.json'), 'utf8'));
  assert.deepEqual(after.brands, glossary.brands);
  assert.equal(after.reviewPolicy, glossary.reviewPolicy);
});
