'use strict';
// Launch with Electron, output path as first argument. Never contacts a printer.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
if (!electron.app) {
  const output = path.resolve(process.argv[2] || require('node:os').tmpdir() + '/posnic-designed-proof.json');
  const env = { ...process.env, POSNIC_PROOF_JSDOM: require.resolve('jsdom'), POSNIC_PROOF_JQUERY: require.resolve('jquery') }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(electron, [__filename, output], { env, stdio: 'ignore', windowsHide: true });
  const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 60000);
  child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => {
    clearTimeout(timer);
    try {
      const result = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (code !== 0 || result.passed !== 8 || result.error) throw Error(result.error || 'Proof incomplete');
      console.log(JSON.stringify(result, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  });
  return;
}
const { app, BrowserWindow } = electron;
const assert = require('node:assert/strict');
const { rasterize, renderDesignedReceipt } = require('../../src/escpos-unicode');
const output = process.argv[2];
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const results = [];
  try {
    const { JSDOM } = require(process.env.POSNIC_PROOF_JSDOM || 'jsdom');
    const dom = new JSDOM('', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window;
    w.$ = w.jQuery = require(process.env.POSNIC_PROOF_JQUERY || 'jquery')(w);
    w.PosnicPro = { escapeHtml: value => w.$('<i>').text(value).html(), local: { get: () => 'Rs' }, i18n: { t: (_k, text) => text } };
    for (const file of ['api/src/helpers/receipt-design.js', 'frontend/static/script/js/core/receipt-designer.js']) {
      w.eval(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'));
    }
    for (const paper of ['58', '80']) {
      for (const count of [2, 100]) {
        const sale = { branch_name: 'Local shop', sales_id: 'PK-1', created_date: '01/10/2026 08:20 AM',
          items: Array.from({ length: count }, (_, i) => ({ item_name: 'Tea ' + i + ' — چائے', item_quantity: 1, item_price: 200, total_amount: 200 })),
          items_subtotal: count * 200, items_total: count * 200 };
        sale.receipt_designs = w.PosnicPro.receiptDesigner.defaults(sale);
        const html = w.PosnicPro.receiptDesigner.render(sale, paper, false);
        let rows = 0;
        const bytes = await renderDesignedReceipt(html, paper, async plan => {
          const strips = await rasterize(plan);
          rows = strips.reduce((n, s) => n + s.height, 0);
          assert.ok(strips.some(s => Buffer.from(s.data, 'base64').some(b => b)));
          assert.equal(strips[0].width, paper === '58' ? 384 : 576);
          assert.ok(strips.slice(-2).some(s => Buffer.from(s.data, 'base64').some(b => b)), 'receipt tail must contain ink');
          if (count === 2) {
            const pixels = Buffer.alloc(plan.width * rows * 4, 255);
            let offset = 0;
            for (const strip of strips) {
              const bits = Buffer.from(strip.data, 'base64');
              for (let y = 0; y < strip.height; y++) for (let x = 0; x < plan.width; x++) {
                if (bits[y * plan.width / 8 + (x >> 3)] & (0x80 >> (x & 7))) {
                  const at = ((offset + y) * plan.width + x) * 4;
                  pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
                }
              }
              offset += strip.height;
            }
            fs.writeFileSync(output + '.' + paper + '.png', electron.nativeImage.createFromBitmap(pixels, { width: plan.width, height: rows }).toPNG());
          }
          return strips;
        });
        assert.ok(bytes.length > 1000);
        assert.ok(rows > count * 20);
        assert.equal(BrowserWindow.getAllWindows().length, 0);
        results.push({ paper, items: count, rows, bytes: bytes.length });
      }
    }
    for (const paper of ['58', '80']) {
      const { buildBillPayload } = require('../../api/src/helpers/bill-payload');
      const bill = buildBillPayload({ sales_id: 'SB1D28-27-000123', date: '2026-10-01T07:27:00Z', sales_sub_total: 800, sales_total: 840, tax: 40,
        items: [{ item_name: 'Chicken Biryani', item_quantity: 1, item_price: 290, item_base_price: 290, total_amount: 304.5 },
          { item_name: 'South Indian Fish Curry', item_quantity: 1, item_price: 350, item_base_price: 350, total_amount: 367.5 },
          { item_name: 'Boiled Rice', item_quantity: 1, item_price: 100, item_base_price: 100, total_amount: 105 },
          { item_name: 'Chappathi', item_quantity: 2, item_price: 30, item_base_price: 30, total_amount: 63 }] },
        { branch_name: 'Azure Coastal Kitchen', currency: 'Rs', indian_gst: 'gst_on', bill_print_total_qty: true });
      const data = bill.receiptDocument;
      data.receipt_designs = w.PosnicPro.receiptDesigner.defaults(data);
      const expected = w.PosnicPro.receiptDesigner.render(data, paper, true);
      const actual = await require('../../src/bill-design').documentFor(data, paper, 'http://localhost:3000/api');
      assert.equal(actual, expected, 'Captain must use the exact desktop layout');
      assert.match(actual, /840.00/);
      assert.match(actual, /290.00/);
      assert.doesNotMatch(actual, /304.50/);
      const bytes = await require('../../src/bill-design').renderBill(data, paper);
      assert.ok(bytes.length > 1000);
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      results.push({ captainDesktopParity: paper, bytes: bytes.length });
    }
    dom.window.close();
    await assert.rejects(renderDesignedReceipt('<article class="rd-document" data-receipt-design="80"></article>', '80'), /blank/);
    await assert.rejects(renderDesignedReceipt('<article class="rd-document" data-receipt-design="80" style="color:white;background:white">Invisible receipt</article>', '80'), /blank/);
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    fs.writeFileSync(output, JSON.stringify({ passed: 8, results }, null, 2));
  } catch (error) { fs.writeFileSync(output, JSON.stringify({ error: error.stack, results }, null, 2)); process.exitCode = 1; }
  finally { app.quit(); }
});
