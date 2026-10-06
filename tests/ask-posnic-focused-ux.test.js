'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const chat = read('frontend/modules/ask_posnic.html');
const settings = new JSDOM(read('frontend/modules/settings_write.html')).window.document.querySelector('#v-pills-ai').outerHTML;
const script = read('frontend/static/script/js/modules/js/ask_posnic.js');
function setup(admin = true) {
  const dom = new JSDOM(chat + settings);
  const $ = require('jquery')(dom.window), calls = [];
  $.fn.modal = function () { return this; };
  const PosnicPro = { HideSideBarModal() {}, i18n: { t: (_key, fallback) => fallback }, alert() {}, settings: { ai: { load() { calls.push('provider'); } } },
    get(url, done) { calls.push(url); done({ data: url === 'ask-posnic/status' ? { enabled: true, admin, scope: { license: 'shop', branch_id: 'outlet', user_id: 'user' }, preferences: {} } : [] }); }, request() {} };
  vm.runInNewContext(script, { PosnicPro, $, window: dom.window });
  PosnicPro.askposnic.bind();
  return { dom, $, PosnicPro, calls, ui: PosnicPro.askposnic };
}
test('conversation opens without settings controls or admin API requests', () => {
  const { $, ui, calls } = setup();
  ui.showDataTablePage();
  assert.equal($('#askposnic #ask_posnic_admin').length, 0);
  assert.equal($('#ask_posnic_suggestions button').length, 3);
  assert.equal($('#ask_history_panel').prop('hidden'), true);
  assert.deepEqual(calls, ['ask-posnic/status']);
});
test('settings gate admin data and lazy load only the selected tab', () => {
  const { $, ui, calls } = setup();
  ui.showSettings();
  assert.deepEqual(calls, ['ask-posnic/status']);
  ui.settingsTab('knowledge');
  assert.equal($('.ask-settings-panel:not([hidden])').attr('id'), 'ask-settings-knowledge');
  assert.equal($('#ask-tab-knowledge').attr('aria-selected'), 'true');
  assert.equal(calls.at(-1), 'ask-posnic/documents');
  ui.settingsTab('usage');
  assert.deepEqual(calls.slice(-3), ['provider', 'ask-posnic/audit', 'ask-posnic/recovery']);
  const denied = setup(false);
  denied.ui.showSettings(); denied.ui.settingsTab('knowledge');
  assert.deepEqual(denied.calls, ['ask-posnic/status']);
  assert.equal(denied.$('#ask_posnic_admin').css('display'), 'none');
});
test('preferences retain form ownership across tabs and save every section', () => {
  const { $, ui, PosnicPro } = setup();
  ui.showSettings(); ui.settingsTab('access');
  let saved;
  PosnicPro.request = options => { saved = JSON.parse(options.data); };
  $('#ask_pref_help_roles').val(['staff']);
  $('#ask_pref_retention').val('90');
  $('#ask_pref_own_semantic').prop('checked', true);
  $('.ask-allowed-action[value="stock_count"]').prop('checked', true);
  $('#ask_posnic_preferences_form').trigger('submit');
  assert.deepEqual(saved.roles.help, ['staff']); assert.equal(saved.retention_days, 90);
  assert.equal(saved.own_key_semantic, true); assert.deepEqual(saved.allowed_actions, ['stock_count']);
  $('[id^="ask_pref_"],#ask_help_instructions,.ask-allowed-action').each(function () { assert.equal(this.form.id, 'ask_posnic_preferences_form'); });
});
test('question progress, Enter and new conversation keep the chat usable', () => {
  const { $, ui, PosnicPro } = setup();
  ui.showDataTablePage();
  let complete, payload;
  PosnicPro.request = (options, done) => { payload = JSON.parse(options.data); complete = done; };
  $('#ask_posnic_question').val('How are sales today?').trigger($.Event('keydown', { key: 'Enter' }));
  assert.equal(payload.question, 'How are sales today?');
  assert.equal($('#ask_posnic_welcome').prop('hidden'), true);
  assert.equal($('#ask_posnic_progress').prop('hidden'), false);
  assert.equal($('#ask_new_conversation').prop('disabled'), true);
  complete({ type: 'success', data: { answer: 'A real answer', conversation_id: 'saved' } });
  assert.equal($('#ask_posnic_progress').prop('hidden'), true);
  $('#ask_new_conversation').trigger('click');
  assert.equal(ui.conversationId, null); assert.equal($('#ask_posnic_thread').text(), '');
  assert.equal($('#ask_posnic_welcome').prop('hidden'), false);
});
test('source review escapes untrusted content and publishes only after explicit review', () => {
  const { $, ui, PosnicPro } = setup(); let writes = 0;
  PosnicPro.get = (url, done) => done({ data: url.includes('?review=1') ? { title: 'Draft', content: '<img src=x onerror=alert(1)>', revision: 'r1', status: 'draft' } : [{ _id: 'source', title: 'Draft', kind: 'faq', status: 'draft', revision: 'r1' }, { _id: 'shared', title: 'Guide', origin: 'posnic-intranet', status: 'published' }] });
  PosnicPro.request = (options, done) => { writes++; assert.equal(JSON.parse(options.data).status, 'published'); done({ type: 'success' }); };
  ui.loadDocuments();
  assert.equal($('#ask_posnic_documents .ask-doc-review').length, 1);
  assert.equal($('#ask_posnic_shared_documents .ask-doc-review').length, 1);
  $('#ask_posnic_documents .ask-doc-review').trigger('click');
  assert.equal(writes, 0); assert.equal($('#ask_source_content img').length, 0);
  assert.match($('#ask_source_content').text(), /<img/);
  $('#ask_source_publish').trigger('click'); assert.equal(writes, 1);
});
test('a late source response cannot replace the document currently being reviewed', () => {
  const { $, PosnicPro } = setup(); const pending = [];
  PosnicPro.get = (_url, done) => pending.push(done);
  $('#ask_posnic_documents').html('<button class="ask-doc-review" data-id="first">First</button><button class="ask-doc-review" data-id="second">Second</button>');
  $('.ask-doc-review').eq(0).trigger('click'); $('.ask-doc-review').eq(1).trigger('click');
  pending[1]({ data: { title: 'Second', content: 'Second content', status: 'draft' } });
  pending[0]({ data: { title: 'First', content: 'First content', status: 'draft' } });
  assert.match($('#ask_source_title').text(), /^Second/);
  assert.equal($('#ask_source_content').text(), 'Second content');
  assert.equal($('#ask_source_publish').length, 1);
});
