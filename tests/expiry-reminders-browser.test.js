const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('expiry bell reads the active POS branch and ignores replies from a previous branch', () => {
  const state = { branch_id_set: 'branch-a' }, requests = [], elements = {};
  const $ = (selector) => elements[selector] ||= { visible: false, textValue: '', hide() { this.visible = false; return this; }, toggle(value) { this.visible = value; return this; }, text(value) { this.textValue = value; return this; } };
  const PosnicPro = { local: { get: key => state[key] }, bellFeed: { _can: () => true, _badge() {} }, get: (request, done) => requests.push({ request, done }), i18n: { t: (key, fallback) => fallback } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/expiry-reminders.js'), 'utf8'), { PosnicPro, $, window: {}, document: {} });
  const response = { type: 'success', data: { enabled: true, today: '2026-10-08', total: 1, rows: [{ id: 'product', expiryDate: '2026-10-09' }] } };
  PosnicPro.expiryReminders.refresh();
  assert.equal(requests.length, 1);
  requests[0].done(response);
  assert.equal(PosnicPro.bellFeed._expiryCount, 1);
  assert.equal(elements['#expiry_bell_section'].visible, true);
  assert.equal(elements['#expiry_bell_link'].textValue, 'Expiry reminders (1)');
  state.branch_id_set = 'branch-b';
  PosnicPro.expiryReminders.refresh();
  assert.equal(PosnicPro.bellFeed._expiryCount, 0);
  requests[0].done(response);
  assert.equal(PosnicPro.bellFeed._expiryCount, 0);
  requests[1].done({ type: 'success', data: { ...response.data, enabled: false, total: 0, rows: [] } });
  assert.equal(elements['#expiry_bell_section'].visible, false);
});
