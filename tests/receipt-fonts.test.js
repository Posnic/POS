'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fonts, covers, fontsFor } = require('../src/receipt-fonts');
const { needsRaster, layout } = require('../src/escpos-unicode');
const samples = require('./fixtures/receipt-languages.json');
const { LANGUAGES } = require('../frontend/gulpfile.js/config');
const root = path.join(__dirname, '..');

test('every offered language has a receipt regression sample', () => {
  assert.deepEqual(samples.map(sample => sample.code).sort(), LANGUAGES.map(language => language.code).sort());
});

for (const sample of samples) {
  test(`${sample.code}: receipt text survives and every character has a bundled glyph`, () => {
    const selected = fontsFor(sample.text);
    for (const character of sample.text) {
      assert.ok(selected.some(font => covers(font, character.codePointAt(0))), `${sample.code}: missing ${character}`);
    }
    assert.equal(needsRaster({ items: [{ name: sample.text }] }), /[^\x00-\x7f\u20ac]/u.test(sample.text));
    for (const paperWidth of ['58', '80']) {
      const plan = layout({ items: [{ name: sample.text, qty: 2, amount: 10 }], total: 10 }, { paperWidth });
      assert.ok(plan.body.includes(sample.text));
    }
  });
}

test('mixed scripts select their own bundled fonts regardless of UI language', () => {
  const selected = fontsFor('Café தமிழ் العربية ชานม हिन्दी');
  for (const family of ['NotoSans', 'NotoSansTamil', 'NotoSansArabic', 'NotoSansThai']) {
    assert.ok(selected.some(font => font.family === family), family);
  }
});

test('bundled fonts cover the letters, marks and numbers in every offered language pack', () => {
  for (const { code } of LANGUAGES) {
    const file = code === 'en' ? '_english' : code;
    const text = fs.readFileSync(path.join(root, 'languages', file + '.json'), 'utf8');
    for (const character of new Set(text)) {
      if (!/[\p{L}\p{M}\p{N}]/u.test(character)) continue;
      assert.ok(fonts.some(font => covers(font, character.codePointAt(0))), `${code}: missing glyph for ${character}`);
    }
  }
});

test('combining marks, RTL, non-Latin and supplementary characters select the graphics path', () => {
  for (const text of ['Cafe\u0301', 'עברית', '中文', '日本語', '한국어', 'Русский', 'Ελληνικά', '𐐷']) {
    assert.equal(needsRaster({ footer: text }), true, text);
    assert.ok(layout({ footer: text, total: 1 }).body.includes(text));
  }
});

test('every font and original licence is packaged and matches its coverage manifest', () => {
  const { build } = require('../package.json');
  for (const font of fonts) {
    for (const name of [font.file, font.license]) {
      assert.ok(build.files.includes('src/fonts/' + name), `${name} missing from installer`);
      assert.ok(fs.statSync(path.join(root, 'src/fonts', name)).size > 0);
    }
    const bytes = fs.readFileSync(path.join(root, 'src/fonts', font.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), font.sha256, font.file);
    assert.match(fs.readFileSync(path.join(root, 'src/fonts', font.license), 'utf8'), /SIL OPEN FONT LICENSE/);
    for (let i = 0; i < font.ranges.length; i++) {
      const [first, last] = font.ranges[i];
      assert.ok(first <= last && (!i || first > font.ranges[i - 1][1]));
    }
  }
});
