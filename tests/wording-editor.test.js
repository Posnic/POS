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
  input(doc.getElementById('wording-name'), 'English — Shop');
  input(doc.getElementById('wording-search'), 'takeaway');
  assert.equal(doc.querySelectorAll('[data-word]').length, 1);
  input(doc.querySelector('[data-word]'), 'Parcel');
  doc.querySelector('[data-branch]').checked = true;
  doc.getElementById('wording-publish').click();
  assert.equal(JSON.parse(calls[0].data).overrides['posnic.lang_takeaway'], 'Parcel');
  assert.deepEqual(JSON.parse(calls[1].data).branches, ['b']);
  assert.equal(JSON.parse(calls[1].data).expectedRevision, 1);
  assert.match(doc.getElementById('wording-notice').textContent, /Published/);
  dom.window.close();
});
