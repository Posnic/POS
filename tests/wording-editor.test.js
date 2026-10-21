const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('searchable editor saves a draft then publishes selected branches without a preview', () => {
  const dom = new JSDOM('<div id="wording-editor"></div>', { runScripts: 'outside-only' });
  const calls = [];
  const state = { revision: 0, profiles: [], assignments: {} };
  const data = { state, writable: true, locales: ['en'], branches: [{ id: 'b', name: 'Shop' }], labels: [{ id: 'posnic.lang_takeaway', english: 'Takeaway', module: 'Posnic' }, { id: 'posnic.lang_product', english: 'Product', module: 'Posnic' }] };
  dom.window.PosnicPro = { local: { get: () => 'super_admin' }, i18n: { t: (_, v) => v },
    get: (_, cb) => cb({ type: 'success', data }),
    put: (req, cb) => { calls.push(req); const draft = JSON.parse(req.data); state.revision++; state.profiles = [{ id: 'p', draft }]; cb({ type: 'success', data: state }); },
    post: (req, cb) => { calls.push(req); state.revision++; cb({ type: 'success', data: state }); }
  };
  dom.window.eval(fs.readFileSync('frontend/static/script/js/modules/js/wording-editor.js', 'utf8'));
  dom.window.PosnicPro.wordingEditor.open();
  const doc = dom.window.document;
  function input(el, value) { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
  assert.equal(doc.getElementById('wording-tab-words'), null);
  doc.getElementById('wording-create').click();
  input(doc.getElementById('wording-name'), 'English — Shop');
  doc.getElementById('wording-profile-save').click();
  calls.length = 0;
  assert.equal(doc.getElementById('wording-search'), null);
  doc.getElementById('wording-tab-advanced').click();
  input(doc.getElementById('wording-search'), 'takeaway');
  assert.equal(doc.querySelectorAll('[data-word]').length, 1);
  input(doc.querySelector('[data-word]'), 'Parcel');
  doc.querySelector('[data-branch]').checked = true;
  doc.getElementById('wording-publish').click();
  assert.equal(JSON.parse(calls[0].data).overrides['posnic.lang_takeaway'], 'Parcel');
  assert.deepEqual(JSON.parse(calls[1].data).branches, ['b']);
  assert.equal(JSON.parse(calls[1].data).expectedRevision, 2);
  assert.match(doc.getElementById('wording-notice').textContent, /Published/);
  dom.window.close();
});
test('pagination reaches every label and preserves draft edits across search, sizing and filters', () => {
  const dom = new JSDOM('<div id="wording-editor"></div>', { runScripts: 'outside-only' });
  const data = { state: { revision: 0, profiles: [{ id: 'p', draft: { name: 'Shop', locale: 'en', rules: [], overrides: {} } }], assignments: {} }, writable: true, locales: ['en'], branches: [],
    labels: Array.from({ length: 131 }, (_, i) => ({ id: 'posnic.label' + i, english: 'Label ' + i, module: 'Core' })) };
  dom.window.PosnicPro = { local: { get: () => 'super_admin' }, i18n: { t: (_, v) => v }, get: (_, cb) => cb({ type: 'success', data }) };
  dom.window.eval(fs.readFileSync('frontend/static/script/js/modules/js/wording-editor.js', 'utf8'));
  dom.window.PosnicPro.wordingEditor.open();
  const q = s => dom.window.document.querySelector(s);
  const event = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  q('#wording-tab-advanced').click();
  assert.equal(dom.window.document.querySelectorAll('[data-word]').length, 25);
  q('[data-word]').value = 'My label'; event(q('[data-word]'), 'input');
  for (let i = 0; i < 5; i++) q('#wording-next').click();
  assert.equal(q('#wording-results').textContent, '126–131 / 131');
  assert.equal(q('#wording-next').disabled, true);
  q('#wording-search').value = 'My label'; event(q('#wording-search'), 'input');
  assert.equal(q('[data-word]').value, 'My label');
  q('#wording-search').value = ''; event(q('#wording-search'), 'input');
  q('#wording-page-size').value = '100'; event(q('#wording-page-size'), 'change');
  assert.equal(dom.window.document.querySelectorAll('[data-word]').length, 100);
  q('#wording-changed').checked = true; event(q('#wording-changed'), 'change');
  assert.equal(q('#wording-results').textContent, '1–1 / 1');
  q('[data-reset]').click();
  assert.equal(q('#wording-results').textContent, '0–0 / 0');
  assert.equal(q('#wording-prev').disabled, true);
  dom.window.close();
});
