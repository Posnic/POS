const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function ui(t, route = 'sales/new') {
  const dom = new JSDOM(read('frontend/layouts/header.html') + read('frontend/layouts/sidebar.html') + read('frontend/layouts/about.html'), { url: 'https://shop.example/dashboard.html#/' + route, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, $ = jquery(w), modals = [];
  w.$ = w.jQuery = $;
  $.fn.modal = function () { modals.push(this.attr('id')); return this; };
  w.PosnicPro = { i18n: { t: (_key, english) => english } };
  w.fetch = () => assert.fail('opening Help must not make network calls');
  for (const file of ['page-help-topics', 'page-help']) w.eval(read('frontend/static/script/js/core/' + file + '.js'));
  const get = id => w.document.getElementById(id);
  return { w, $, get, modals };
}
test('page-specific Help changes with route, uses canonical links and makes no request', t => {
  const u = ui(t);
  u.get('posnic_help_toggle').click();
  assert.equal(u.get('posnic_help_menu').hidden, false);
  assert.equal(u.get('posnic_page_help').textContent, 'Help with Add Sale');
  assert.equal(u.get('posnic_page_help').href, 'https://www.posnic.com/guides/posnic-pos-complete-user-guide/sales/add-sale/');
  u.w.location.hash = '#/settings/taxmodule';
  u.w.dispatchEvent(new u.w.HashChangeEvent('hashchange'));
  assert.equal(u.get('posnic_help_menu').hidden, true);
  u.w.PosnicPro.pageHelp.open();
  assert.equal(u.get('posnic_page_help').textContent, 'Help with Tax Settings');
  assert.match(u.get('posnic_page_help').href, /settings\/tax-system-rates-groups\/$/);
});
test('record routes do not mistake an edit form for its list, unknown pages have no guessed guide', t => {
  const u = ui(t, 'sales/sale-123/edit');
  u.w.PosnicPro.pageHelp.open();
  assert.match(u.get('posnic_page_help').href, /sales\/edit-saved-sale\/$/);
  assert.equal(u.get('posnic_page_help').textContent, 'Help with Edit Sale');
  u.w.location.hash = '#/extensions/unknown/find/private/record-123';
  u.w.PosnicPro.pageHelp.open();
  assert.equal(u.get('posnic_page_help').hasAttribute('href'), false);
  assert.equal(u.get('posnic_guide_status').hidden, false);
  assert.doesNotMatch(u.get('posnic_page_help').textContent, /record-123/);
});
test('F1 and Escape support keyboard access; feedback/About reuse existing dialogs without submitting', t => {
  const u = ui(t);
  u.w.document.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
  assert.equal(u.get('posnic_help_toggle').getAttribute('aria-expanded'), 'true');
  u.w.document.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(u.get('posnic_help_menu').hidden, true);
  assert.equal(u.w.document.activeElement, u.get('posnic_help_toggle'));
  u.w.PosnicPro.pageHelp.open(); u.get('posnic_help_feedback').click();
  u.w.PosnicPro.pageHelp.open(); u.get('posnic_help_about').click();
  assert.deepEqual(u.modals, ['posnic_feedback_dialog', 'posnic_about_dialog']);
});
test('every sidebar destination has an explicit help inventory entry and every locale preserves the page placeholder', t => {
  const u = ui(t), topics = u.w.PosnicHelpTopics;
  for (const link of u.w.document.querySelectorAll('a[href^="#/"]')) assert.ok(topics[link.getAttribute('href').slice(2)]);
  for (const lang of require('../frontend/gulpfile.js/config').LANGUAGES) {
    const pack = require('../languages/' + (lang.code === 'en' ? '_english' : lang.code) + '.json');
    assert.equal(pack.lang_help_with_page.split('{page}').length, 2, lang.code);
    for (const key of ['lang_help_all_guides', 'lang_help_guide_update', 'lang_help_tax_settings']) assert.ok(pack[key], lang.code);
  }
  u.w.PosnicHelpTopics['sales/new'].guide = 'https://example.invalid/';
  u.w.PosnicPro.pageHelp.open();
  assert.equal(u.get('posnic_page_help').hasAttribute('href'), false);
});
test('All search finds contextual help and all guides for restricted staff without opening a page or submitting', t => {
  const u = ui(t);
  u.w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  u.w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  Object.assign(u.w.PosnicPro, { local: { get: () => null }, userACL: {}, get: () => {} });
  u.w.eval(read('frontend/static/script/js/core/command-palette.js'));
  for (const [query, label] of [['instructions', 'Help'], ['all guides', 'All guides']]) {
    u.get('posnic-header-search').click();
    const input = u.get('cmdk-input');
    input.value = query; input.dispatchEvent(new u.w.Event('input'));
    const found = [...u.w.document.querySelectorAll('#cmdk-list [role=option]')].find(el => el.firstElementChild.textContent.trim() === label);
    assert.ok(found, label);
    if (label === 'Help') { found.click(); assert.equal(u.get('posnic_help_menu').hidden, false); }
  }
});
test('F1 from an open form preserves its focus boundary and Escape returns to the field', t => {
  const u = ui(t);
  const modal = u.w.document.createElement('div');
  modal.className = 'modal show'; modal.innerHTML = '<input value="Unsaved text">';
  u.w.document.body.appendChild(modal);
  const input = modal.querySelector('input'); input.focus();
  input.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
  assert.equal(u.get('posnic_help_menu').parentElement, modal);
  u.w.document.activeElement.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(u.w.document.activeElement, input);
  assert.equal(input.value, 'Unsaved text');
  assert.equal(modal.className, 'modal show');
});
