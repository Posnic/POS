'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const readPack = require('./helpers/language-pack');
const root = path.join(__dirname, '..');
test('starter coverage resolves missing labels through English without replacing translations', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'posnic-language-fallback-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixtureRoot, 'languages'));
  fs.mkdirSync(path.join(fixtureRoot, 'frontend/gulpfile.js'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'frontend/gulpfile.js/config.js'),
    "exports.LANGUAGES = [{ code: 'bg', stage: 'starter' }];");
  const raw = { lang_save: 'Запазване' };
  const english = { lang_save: 'Save', lang_cancel: 'Cancel' };
  fs.writeFileSync(path.join(fixtureRoot, 'languages/bg.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(fixtureRoot, 'languages/_english.json'), JSON.stringify(english));
  const effective = readPack(fixtureRoot, 'bg.json');
  for (const [key, value] of Object.entries(raw)) assert.equal(effective[key], value);
  const missing = Object.keys(english).find(key => !Object.hasOwn(raw, key));
  assert.ok(missing);
  assert.equal(effective[missing], english[missing]);
});
test('established pack coverage remains strict, without implicit English fillers', () => {
  assert.deepEqual(readPack(root, 'ta.json'), JSON.parse(fs.readFileSync(path.join(root, 'languages/ta.json'), 'utf8')));
});
