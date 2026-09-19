'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const sale = { sales_id: 'KOT-1', print_jobs: [{ type: 'new', items: [
  { item_name: 'Soup <hot>', item_quantity: 2, item_note: '<script>salt</script>', item_price: 100 },
] }] };
function setup() {
  const dom = new JSDOM('<div id="kot-print-feedback" hidden></div><input type="checkbox" id="kot-counter-auto"><select id="kot-counter-width"><option>80</option><option>58</option></select>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window, $ = require('jquery')(w), calls = [], prints = [], prefs = { branch_id_set: 'shop' };
  w.$ = $;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const response = { state: 'ready', token: 'token', sale };
  w.PosnicPro = { escapeHtml: value => $('<i>').text(value).html(),
    i18n: { t: (_key, fallback) => fallback }, local: { get: k => prefs[k], set: (k, v) => { prefs[k] = v; } },
    post: (params, done) => { const body = JSON.parse(params.data); calls.push(body); done({ type: 'success', data: body.action === 'prepare' ? response : { state: body.action } }); },
  };
  w.electronAPI = { kot: { printTicket: async ticket => { prints.push(ticket); return { available: true, success: true }; } } };
  w.eval(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core/kot-print.js'), 'utf8'));
  return { dom, w, $, calls, prints, prefs, response, api: w.PosnicPro.kotPrint };
}
test('manual printing uses the kitchen bridge and confirms only after success', async () => {
  const s = setup();
  await s.api.print('id');
  assert.equal(s.prints.length, 1);
  assert.deepEqual(s.calls.map(c => c.action), ['prepare', 'renew', 'confirm']);
  assert.equal(s.$('#kot-print-feedback button').length, 0);
  assert.match(s.$('#kot-print-feedback').text(), /KOT printed/);
  s.dom.window.close();
});
test('auto is off by default; enabling it affects only this branch and counter', async () => {
  const s = setup();
  s.api.afterSave('id'); await tick();
  assert.equal(s.calls.length, 0);
  assert.equal(s.$('#kot-print-feedback').prop('hidden'), true);
  s.api.restore();
  assert.equal(s.$('#kot-print-feedback').prop('hidden'), true);
  s.$('#kot-counter-auto').prop('checked', true).trigger('change');
  s.api.afterSave('id'); await tick();
  assert.equal(s.prints.length, 1);
  s.prefs.branch_id_set = 'other';
  s.api.afterSave('other-order'); await tick();
  assert.equal(s.prints.length, 1);
  s.dom.window.close();
});
test('a refused printer is not acknowledged or sent to the receipt printer', async () => {
  const s = setup();
  s.w.electronAPI.kot.printTicket = async () => ({ available: true, success: false, error: 'offline' });
  await s.api.print('id');
  assert.deepEqual(s.calls.map(c => c.action), ['prepare', 'renew']);
  assert.match(s.$('#kot-print-confirm').text(), /offline/);
  s.$('#kot-print-confirm button').last().trigger('click'); await tick();
  assert.equal(s.calls.at(-1).action, 'release');
  s.dom.window.close();
});
test('already printed does not produce paper without the explicit copy action', async () => {
  const s = setup(); s.response.state = 'printed';
  await s.api.print('id');
  assert.equal(s.prints.length, 0);
  const button = s.$('#kot-print-feedback button').filter((_, el) => el.textContent === 'Reprint a copy');
  assert.equal(button.length, 1);
  assert.equal(s.$('#kot-print-feedback button').length, 1);
  s.response.state = 'copy'; delete s.response.token;
  button.trigger('click'); await tick();
  assert.equal(s.calls.at(-1).copy, true);
  assert.equal(s.prints.length, 1);
  s.dom.window.close();
});
test('browser rendering has kitchen notes, escaped content and no money', () => {
  const s = setup();
  const html = s.api.render(sale, '58');
  assert.match(html, /width:48mm/);
  assert.match(html, /Soup &lt;hot&gt;/);
  assert.match(html, /&lt;script&gt;salt/);
  assert.doesNotMatch(html, /<script>|100|item_price/);
  assert.match(s.api.render({ ...sale, print_jobs: [{ ...sale.print_jobs[0], type: 'copy' }] }, '80'), /Do not prepare again/);
  s.dom.window.close();
});

test('closing the browser dialog never acknowledges the KOT without confirmation', async () => {
  const s = setup(); delete s.w.electronAPI;
  const pending = s.api.print('id');
  await tick();
  const frame = s.$('iframe');
  frame[0].contentWindow.focus = () => {};
  frame[0].contentWindow.print = () => frame[0].contentWindow.onafterprint();
  frame.trigger('load');
  await pending;
  assert.deepEqual(s.calls.map(c => c.action), ['prepare', 'renew']);
  assert.equal(s.$('#kot-print-confirm').length, 1);
  s.$('#kot-print-confirm button').first().trigger('click'); await tick();
  assert.equal(s.calls.at(-1).action, 'confirm');
  s.dom.window.close();
});

test('double clicks cannot send the same ticket twice', async () => {
  const s = setup(); let done;
  s.w.electronAPI.kot.printTicket = async ticket => { s.prints.push(ticket); return new Promise(resolve => { done = resolve; }); };
  const first = s.api.print('id'); await tick();
  await s.api.print('id');
  assert.equal(s.prints.length, 1);
  done({ available: true, success: true }); await first;
  s.dom.window.close();
});

test('a missing order never leaves a print action in the page banner', async () => {
  const s = setup(); let reject;
  s.w.PosnicPro.post = (_params, _done, failed) => { reject = failed; };
  const pending = s.api.print('missing-order');
  assert.match(s.$('#kot-print-feedback').text(), /Preparing KOT/);
  assert.equal(s.$('#kot-print-feedback button').length, 0);
  reject({ status: 404, responseJSON: { message: 'KOT order not found in this shop.' } });
  await pending;
  assert.match(s.$('#kot-print-feedback').text(), /not found in this shop/);
  assert.equal(s.$('#kot-print-feedback button').length, 0);
  assert.equal(s.$('#kot-print-feedback').hasClass('alert-danger'), true);
  assert.equal(s.$('#kot-print-feedback [role="alert"]').length, 1);
  assert.equal(s.prints.length, 0);
  s.api.restore();
  assert.equal(s.$('#kot-print-feedback').prop('hidden'), true);
  assert.equal(s.$('#kot-print-feedback').text(), '');
  s.dom.window.close();
});

test('an unfinished ticket retains only the confirmation recovery action', async () => {
  const s = setup();
  s.w.electronAPI.kot.printTicket = async () => ({ available: true, success: false, error: 'offline' });
  await s.api.print('id');
  s.$('#kot-print-confirm').trigger('cancel');
  const button = s.$('#kot-print-feedback button');
  assert.equal(button.length, 1);
  assert.equal(button.text(), 'Confirm KOT printing');
  button.trigger('click');
  assert.equal(s.$('#kot-print-confirm').length, 1);
  assert.match(s.$('#kot-print-confirm p').text(), /Confirm only after the ticket comes out/);
  assert.equal(s.calls.length, 2);
  s.$('#kot-print-confirm button').first().trigger('click'); await tick();
  assert.equal(s.calls.at(-1).action, 'confirm');
  assert.equal(s.$('#kot-print-feedback button').length, 0);
  s.dom.window.close();
});
