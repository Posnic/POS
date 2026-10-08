'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { getExtensionUpdateHold } = require('../src/extension-update-policy');
const { AssetUpdater } = require('../src/asset-updater');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-extension-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extensions = path.join(root, 'extensions');
  return { root, extensions, install: () => fs.mkdirSync(path.join(extensions, 'posnic.example'), { recursive: true }) };
}

function service(root) {
  const updater = new EventEmitter();
  const calls = { download: 0, install: 0, check: 0 };
  updater.downloadUpdate = async () => { calls.download++; };
  updater.quitAndInstall = () => { calls.install++; };
  updater.checkForUpdates = async () => { calls.check++; };
  const file = path.resolve(__dirname, '../src/update-service.js');
  const localRequire = createRequire(file);
  const output = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: output,
    require(name) {
      if (name === 'electron') return {
        app: { isPackaged: true, getPath: () => root, getVersion: () => '1.9.0' },
        BrowserWindow: { getAllWindows: () => [] },
      };
      if (name === 'electron-updater') return { autoUpdater: updater };
      return localRequire(name);
    },
    process: { env: {} }, global: {}, console: { log() {}, warn() {}, error() {} },
    setTimeout, setInterval,
  }, { filename: file });
  return { value: new output.exports(), updater, calls };
}

test('missing or empty extension root allows normal updates; staged and queued installs hold them', (t) => {
  const f = fixture(t);
  assert.equal(getExtensionUpdateHold(f.extensions), null);
  fs.mkdirSync(f.extensions);
  assert.equal(getExtensionUpdateHold(f.extensions), null);
  fs.writeFileSync(path.join(f.extensions, '.activation-request.json'), '{}');
  assert.match(getExtensionUpdateHold(f.extensions), /compatible/);
  fs.unlinkSync(path.join(f.extensions, '.activation-request.json'));
  f.install();
  assert.match(getExtensionUpdateHold(f.extensions), /compatible/);
});

test('an unreadable extension-root shape fails closed', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.extensions, 'not a directory');
  assert.match(getExtensionUpdateHold(f.extensions), /compatible/);
});

test('extension installation holds automatic/manual download and every full-installer entry point', async (t) => {
  const f = fixture(t);
  const s = service(f.root);
  f.install();
  s.updater.emit('update-available', { version: '1.9.1' });
  assert.equal(s.calls.download, 0);
  assert.equal((await s.value.downloadUpdate()).success, false);
  s.updater.emit('update-downloaded', { version: '1.9.1' });
  assert.equal(s.value.shouldInstallOnQuit(), false);
  assert.equal((await s.value.prepareQuitInstall()).ok, false);
  assert.equal(s.value.finishQuitInstall().ok, false);
  assert.equal((await s.value.quitAndInstall()).success, false);
  assert.equal(s.calls.install, 0);
  assert.match(s.value.getStatus().extensionUpdateHold, /compatible/);
  assert.equal((await s.value.checkForUpdates()).success, true);
  assert.equal(s.calls.check, 1);
});

test('a package installed after download prevents the already downloaded update from installing', async (t) => {
  const f = fixture(t);
  const s = service(f.root);
  s.updater.emit('update-available', { version: '1.9.1' });
  assert.equal(s.calls.download, 1);
  s.updater.emit('update-downloaded', { version: '1.9.1' });
  assert.equal(s.value.shouldInstallOnQuit(), true);
  f.install();
  assert.equal(s.value.shouldInstallOnQuit(), false);
  assert.equal(s.value.finishQuitInstall().ok, false);
  assert.equal(s.calls.install, 0);
});

test('asset updates cannot activate over an extension installation', (t) => {
  const f = fixture(t);
  const u = new AssetUpdater({
    root: path.join(f.root, 'assets'),
    updateGuard: () => getExtensionUpdateHold(f.extensions),
  });
  fs.mkdirSync(path.join(u.versionsDir, '1.9.1'), { recursive: true });
  f.install();
  assert.equal(u.activate('1.9.1').reason, 'extension-compatibility-review-required');
  assert.equal(u.activeVersion(), null);
});

test('install rechecks compatibility after its asynchronous backup', async (t) => {
  const f = fixture(t);
  const s = service(f.root);
  s.value._beforeInstall = async () => { f.install(); return { skipped: true }; };
  const result = await s.value.quitAndInstall();
  assert.equal(result.success, false);
  assert.match(result.error, /compatible/);
  assert.equal(s.calls.install, 0);
});

test('the asset channel skips network and staging when an extension holds updates', async (t) => {
  const f = fixture(t);
  f.install();
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('unexpected network'); };
  try {
    const { checkAndApply } = require('../src/asset-channel');
    const result = await checkAndApply({
      assetUpdater: { publicKey: 'unused', updateGuard: () => getExtensionUpdateHold(f.extensions) },
      appVersion: '1.9.0',
    });
    assert.equal(result.reason, 'extension-compatibility-review-required');
    assert.equal(calls, 0);
  } finally {
    global.fetch = original;
  }
});
