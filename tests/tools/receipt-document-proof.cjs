'use strict';
// Launch with node tests/tools/run-receipt-document-proof.cjs. Never submits to a printer.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { fitDocument, prepareDocument } = require('../../src/receipt-page-layout');
const { hardenPrintWindow } = require('../../src/print-window-guard');
app.on('window-all-closed', () => {});
const root = path.join(__dirname, '../..');
const output = process.argv[2] || path.join(app.getPath('temp'), 'posnic-receipt-document-proof.json');
// Electron can outlive the terminal pipe that launched it on Windows. Keep
// diagnostic output in a file; never forward production console calls to it.
const proofConsole = Object.fromEntries(['log', 'warn', 'error', 'info'].map(level =>
  [level, (...args) => fs.appendFileSync(output + '.log', level + ': ' + require('node:util').format(...args) + '\n')]));
const source = fs.readFileSync(path.join(root, 'src/hardware-manager.js'), 'utf8');
const at = source.indexOf('  async printHTML(');
const method = vm.runInNewContext('({' + source.slice(at, source.indexOf('\n  async getDefaultPrinter', at)) + '}).printHTML', {
  BrowserWindow, hardenPrintWindow, fitDocument, prepareDocument, setTimeout, console: proofConsole,
});
const waitAt = source.indexOf('  async _waitForPrintPage(');
const waitForPage = vm.runInNewContext('({' + source.slice(waitAt, source.indexOf('\n  _sendPrintJob', waitAt)) + '})._waitForPrintPage', { setTimeout });
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/wrong') { res.end('<p>Session expired</p>'); return; }
    res.writeHead(404); res.end();
  });
  const results = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const receipt = '<style>body{margin:0}.rd-document{width:72mm;color:black}</style>' +
      '<article class="rd-document" data-receipt-design="80"><h1>Test Shop</h1><p>Receipt SALE-42</p><p>Tea 100.00</p><p>Total Rs 100.00</p></article>';
    for (const scenario of ['empty404', 'wrongDocument', 'normal', 'blank']) {
      fs.writeFileSync(output, JSON.stringify({ running: scenario, results }));
      let sent = 0;
      const inline = scenario === 'normal' || scenario === 'blank';
      const html = scenario === 'blank' ? '<html><body></body></html>' : receipt;
      const ctx = {
        _resolvePrintRoute: () => ({ secure: !inline, url: inline ? 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
          : 'http://127.0.0.1:' + server.address().port + (scenario === 'wrongDocument' ? '/wrong' : '/missing') }),
        _resolvePrinterName: async () => 'Test Counter',
        _waitForPrintPage: async (contents) => {
          fs.writeFileSync(output, JSON.stringify({ running: scenario, phase: 'waiting', state: await contents.executeJavaScript('document.readyState'), results }));
          await waitForPage.call(null, contents);
          fs.writeFileSync(output, JSON.stringify({ running: scenario, phase: 'ready', results }));
        },
        _sendPrintJob: async (win, options) => {
          sent++;
          assert.equal(options.deviceName, 'Test Counter');
          const text = await win.webContents.executeJavaScript('document.body.innerText');
          assert.match(text, /SALE-42/); assert.match(text, /Total Rs 100/);
          const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
          assert.ok(pdf.length > 1000);
          return { success: true };
        },
        _printViaPdfFallback: async () => { throw Error('Unexpected printer retry'); },
      };
      const result = await method.call(ctx, html, { pageSize: '80mm', fitReceipt: true, strictPrinter: true });
      assert.equal(result.success, scenario !== 'blank', JSON.stringify(result));
      assert.equal(sent, scenario === 'blank' ? 0 : 1);
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      results.push({ scenario, sent, passed: true });
    }
    fs.writeFileSync(output, JSON.stringify({ passed: results.length, results }, null, 2));
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ results, error: error.stack }, null, 2));
    process.exitCode = 1;
  } finally { server.close(); app.quit(); }
});
