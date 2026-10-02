'use strict';

// Run with Electron. Validate actual Chromium pixels across every strip,
// including the last partial strip, without opening a printer or database.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { rasterize } = require('../../src/escpos-unicode');
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    let checked = 0;
    for (let run = 0; run < 3; run++) for (const paper of ['58', '80']) {
      const width = paper === '58' ? 384 : 576;
      const sections = Array.from({ length: 12 }, (_, i) => {
        const height = i === 11 ? 73 : 256;
        return `<div style="position:relative;height:${height}px;color:white">Section ${i}<div style="position:absolute;top:0;left:${i * 16}px;width:8px;height:${height}px;background:black"></div></div>`;
      }).join('');
      const document = `<html><body style="margin:0"><main class="rd-document" data-receipt-design="${paper}" style="width:${width}px;background:white">${sections}</main></body></html>`;
      const strips = await rasterize({ document, paper, width, body: '', pictures: [] });
      assert.equal(strips.length, 12);
      strips.forEach((strip, i) => {
        assert.equal(strip.height, i === 11 ? 73 : 256);
        const expected = Buffer.alloc(width / 8 * strip.height);
        for (let y = 0; y < strip.height; y++) expected[y * width / 8 + i * 2] = 255;
        assert.deepEqual(Buffer.from(strip.data, 'base64'), expected, `Run ${run}, ${paper}mm, strip ${i}`);
        checked++;
      });
    }
    const result = `PASS: ${checked} strips checked pixel-for-pixel across 6 cold-window receipts.\n`;
    if (process.env.POSNIC_STRIP_PROOF_LOG) fs.writeFileSync(process.env.POSNIC_STRIP_PROOF_LOG, result);
    console.log(result);
    app.exit(0);
  } catch (error) {
    if (process.env.POSNIC_STRIP_PROOF_LOG) fs.writeFileSync(process.env.POSNIC_STRIP_PROOF_LOG, error.stack);
    console.error(error);
    app.exit(1);
  }
});
