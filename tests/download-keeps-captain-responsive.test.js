'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const http = require('node:http');

test('download chooser leaves local HTTP requests responsive until completion or cancellation', async t => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = source.indexOf("  mainWindow.webContents.session.on('will-download'");
  const end = source.indexOf('  // Chromium does not show', start);
  let download;
  const messages = [];
  vm.runInNewContext(source.slice(start, end), {
    mainWindow: { webContents: { session: { on: (_event, fn) => { download = fn; } } } },
    app: { getPath: () => 'C:/Downloads' }, path,
    dialog: { showSaveDialogSync() { assert.fail('Synchronous chooser blocks Captain'); } },
    console: { log: (...args) => messages.push(args), warn() {}, error() {} },
  });
  const server = http.createServer((_req, res) => res.end('ready'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  for (const state of ['completed', 'cancelled']) {
    const item = new EventEmitter(); let options;
    item.getFilename = () => 'Lunch-menu.pdf';
    item.setSaveDialogOptions = value => { options = value; };
    item.setSavePath = () => assert.fail('Must leave path selection to native download dialog');
    item.getSavePath = () => 'C:/Chosen/menu.pdf';
    download({}, item);
    assert.equal(options.title, 'Save file');
    assert.equal(options.filters[0].extensions[0], 'pdf');
    const reply = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}`, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    assert.equal(reply, 'ready');
    item.emit('done', {}, state);
  }
  assert.equal(messages.length, 1);
  assert.equal(messages[0][1], 'C:/Chosen/menu.pdf');
});
