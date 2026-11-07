'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('conflicting cloud identities lead to shop management and cannot reset the local shop', async () => {
  const { JSDOM } = require('jsdom');
  for (const page of ['install-wizard.html', 'cloud-setup.html']) {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src', page), 'utf8'), { runScripts: 'outside-only' });
    try {
      let opened = 0;
      dom.window.electronAPI = { cloud: { manageShops() { opened++; } } };
      dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/cloud-reset-ui.js'), 'utf8'));
      const document = dom.window.document;
      dom.window.showCloudConflict({ code: 'LOCAL_SHOP_CONFLICT' });
      assert.equal(document.getElementById('cloudConflict').hidden, false);
      assert.equal(document.getElementById('deleteLocalShop'), null);
      document.getElementById('manageLocalShops').click();
      assert.equal(opened, 1);
      document.getElementById('keepLocalShop').click();
      assert.equal(document.getElementById('cloudConflict').hidden, true);
    } finally { dom.window.close(); }
  }
});
