'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const readPack = require('./helpers/language-pack');
const root = path.join(__dirname, '..');
test('starter coverage resolves missing labels through English without replacing translations', () => {
  const raw = require('../languages/bg.json');
  const english = require('../languages/_english.json');
  const effective = readPack(root, 'bg.json');
  for (const [key, value] of Object.entries(raw)) assert.equal(effective[key], value);
  const missing = Object.keys(english).find(key => !Object.hasOwn(raw, key));
  assert.ok(missing);
  assert.equal(effective[missing], english[missing]);
});
test('established pack coverage remains strict, without implicit English fillers', () => {
  assert.deepEqual(readPack(root, 'ta.json'), JSON.parse(fs.readFileSync(path.join(root, 'languages/ta.json'), 'utf8')));
});
