'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/install-wizard.html'), 'utf8');

test('compact cloud choice, Community setup and pairing remain available', () => {
  const dom = new JSDOM(source), doc = dom.window.document;
  assert.equal(doc.querySelector('.simple-options button').id, 'chooseCloudBtn');
  assert.match(doc.querySelector('#chooseLocalBtn').textContent, /Set up offline/);
  assert.equal(doc.querySelector('#pairDetails').open, false);
  assert.equal(doc.querySelector('#customServerDetails').open, false);
  assert.ok(doc.querySelector('#pairCode'));
  assert.equal(doc.querySelector('#cloudServer').type, 'hidden');
  assert.equal(doc.querySelector('#suPassword'), null);
  dom.window.close();
});
test('trial and sign-in actions use browser authorization; pairing stays independent', async () => {
  const dom = new JSDOM(source, { runScripts: 'outside-only' });
  const calls = [], pending = [], pairCalls = [];
  dom.window.electronAPI = { cloud: {
    authorize: async (intent) => { calls.push(intent); return { ok: true }; },
    pair: async (details) => { calls.push(details.code); pairCalls.push(details); return { ok: true }; },
    cancelAuthorization: () => calls.push('cancel'), reopenAuthorization: async () => ({ ok: true }),
  } };
  dom.window.showSection = () => {};
  dom.window.runCloudSetup = (connect) => { const p = connect(); pending.push(p); return p; };
  const start = source.indexOf('        async function startBrowserCloud(');
  const end = source.indexOf("        document.getElementById('cloudBackBtn')", start);
  dom.window.eval(source.slice(start, end));
  for (const id of ['chooseCloudBtn', 'signupLink', 'cloudSignupLink', 'browserSignInBtn']) dom.window.document.getElementById(id).click();
  dom.window.document.getElementById('pairServer').value = 'https://shop.example';
  dom.window.document.getElementById('pairCode').value = 'P1-K7M4-9QX2';
  dom.window.document.getElementById('pairBtn').click();
  await Promise.all(pending);
  assert.deepEqual(calls, ['login', 'signup', 'login', 'P1-K7M4-9QX2']);
  assert.equal(pairCalls[0].serverUrl, 'https://shop.example');
  dom.window.document.getElementById('cancelBrowserBtn').click(); assert.equal(calls.at(-1), 'cancel');
  dom.window.close();
});
