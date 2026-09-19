'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/install-wizard.html'), 'utf8');

test('cloud trial leads, offline Community setup and pairing remain available', () => {
  const dom = new JSDOM(source), doc = dom.window.document;
  assert.equal(doc.querySelector('.mode-cards').firstElementChild.id, 'modeCloud');
  assert.match(doc.querySelector('#modeCloud').textContent, /14-day free trial/);
  assert.equal(doc.querySelector('#chooseLocalBtn').textContent, 'Set up offline');
  assert.ok(doc.querySelector('#pairCode'));
  assert.equal(doc.querySelector('#cloudServer').type, 'hidden');
  assert.equal(doc.querySelector('#suPassword'), null);
  dom.window.close();
});
test('trial and sign-in actions use browser authorization; pairing stays independent', async () => {
  const dom = new JSDOM(source, { runScripts: 'outside-only' });
  const calls = [], pending = [];
  dom.window.electronAPI = { cloud: {
    authorize: async (intent) => { calls.push(intent); return { ok: true }; },
    pair: async (details) => { calls.push(details.code); return { ok: true }; },
    cancelAuthorization: () => calls.push('cancel'), reopenAuthorization: async () => ({ ok: true }),
  } };
  dom.window.showSection = () => {};
  dom.window.runCloudSetup = (connect) => { const p = connect(); pending.push(p); return p; };
  const start = source.indexOf('        async function startBrowserCloud(');
  const end = source.indexOf("        document.getElementById('cloudBackBtn')", start);
  dom.window.eval(source.slice(start, end));
  for (const id of ['chooseCloudBtn', 'signupLink', 'cloudSignupLink', 'browserSignInBtn']) dom.window.document.getElementById(id).click();
  dom.window.document.getElementById('pairCode').value = 'P1-K7M4-9QX2';
  dom.window.document.getElementById('pairBtn').click();
  await Promise.all(pending);
  assert.deepEqual(calls, ['signup', 'login', 'signup', 'login', 'P1-K7M4-9QX2']);
  dom.window.document.getElementById('cancelBrowserBtn').click(); assert.equal(calls.at(-1), 'cancel');
  dom.window.close();
});
