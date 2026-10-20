'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
test('HSN selection requires exact origin, iframe, nonce and valid code; never changes tax', () => {
  const dom = new JSDOM('<div id="items_v2"></div><input id="hsn"><input id="hsn-description"><span id="hsn-hint"></span><input id="tax" value="18">', { url: 'https://shop.posnic.io' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () {};
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items-v2-details.js', 'utf8');
  const start = source.indexOf('    function openHsnSearch()');
  const end = source.indexOf('\n    function ', start + 12);
  const ctx = { caps: { hsn: true }, window, document: window.document, location: window.location, URLSearchParams, crypto: { randomUUID: () => 'request-test' },
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

test('HSN capability is India-only, independent of ordinary tax support', () => {
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items_v2.js', 'utf8');
  const start = source.indexOf('    function readCapabilities()');
  const end = source.indexOf('\n    function ', start + 12);
  for (const country of ['India', 'IN', ' ind ', 'United Kingdom', 'GB', 'Germany', 'DE', 'Hong Kong', 'HK', '', null]) {
    for (const enabled of [true, false]) {
      const ctx = { businessContext: null, P: { local: { get: key => key === 'general_settings' ? JSON.stringify({ module_tax_enable: enabled }) : key === 'country_setting' ? country : null } } };
      vm.runInNewContext(source.slice(start, end) + '\nresult=readCapabilities();', ctx);
      assert.equal(ctx.result.tax, enabled);
      assert.equal(ctx.result.hsn, enabled && ['India', 'IN', ' ind '].includes(country), String(country));
    }
  }
});

test('HSN search cannot open for non-India or unresolved country', () => {
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items-v2-details.js', 'utf8');
  const start = source.indexOf('    function openHsnSearch()');
  const end = source.indexOf('\n    function ', start + 12);
  for (const hsn of [false, undefined]) {
    vm.runInNewContext(source.slice(start, end) + '\nopenHsnSearch();', { caps: { hsn }, document: { createElement() { throw Error('must not open HSN search'); } } });
  }
});

test('normal item save needs no HSN and tax section starts hidden', () => {
  const { payload } = require('../frontend/static/script/js/modules/js/items_v2');
  const item = payload({name:'Pipe',price:70,cost:0,kind:'product',stock:'untracked',barcode:'',sku:'',description:'',taxRate:20});
  assert.equal(item.tax,20); assert.equal(item.hsn_code,undefined);
  const html=fs.readFileSync('frontend/modules/items_v2.html','utf8');
  assert.match(html,/id="iv2-tax-extra" hidden/);
  assert.doesNotMatch(html.match(/<input id="iv2-hsn"[^>]*>/)[0],/required/);
});

test('legacy item form also limits HSN to the business country', () => {
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items.js', 'utf8').split('PosnicPro.items =')[0];
  for (const country of ['India','IN','ind','GB','United Kingdom','DE','',null]) {
    const ctx={PosnicPro:{local:{get:()=>country}}};
    vm.runInNewContext(source+'\nresult=itemHsnAvailable();',ctx);
    assert.equal(ctx.result,['India','IN','ind'].includes(country));
  }
});
