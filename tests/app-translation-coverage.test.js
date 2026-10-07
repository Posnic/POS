const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('server-message coverage includes regional language packs', () => {
  const { languages } = require('./tools/i18n-server-text');
  const listed = languages();
  for (const code of ['zh-CN', 'zh-TW']) {
    assert.ok(listed.includes(code), `${code} is omitted from server coverage`);
  }
});

test('application and server translations retain source placeholders', () => {
  const config = fs.readFileSync(path.join(root, 'frontend/gulpfile.js/config.js'), 'utf8');
  const codes = [...config.matchAll(/\{ code: '([^']+)'/g)].map(match => match[1]);
  const tokens = text => (text.match(/\{(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\}/g) || []).sort();
  for (const directory of ['languages', 'languages/server']) {
    const source = JSON.parse(fs.readFileSync(path.join(root, directory, '_english.json'), 'utf8'));
    for (const code of codes.filter(code => !['en', 'ne'].includes(code))) {
      const pack = JSON.parse(fs.readFileSync(path.join(root, directory, `${code}.json`), 'utf8'));
      for (const key of Object.keys(pack).filter(key => source[key])) {
        assert.ok(typeof pack[key] === 'string' && pack[key].trim(), `${directory}/${code}: ${key}`);
        const english = directory === 'languages' ? source[key] : key;
        assert.deepEqual(tokens(pack[key]), tokens(english), `${directory}/${code}: ${key} placeholders`);
      }
    }
  }
});
