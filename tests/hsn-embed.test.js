'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
test('HSN selection requires exact origin, iframe, nonce and valid code; never changes tax', () => {
  const dom = new JSDOM('<input id="hsn"><input id="hsn-description"><span id="hsn-hint"></span><input id="tax" value="18">', { url: 'https://shop.posnic.io' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () {};
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items-v2-details.js', 'utf8');
  const start = source.indexOf('    function openHsnSearch()');
  const end = source.indexOf('\n    function ', start + 12);
  const ctx = { window, document: window.document, location: window.location, URLSearchParams, crypto: { randomUUID: () => 'request-test' },
    el: id => window.document.getElementById(id), notify: () => {},
    button: (text, fn) => { const b = window.document.createElement('button'); b.textContent = text; b.onclick = fn; return b; } };
  vm.runInNewContext(source.slice(start, end) + '\nopenHsnSearch();', ctx);
  const frame = window.document.querySelector('iframe');
  const data = { type: 'posnic.hsn.selected', version: 1, requestId: 'request-test', selection: { code: '39251000', kind: 'HSN', description: 'Tanks >300 L', context: 'Plastic' } };
  function send(origin, sourceWindow, payload = data) { window.dispatchEvent(new window.MessageEvent('message', { origin, source: sourceWindow, data: payload })); }
  send('https://evil.example', frame.contentWindow);
  send('https://www.posnic.com', window);
  send('https://www.posnic.com', frame.contentWindow, { ...data, requestId: 'old' });
  send('https://www.posnic.com', frame.contentWindow, { ...data, selection: { ...data.selection, code: '<script>' } });
  assert.equal(ctx.el('hsn').value, '');
  send('https://www.posnic.com', frame.contentWindow);
  assert.equal(ctx.el('hsn').value, '39251000');
  assert.equal(ctx.el('hsn-description').value, 'Plastic — Tanks >300 L');
  assert.equal(ctx.el('tax').value, '18');
  assert.equal(window.document.querySelector('iframe'), null);
  dom.window.close();
});
