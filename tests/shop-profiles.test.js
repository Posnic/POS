'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ShopProfiles } = require('../src/shop-profiles');

test('three shops keep separate saved state across switches and application restarts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-shops-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profiles = new ShopProfiles(root);
  const sample = 'pending-sale.json';
  fs.writeFileSync(path.join(root, sample), 'Community sale');
  const obc = profiles.add();
  const third = profiles.add();
  for (const id of [obc, third]) {
    const dir = profiles.directory(id);
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(fs.existsSync(path.join(dir, sample)), false);
    fs.writeFileSync(path.join(dir, sample), id);
  }
  for (const id of [third, obc, 'original', obc, 'original']) {
    profiles.activate(id);
    const reopened = new ShopProfiles(root);
    assert.equal(reopened.state.active, id);
    assert.equal(fs.readFileSync(path.join(reopened.directory(id), sample), 'utf8'), id === 'original' ? 'Community sale' : id);
  }
  assert.throws(() => profiles.activate('../other'));
  assert.equal(new ShopProfiles(root).state.active, 'original');
});

test('community first visit and switching screens expose only applicable actions', async () => {
  const { JSDOM } = require('jsdom');
  const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  for (const connected of [false, true]) {
    const dom = new JSDOM(read('shop-profiles.html'), { runScripts: 'outside-only' });
    try {
      const shops = [{ id: 'original', name: 'Sri' }];
      if (connected) shops.push({ id: 'other', name: 'OBC' });
      let selected;
      dom.window.electronAPI = { install: {
        shops: async () => ({ active: connected ? 'other' : 'original', shops, connected }),
        openShop: id => { selected = id; },
      } };
      dom.window.eval(read('shop-profiles-view.js'));
      await new Promise(resolve => setImmediate(resolve));
      const doc = dom.window.document;
      const current = doc.querySelector('[aria-current]').closest('li');
      assert.equal(current.querySelector('button'), null);
      assert.equal(doc.querySelector('#search').hidden, !connected);
      assert.equal(doc.querySelector('#connect').hidden, connected);
      if (connected) {
        doc.querySelector('#shops button').click();
        assert.equal(selected, undefined);
        assert.match(doc.querySelector('#description').textContent, /Sri.*OBC/);
        doc.querySelector('#back').click();
        assert.equal(doc.activeElement, doc.querySelector('#shops button'));
        doc.querySelector('#shops button').click();
        doc.querySelector('#confirm').click();
        assert.equal(selected, 'original');
      }
      if (connected) continue;
      doc.querySelector('#add').click();
      assert.equal(selected, undefined);
      assert.match(doc.querySelector('#description').textContent, /cloud setup.*Sri/);
      doc.querySelector('#confirm').click();
      assert.equal(selected, 'add');
    } finally { dom.window.close(); }
  }
});
