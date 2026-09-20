const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function manager(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kot-pause-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('posnic-kot-pause-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => directory, getName: () => 'test' }, BrowserWindow: class {} };
    return original.apply(this, arguments);
  };
  let KOT;
  try { delete require.cache[require.resolve('../src/kot-manager')]; KOT = require('../src/kot-manager'); }
  finally { Module._load = original; }
  // The lifecycle needs only configuration and timers, not a live printer.
  const instance = Object.create(KOT.prototype);
  Object.assign(instance, { configPath: path.join(directory, 'config.json'), config: null, isPolling: false, _poll: () => {} });
  return instance;
}

test('pause persists across a new worker and explicit resume clears it', async t => {
  const worker = manager(t);
  await worker.startPolling({ branchId: 'branch', printerNames: ['Kitchen'] });
  assert.equal(worker.isPolling, true);
  await worker.pausePolling();
  assert.equal(worker.isPolling, false);
  assert.equal((await worker.loadConfig()).enabled, false);
  worker.config = null;
  const restored = await worker.loadConfig();
  assert.equal(restored.enabled, false);
  await worker.startPolling(restored);
  assert.equal((await worker.loadConfig()).enabled, true);
  worker.stopPolling();
  assert.equal((await worker.loadConfig()).enabled, true, 'ordinary shutdown must not turn automatic printing off');
});

test('failure to persist a pause reports failure without claiming it is saved', async t => {
  const worker = manager(t);
  await worker.startPolling({ branchId: 'branch', printerNames: ['Kitchen'] });
  worker.configPath = path.dirname(worker.configPath);
  await assert.rejects(worker.pausePolling());
  assert.equal(worker.isPolling, true);
  worker.stopPolling();
});
