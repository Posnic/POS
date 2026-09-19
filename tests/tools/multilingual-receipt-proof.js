'use strict';

// Exercise Chromium's real shaping and the actual ESC/POS payload. No printer
// or database is opened. Run with Electron, optionally writing PNG previews.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const samples = require('../fixtures/receipt-languages.json');
const { layout, loadDocument, renderReceipt, rasterize } = require('../../src/escpos-unicode');
const { fontsFor, family } = require('../../src/receipt-fonts');
const { parse } = require('../../src/escpos-preview');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-language-proof-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});

function preview(bytes, file) {
  const strips = parse(bytes).rows.filter(row => row.kind === 'raster');
  assert.ok(strips.length > 1);
  const width = strips[0].wBytes * 8;
  const height = strips.reduce((total, row) => total + row.h, 0);
  const pixels = Buffer.alloc(width * height * 4, 255);
  let offset = 0;
  for (const row of strips) {
    assert.equal(row.wBytes * 8, width);
    const data = Buffer.from(row.data, 'base64');
    for (let y = 0; y < row.h; y++) for (let x = 0; x < width; x++) {
      if (data[y * row.wBytes + (x >> 3)] & (0x80 >> (x & 7))) {
        const at = ((offset + y) * width + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
    }
    offset += row.h;
  }
  if (file) fs.writeFileSync(file, nativeImage.createFromBitmap(pixels, { width, height }).toPNG());
  return { width, height, bytes: bytes.length };
}

app.whenReady().then(async () => {
  const destination = process.env.POSNIC_PRINT_TEST_DIR;
  if (destination) fs.mkdirSync(destination, { recursive: true });
  const sale = {
    storeName: 'POSNIC LANGUAGE TEST', title: '18 languages',
    items: samples.map(sample => ({ name: `${sample.code}: ${sample.text}`, qty: 1, amount: 10 })),
    total: samples.length * 10, footer: 'PRINT TEST - NOT A SALE',
  };
  for (const paperWidth of ['58', '80']) {
    const plan = layout(sale, { paperWidth });
    const win = new BrowserWindow({ show: false, useContentSize: true, width: plan.width, height: 600,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await loadDocument(win, plan);
      await win.webContents.executeJavaScript(`Promise.all(${JSON.stringify(fontsFor(plan.body).map(family))}.map(name => document.fonts.load('24px ' + name))).then(() => document.fonts.ready).then(() => true)`);
      win.webContents.debugger.attach('1.3');
      const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
      await cdp('DOM.enable');
      await cdp('CSS.enable');
      const { root } = await cdp('DOM.getDocument');
      const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'td.name div' });
      assert.equal(nodeIds.length, samples.length);
      for (let i = 0; i < nodeIds.length; i++) {
        const { fonts } = await cdp('CSS.getPlatformFontsForNode', { nodeId: nodeIds[i] });
        assert.ok(fonts.length > 0, samples[i].code + ': no glyphs rendered');
        assert.ok(fonts.every(font => font.isCustomFont), samples[i].code + ': relied on a system font');
      }
      const overflowing = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('td,th,.line,.pair>div')).filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)`);
      assert.deepEqual(overflowing, [], paperWidth + ': clipped text');
    } finally { win.destroy(); }
    const bytes = await renderReceipt(sale, { paperWidth });
    const stats = preview(bytes, destination && path.join(destination, `languages-${paperWidth}.png`));
    console.log(JSON.stringify({ paperWidth, languages: samples.length, ...stats, systemFontsUsed: false }));
  }
  // Each script's text must draw actual ink, not only survive in an HTML string.
  for (const sample of samples) {
    const plan = layout({ items: [], total: 0, footer: sample.text }, { paperWidth: '58' });
    plan.body = `<div class="line" dir="auto">${sample.text}</div>`;
    const strips = await rasterize(plan);
    const ink = strips.reduce((sum, strip) => sum + Buffer.from(strip.data, 'base64').filter(byte => byte !== 0).length, 0);
    assert.ok(ink > 20, sample.code + ': product text printed blank');
    console.log(sample.code + ': glyphs rendered');
  }
  console.log('All 18 languages passed; no print jobs sent.');
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
