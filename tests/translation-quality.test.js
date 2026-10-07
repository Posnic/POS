'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'languages');
const english = require('../languages/_english.json');
const glossary = require('../languages/_glossary.json');

test('protected abbreviations and brands remain recognizable in translated labels', () => {
  const protectedTerms = new Set([...glossary.doNotTranslate, ...glossary.brands]);
  const labels = Object.entries(english).filter(([, value]) => protectedTerms.has(value));
  for (const file of fs.readdirSync(dir).filter(file => /^[a-z]{2}(?:-[A-Za-z]{2,4})?\.json$/.test(file))) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [key, term] of labels) {
      if (pack[key]) assert.ok(pack[key].includes(term), `${file}:${key} must retain ${term}`);
    }
  }
});

test('translation context preserves source keys and runtime tokens', () => {
  const context = require('../languages/_translation-context.json');
  const tokens = value => (value.match(/<[^>]+>|\{(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\}/g) || []).sort();
  for (const [key, wording] of Object.entries(context)) {
    assert.ok(english[key], key);
    assert.ok(typeof wording === 'string' && wording.trim(), key);
    assert.deepEqual(tokens(wording), tokens(english[key]), key);
  }
});

test('Tamil operational labels retain their reviewed business meanings', () => {
  const ta = require('../languages/ta.json');
  assert.equal(ta.lang_noreturnds, ta.lang_totalsale_title, 'dashboard sales count must not say returns');
  assert.notEqual(ta.lang_filter_title, ta.lang_search, 'Apply and Search are different actions');
  assert.equal(ta.lang_demo_kind_quotes, ta.lang_quotes_title, 'demo quotations use the sales-quotation term');
  assert.equal(ta.lang_linecolor, ta.lang_line_color, 'barcode line color uses the existing drawing term');
  assert.equal(ta.lang_stockdate_title, ta.lang_stock_date, 'inventory date must not use the financial-share term');
  assert.equal(glossary.terms.Apply.ta, ta.lang_filter_title);
  assert.equal(glossary.terms.Cash.ta, ta.lang_cash);
});
