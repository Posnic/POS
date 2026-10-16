const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('desktop settings have one in-app entry and no floating duplicate menu', () => {
  assert.doesNotMatch(read('frontend/dashboard.html'), /posnic-desktop-fab|Desktop tools quick-access/);
  const dom = new JSDOM(read('frontend/layouts/sidebar.html'));
  for (const name of ['hardware', 'app', 'updates', 'backups', 'cloudsync', 'systemstatus']) {
    const nodes = dom.window.document.querySelectorAll('[href="#/settings/' + name + '"]');
    assert.equal(nodes.length, 1, name);
    assert.equal(nodes[0].getAttribute('data-access'), 'write');
    assert.ok(nodes[0].closest('[data-desktop-only]'));
  }
  dom.window.close();
});
test('desktop recovery tools remain independent of the app renderer', () => {
  const main = read('src/main.js');
  assert.match(main, /recoveryMenu.label = 'Help && Recovery'/);
  assert.match(main, /recoveryMenu.submenu.unshift\(\.\.\.recoveryItems/);
  for (const handler of ['openHardwareManager', 'openBackupManager', 'openCloudManager', 'openUpdateManager', 'openLogFolder']) assert.match(main, new RegExp(handler + '\\('));
  assert.match(main, /accelerator: 'CmdOrCtrl\+R'/);
});
test('the application log viewer keeps its guarded bridge', () => {
  const { isTrustedFrame } = require('../src/ipc-guard');
  assert.equal(isTrustedFrame({ url: 'file:///C:/app/resources/app.asar/src/log-viewer.html' }), true);
  assert.equal(isTrustedFrame({ url: 'https://example.com/log-viewer.html' }), false);
});
