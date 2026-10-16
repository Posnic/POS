'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

test('fresh setup waits for every writer and owned database before snapshot and reset', async () => {
  for (const running of [false, true]) {
    const calls = [];
    const context = {
      mongoDBManager: { usingExternal: false, dataPath: 'data', mongoProcess: { exitCode: running ? null : 0, signalCode: null }, stop: async () => calls.push('database') },
      backupManager: { stopScheduler: () => calls.push('backups') },
      syncAgentManager: {}, connectorSupervisor: { stopAll: async () => calls.push('connectors') },
      closeApiServer: async () => calls.push('api'), global: {},
      clearRendererStorage: async () => calls.push('sessions'), process: { env: { MONGODB_URI: 'local' } },
      app: { getPath: x => x, getName: () => 'Posnic' }, path,
      fs: { rmSync: () => calls.push('marker') }, console: { log() {} },
      require(name) {
        if (name === './cloud-local-reset') return { verifyLocalDatabase: async () => calls.push('verify'), stopSync: async () => calls.push('sync') };
        if (name === 'mongodb') return { MongoClient: {} };
        if (name === './setup-recovery') return { resetSavedData: () => { calls.push('snapshot-reset'); return 'copy'; } };
        throw Error(name);
      },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('async function saveAndResetLocalSetup('), source.indexOf("ipcMain.handle('install:fresh'")), context);
    if (running) {
      await assert.rejects(context.saveAndResetLocalSetup(true), /still closing/);
      assert.ok(!calls.includes('snapshot-reset'));
    } else {
      await context.saveAndResetLocalSetup(true);
      assert.deepEqual(calls, ['verify', 'backups', 'sync', 'connectors', 'api', 'database', 'sessions', 'snapshot-reset', 'marker']);
    }
  }
});

test('existing shop choice preserves hardware by default and submits the chosen fresh option', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src/install-wizard.html'), 'utf8'), { runScripts: 'outside-only' });
  try {
    let submitted;
    dom.window.electronAPI = { install: {
      state: async () => ({ existing: true, connected: true }),
      startFresh: async value => { submitted = value; return { ok: false, error: 'Recovery unavailable' }; },
    } };
    dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/simple-setup.js'), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    const doc = dom.window.document;
    assert.equal(doc.getElementById('stepExisting').style.display, 'block');
    assert.equal(doc.getElementById('step0').style.display, 'none');
    doc.getElementById('showFresh').click();
    assert.equal(doc.getElementById('freshKeepHardware').checked, true);
    await doc.getElementById('startFresh').onclick();
    assert.equal(submitted.keepHardware, true);
    assert.equal(doc.getElementById('freshStatus').textContent, 'Recovery unavailable');
    doc.getElementById('freshKeepHardware').checked = false;
    await doc.getElementById('startFresh').onclick();
    assert.equal(submitted.keepHardware, false);
  } finally { dom.window.close(); }
});
