'use strict';

// Run with Electron. This renders actual ESC/POS bytes; it never opens a
// database, contacts a printer or records a sale.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { renderReceipt, layout, rasterize } = require('../../src/escpos-unicode');
const { parse } = require('../../src/escpos-preview');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-arabic-test-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});

function preview(bytes, file) {
  const strips = parse(bytes).rows.filter(row => row.kind === 'raster');
  const width = strips[0].wBytes * 8;
  const height = strips.reduce((n, row) => n + row.h, 0);
  const pixels = Buffer.alloc(width * height * 4, 255);
  let offset = 0;
  for (const row of strips) {
    assert.equal(row.wBytes * 8, width);
    assert.ok(row.h <= 256);
    const bits = Buffer.from(row.data, 'base64');
    for (let y = 0; y < row.h; y++) for (let x = 0; x < width; x++) {
      if (bits[y * row.wBytes + (x >> 3)] & (0x80 >> (x & 7))) {
        const at = ((offset + y) * width + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
    }
    offset += row.h;
  }
  if (file) fs.writeFileSync(file, nativeImage.createFromBitmap(pixels, { width, height }).toPNG());
  return { width, height, ink: pixels.filter(byte => byte === 0).length };
}

app.whenReady().then(async () => {
  const destination = process.env.POSNIC_PRINT_TEST_DIR;
  if (destination) fs.mkdirSync(destination, { recursive: true });
  const sale = {
    storeName: 'متجر التجربة', title: 'إيصال تجريبي', billNo: 'TEST-001', date: '19/09/2026',
    items: [{ name: 'شاي بالنعناع', qty: '2', rate: '15.00', amount: 30 },
      { name: 'قهوة عربية Coffee 250g', qty: '1', rate: '25.00', amount: 25 },
      { name: 'عصير برتقال طازج بدون سكر - حجم كبير', qty: '1', rate: '20.00', amount: 20 }],
    total: 75, subTotal: 75, footer: 'شكراً لزيارتكم\nPRINT TEST - NOT A SALE',
  };
  for (const paperWidth of ['58', '80']) {
    const bytes = await renderReceipt(sale, { paperWidth });
    const stats = preview(bytes, destination && path.join(destination, `arabic-${paperWidth}.png`));
    assert.equal(stats.width, paperWidth === '58' ? 384 : 576);
    assert.ok(stats.ink > 1000);
    // The customer's regression: Arabic formerly produced identical bytes to
    // an empty name. Compare actual Chromium output, not just HTML strings.
    const empty = { ...sale, items: sale.items.map(item => ({ ...item, name: '' })) };
    assert.notDeepEqual(bytes, await renderReceipt(empty, { paperWidth }));
    const repeated = await renderReceipt(sale, { paperWidth });
    assert.deepEqual(bytes, repeated, 'Hidden-window rendering is not deterministic');
    console.log(JSON.stringify({ paperWidth, ...stats, bytes: bytes.length }));
  }
  // A receipt longer than a viewport must keep its final footer and images.
  const long = { ...sale, items: Array.from({ length: 45 }, (_, i) => ({ name: `شاي ${i + 1}`, qty: '1', amount: 1 })), total: 45, subTotal: 45 };
  const strips = await rasterize(layout(long, { paperWidth: '58' }));
  assert.ok(strips.length > 10);
  assert.ok(Buffer.from(strips.at(-1).data, 'base64').some(byte => byte !== 0), 'Final footer disappeared');
  // Keep prepared logos/QRs at exactly one printer dot per pixel, including
  // the outer edges; page padding must not crop full-width images.
  const edgeDots = Buffer.alloc(384 / 8 * 8, 0xff);
  const imagePlan = layout({ ...sale, logo: { width: 384, height: 8, data: edgeDots.toString('base64') } }, { paperWidth: '58' });
  const imageStrips = await rasterize(imagePlan);
  assert.ok(Buffer.from(imageStrips[0].data, 'base64').includes(edgeDots), 'Full-width logo was cropped');
  console.log('Arabic raster proof passed; no print jobs sent.');
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
