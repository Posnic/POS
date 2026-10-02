'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const status of [409, 422, 500, 0]) {
  test(`payment load reports HTTP ${status} separately from a lost connection`, async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://shop.invalid', runScripts: 'outside-only' });
    const w = dom.window;
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    const message = status === 409 ? 'Refresh the table payment details.' : 'Please retry.';
    w.PosnicPro = { local: { get: () => 'branch' }, post: (_options, _success, failure) => failure({ status, responseJSON: { error: { message } } }) };
    for (const name of ['captain-money.js', 'captain-payments.js']) w.eval(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core', name), 'utf8'));
    await w.CaptainPayments.open('6');
    const text = w.document.querySelector('#captain-payments').textContent;
    if (status) {
      assert.ok(text.includes(message));
      assert.doesNotMatch(text, /Connect to the shop server/);
    } else assert.match(text, /Connect to the shop server/);
    dom.window.close();
  });
}

test('desktop guest payment is reviewed before recording, preserves Back and shows confirmed change', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url:'https://shop.invalid', runScripts:'outside-only' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const requests = [];
  const plan = {id:'plan',table:'1',currency:'₹',totalMinor:10000,paidMinor:0,dueMinor:10000,enabled:true,version:0,methods:['Cash'],guests:[{name:'Guest 1',totalMinor:10000,paid:false}]};
  w.PosnicPro = {local:{get:()=> 'branch'}, post:(options, success)=> {
    const body=JSON.parse(options.data);
    requests.push({url:options.url,body});
    if(options.url.endsWith('/table')) success(plan);
    else if(options.url.endsWith('/record')) success({...plan,dueMinor:0,paidMinor:10000,confirmed:body.request_id,payments:[{id:body.request_id,method:'Cash',amountMinor:10000,receivedMinor:12000,changeMinor:2000,at:'2026-09-30T12:00:00Z',staff:'Captain'}]});
    else success({released:true});
  }};
  for(const name of ['captain-money.js','captain-payments.js']) w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core',name),'utf8'));
  await w.CaptainPayments.open('1');
  const input=w.document.querySelector('#cp-received');input.value='120';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.document.querySelector('[data-action=record]').click();
  assert.equal(requests.filter(r=>r.url.endsWith('/record')).length,0);
  assert.match(w.document.querySelector('.cp-review').textContent,/20\.00/);
  w.dispatchEvent(new w.Event('captain:back',{cancelable:true}));
  assert.equal(w.document.querySelector('#cp-received').value,'120');
  w.document.querySelector('[data-action=record]').click();
  w.document.querySelector('[data-action=record]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.filter(r=>r.url.endsWith('/record')).length,1);
  assert.match(w.document.querySelector('.cp-receipt').textContent,/Payment recorded/);
  assert.match(w.document.querySelector('.cp-receipt').textContent,/20\.00/);
  assert.equal(w.document.querySelector('[data-action=record]'),null);
  dom.window.close();
});
