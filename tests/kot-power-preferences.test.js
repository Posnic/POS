'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function load(name, electron, fileSystem = fs) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), {
    module, exports: module.exports, console,
    require: id => id === 'electron' ? electron : id === 'fs' ? fileSystem : require(id),
  });
  return module.exports;
}
test('KOT lifecycle holds one blocker, permits display lock, and releases on pause/quit', () => {
  const active = new Set(); const events = {}; let starts = 0;
  const power = load('till-stays-awake.js', {
    powerSaveBlocker: {
      start(type) { assert.equal(type, 'prevent-app-suspension'); active.add(++starts); return starts; },
      isStarted: id => active.has(id), stop: id => active.delete(id),
    },
    powerMonitor: { on: (name, fn) => { events[name] = fn; } },
  });
  power.start(false); assert.equal(active.size, 0);
  power.setKitchenPrinting(true); power.setKitchenPrinting(true);
  assert.equal(starts, 1); assert.equal(active.size, 1);
  events['lock-screen'](); assert.equal(active.size, 1);
  power.setKitchenPrinting(false); assert.equal(active.size, 0);
  power.start(true); assert.equal(active.size, 1);
  power.stop(); assert.equal(active.size, 0);
});
test('hardware choices survive module restart and failed replacement; kitchen assignments remain readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-prefs-'));
  try {
    const electron = { app: { getPath: () => dir } };
    const prefs = load('device-preferences.js', electron);
    const file = path.join(dir, 'preferences.json');
    prefs.saveJson(file, { receipt_printer: 'Reception_Printer', print_width: '80mm' });
    prefs.saveJson(path.join(dir, 'kot-config.json'), { printerNames: ['Kitchen_Printer'] });
    const restarted = load('device-preferences.js', electron);
    assert.equal(restarted.receiptPrinterName(), 'Reception_Printer');
    assert.equal(restarted.isKitchenPrinter('Kitchen_Printer'), true);
    assert.equal(restarted.isKitchenPrinter('Reception_Printer'), false);
    const broken = load('device-preferences.js', electron, {
      ...fs, renameSync() { throw new Error('Access denied'); },
    });
    assert.throws(() => broken.saveJson(file, { receipt_printer: 'Wrong' }), /Access denied/);
    assert.equal(restarted.receiptPrinterName(), 'Reception_Printer');
    assert.equal(fs.existsSync(file + '.tmp'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('kitchen screen saves atomically and preserves printers when replacement fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-settings-'));
  try {
    const electron = { app: { getPath: () => dir } };
    const prefs = load('device-preferences.js', electron);
    const file = path.join(dir, 'preferences.json');
    prefs.saveJson(file, { receipt_printer: 'Counter', print_width: '58mm' });
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/kitchen-screen.js'), 'utf8'), {
      module, exports: module.exports, console, __dirname: path.join(root, 'src'),
      require(name) {
        if (name === './device-preferences') return prefs;
        if (name === 'electron') return electron;
        if (name === './kitchen-screen-fit') return require('../src/kitchen-screen-fit');
        return require(name);
      },
    });
    const screens = module.exports;
    assert.equal(screens.configure('42', { enabled: false, fontSizePx: 31 }).ok, true);
    assert.equal(prefs.all().receipt_printer, 'Counter');
    const before = fs.readFileSync(file, 'utf8');
    prefs.saveJson = () => { throw new Error('Disk unavailable'); };
    assert.equal(screens.configure('42', { fontSizePx: 12 }).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(load('device-preferences.js', electron).all().kitchenScreens['42'].fontSizePx, 31);
    fs.writeFileSync(file, '{broken');
    assert.equal(screens.configure('42', { fontSizePx: 20 }).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
