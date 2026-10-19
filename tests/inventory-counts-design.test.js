const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
function setup() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'frontend/modules/inventoryCounts.html'), 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  for (const file of ['frontend/static/script/js/jquery.min.js', 'frontend/static/script/js/moment.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const requests = [];
  w.PosnicPro = { local: { get: () => 'branch' }, i18n: { t: (key, fallback) => fallback }, get: (url, callback) => requests.push({ url, callback }) };
  w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/inventory_counts.js'), 'utf8'));
  return { dom, w, requests, $: w.$, api: w.PosnicPro.inventorycounts };
}
const operation = { operationId: 'op1', mode: 'count', state: 'complete', reason: '<img src=x onerror=alert(1)>', createdAt: '2026-10-19T09:30:00Z', lines: [{ itemId: 'item', name: 'Notebook', expected: 10000, quantity: 8000 }], applied: ['item'] };
test('stock activity uses safe compact rows and preserves rows on an empty last page', () => {
  const { dom, api, requests, $ } = setup();
  api.loadMobile(); requests.shift().callback({ rows: [operation], next: 'next' });
  assert.equal($('.inventory-table tbody tr').length, 1);
  assert.equal($('.inventory-status.complete').text(), 'Completed');
  assert.equal($('#mobile_inventory_rows img').length, 0);
  assert.equal($('.inventory-operation small').text(), operation.reason);
  api.loadMobile('next'); requests.shift().callback({ rows: [] });
  assert.equal($('.inventory-table tbody tr').length, 1);
  assert.equal($('.mobile-inventory-more').length, 0);
  dom.window.close();
});
test('review closes, restores focus and ignores a late detail response', () => {
  const { dom, api, requests, $ } = setup();
  api.loadMobile(); requests.shift().callback({ rows: [operation] });
  api.openMobile('op1'); requests.shift().callback(operation);
  assert.equal($('#mobile_inventory_detail .inventory-status').text(), 'Completed');
  assert.equal($('#mobile_inventory_detail tbody tr').length, 1);
  api.openMobile('op1'); const late = requests.shift();
  $('.mobile-inventory-close').trigger('click'); late.callback(operation);
  assert.equal($('#mobile_inventory_detail').html(), '');
  dom.window.close();
});
