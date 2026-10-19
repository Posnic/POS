'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const library = require('../api/src/helpers/thirukkural-library');
const { select } = require('../api/src/helpers/receipt-quote');
const QR = require('../api/node_modules/qrcode');
const { PNG } = require('../api/node_modules/pngjs');

test('all 1330 bundled QR images encode only the exact numbered public URL', () => {
  const entries = library.entries();
  assert.equal(entries.length, 1330);
  for (const entry of entries) {
    const matrix = QR.create('https://www.posnic.com/tools/thirukural/' + entry.number, { errorCorrectionLevel: 'M' }).modules;
    const png = PNG.sync.read(Buffer.from(entry.qr.split(',')[1], 'base64'));
    assert.equal(png.width, (matrix.size + 8) * 4);
    for (let y = 0; y < matrix.size; y++) for (let x = 0; x < matrix.size; x++) {
      const index = ((y + 4) * 4 * png.width + (x + 4) * 4) * 4;
      assert.equal(png.data[index] === 0, !!matrix.get(y, x), `Kural ${entry.number}`);
    }
  }
});
test('QR defaults off and saved snapshots keep number, text and QR after policy changes', () => {
  const policy = { source: 'thirukkural', order: 'sequential' };
  assert.equal(select(policy, 'S222').qr, undefined);
  const saved = select({ ...policy, showQr: true }, 'S222');
  assert.equal(saved.url, 'https://www.posnic.com/tools/thirukural/222');
  assert.match(saved.qr, /^data:image\/png;base64,/);
  assert.deepEqual(select({ source: 'none' }, 'S999', saved), saved);
});
test('bad download leaves existing files untouched and offline bundled selection available', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kural-test-'));
  try {
    const target = path.join(directory, 'thirukural.v1.json');
    fs.writeFileSync(target, 'previous invalid cache');
    const response = await library.install({ directory, fetcher: async url => {
      assert.equal(url, library.URL); return new Response('{"entries":[]}');
    } });
    assert.equal(response.source, 'bundled');
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous invalid cache');
    assert.equal(library.entries().length, 1330);
    assert.deepEqual(fs.readdirSync(directory), ['thirukural.v1.json']);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('reviewed website JSON installs once and reloads from cache offline', { skip: !process.env.POSNIC_THIRUKKURAL_JSON }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kural-download-'));
  try {
    const bytes = fs.readFileSync(process.env.POSNIC_THIRUKKURAL_JSON);
    const result = await library.install({ directory, fetcher: async () => new Response(bytes) });
    assert.equal(result.source, 'downloaded');
    assert.equal(result.cached, false);
    assert.equal(library.entries()[221].number, 222);
    assert.ok(library.entries()[221].englishExplanation);
    const cached = await library.install({ directory, fetcher: async () => { throw Error('Must not use network'); } });
    assert.deepEqual(cached, { source: 'downloaded', cached: true });
  } finally { assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, { recursive: true }); }
});
