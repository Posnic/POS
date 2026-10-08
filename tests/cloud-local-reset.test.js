'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { verifyLocalDatabase, stopSync } = require('../src/cloud-local-reset');
const { assertSameShop } = require('../src/cloud-shop-identity');

test('conflicting shops expose a structured recoverable result', () => {
  assert.throws(() => assertSameShop({ identity: { tenantDb: 'new', branchIds: [] }, savedTenant: 'old', localBranchIds: [], userCount: 0 }), { code: 'LOCAL_SHOP_CONFLICT' });
});

test('reset only accepts the verified local database folder, never a remote database', async () => {
  let closed = 0;
  const dataPath = path.resolve('fixture-data');
  class Client {
    async connect() {}
    db(name) { assert.equal(name, 'admin'); return { command: async () => ({ parsed: { storage: { dbPath: dataPath } } }) }; }
    async close() { closed++; }
  }
  await verifyLocalDatabase({ uri: 'mongodb://127.0.0.1:47017', dataPath, MongoClient: Client });
  await assert.rejects(verifyLocalDatabase({ uri: 'mongodb://127.0.0.1:47017', dataPath: path.resolve('other-data'), MongoClient: Client }), /Another Posnic/);
  await assert.rejects(verifyLocalDatabase({ uri: 'mongodb://cloud.example', dataPath, MongoClient: Client }), /Only this computer/);
  assert.equal(closed, 2);
});

test('sync must actually exit before local deletion may proceed', async () => {
  const child = new EventEmitter(); child.exitCode = null;
  let finished = false;
  const result = stopSync({ child, stop() { setImmediate(() => child.emit('exit', 0)); } }).then(() => { finished = true; });
  assert.equal(finished, false);
  await result;
  assert.equal(finished, true);
});

function handler({ answer = 1, fail = false, conflict = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('cloud:reset-local-shop'");
  const end = source.indexOf('function confirmFullAccountRemoval()', start);
  const calls = []; let callback;
  const root = path.resolve(__dirname, '../src');
  const sandbox = {
    __dirname: root, path, cloudResetUri: conflict ? 'mongodb://127.0.0.1:47017' : null, cloudConnectionBusy: false,
    ipcMain: { handle(_name, fn) { callback = fn; } },
    require(name) { if (name === './cloud-local-reset') return { verifyLocalDatabase: async () => calls.push('verify'), stopSync: async () => calls.push('stop') }; if (name === 'mongodb') return {}; return require(name); },
    mongoDBManager: { dataPath: 'data' }, syncAgentManager: {}, CLOUD_CONFIG_FILE: 'cloud-config',
    fs: { existsSync: () => true, unlinkSync: file => calls.push('unlink:' + path.basename(file)) },
    BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showMessageBox: async () => ({ response: answer }) },
    removeFullAccountData: async uri => { assert.equal(uri, 'mongodb://127.0.0.1:47017'); calls.push('delete'); if (fail) throw Error('database unavailable'); },
    app: { getPath: () => 'profile', relaunch: () => calls.push('relaunch'), exit: () => calls.push('exit') },
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  return { calls, run: (page = 'install-wizard.html') => callback({ senderFrame: { url: pathToFileURL(path.join(root, page)).href }, sender: {} }) };
}

test('cancel keeps data; unrelated pages and absent conflict cannot reset', async () => {
  const cancel = handler({ answer: 0 }); assert.equal((await cancel.run()).cancelled, true); assert.deepEqual(cancel.calls, ['verify']);
  const unrelated = handler(); assert.equal((await unrelated.run('kitchen-screen.html')).ok, false); assert.deepEqual(unrelated.calls, []);
  const noConflict = handler({ conflict: false }); assert.equal((await noConflict.run()).ok, false); assert.deepEqual(noConflict.calls, []);
});

test('confirmed reset stops sync before deletion and removes stale identity only after success', async () => {
  const success = handler(); assert.equal((await success.run()).ok, true);
  assert.deepEqual(success.calls, ['verify', 'verify', 'stop', 'unlink:cloud-config', 'delete', 'unlink:cloud-shop-identity.json', 'unlink:.startup-ready', 'relaunch', 'exit']);
  const failure = handler({ fail: true }); assert.equal((await failure.run()).ok, false);
  assert.deepEqual(failure.calls, ['verify', 'verify', 'stop', 'unlink:cloud-config', 'delete']);
});

test('both cloud screens expose choices only for shop conflicts and recover after cancellation', async () => {
  const { JSDOM } = require('jsdom');
  for (const page of ['install-wizard.html', 'cloud-setup.html']) {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src', page), 'utf8'), { runScripts: 'outside-only' });
    try {
      let calls = 0;
      dom.window.electronAPI = { cloud: { resetLocalShop: async () => { calls++; return { ok: false, cancelled: true }; } } };
      dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/cloud-reset-ui.js'), 'utf8'));
      const panel = dom.window.document.getElementById('cloudConflict');
      assert.equal(panel.hidden, true);
      dom.window.showCloudConflict({ code: 'NETWORK_ERROR' }); assert.equal(panel.hidden, true);
      dom.window.showCloudConflict({ code: 'LOCAL_SHOP_CONFLICT' }); assert.equal(panel.hidden, false);
      const button = dom.window.document.getElementById('deleteLocalShop');
      const pending = button.onclick(); assert.equal(button.disabled, true);
      await pending; assert.equal(button.disabled, false); assert.equal(calls, 1);
      dom.window.document.getElementById('keepLocalShop').click(); assert.equal(panel.hidden, true);
    } finally { dom.window.close(); }
  }
});
