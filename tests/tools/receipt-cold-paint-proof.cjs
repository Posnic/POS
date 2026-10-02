// Synthetic receipt only; never sends a print job.
const { app, BrowserWindow } = require('electron');
const { rasterize } = require('../../src/escpos-unicode');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output = process.argv[2];
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const results = [];
  try {
    for (const paper of ['80', '58']) {
      const width = paper === '80' ? 576 : 384;
      // Every strip has a different black width: a stale, missing or repeated
      // compositor frame fails at its exact row, including the final strip.
      const body = Array.from({ length: 12 }, (_, i) => `<div style="height:256px;background:linear-gradient(to right,black ${(i + 1) * 16}px,white ${(i + 1) * 16}px)"></div>`).join('');
      const document = `<html><body style="margin:0"><article class="rd-document" data-receipt-design="${paper}" style="width:${width}px"><span style="position:absolute;color:transparent">Synthetic receipt total</span>${body}</article></body></html>`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const strips = await rasterize({ document, paper, width });
        assert.equal(strips.length, 12);
        for (let index = 0; index < strips.length; index++) {
          const data = Buffer.from(strips[index].data, 'base64');
          for (const row of [10, 128, 240]) {
            for (let x = 0; x < width / 8; x++) assert.equal(data[row * width / 8 + x], x < (index + 1) * 2 ? 255 : 0, `paper=${paper},attempt=${attempt},strip=${index},row=${row},byte=${x}`);
          }
        }
        results.push({ paper, attempt, strips: strips.length });
      }
    }
    fs.writeFileSync(output, JSON.stringify({ passed: results.length, results }, null, 2));
  } catch (error) { fs.writeFileSync(output, JSON.stringify({ results, error: error.stack }, null, 2)); process.exitCode = 1; }
  finally { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.quit(); }
});
