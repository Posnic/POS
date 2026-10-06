'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('dashboard loads payment dependencies before KOT without visiting reports', () => {
  const map = require('../frontend/pages_css_js_map.json');
  const scripts = map.dashboard.js;
  const money = scripts.indexOf('static/script/js/core/captain-money.js');
  const payments = scripts.indexOf('static/script/js/core/captain-payments.js');
  const kot = scripts.indexOf('static/script/js/modules/js/kot_v2.js');
  assert.ok(money >= 0 && payments > money && kot > payments);
  assert.ok(!map.lazy_reports.includes('static/script/js/core/captain-payments.js'), 'Reports must not recreate the payment module');
});

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

for (const closeReceipt of [false, true]) test('desktop guest payment preserves review and confirmed change; close receipt=' + closeReceipt, async () => {
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
  let successMessage;
  if (closeReceipt) w.addEventListener('captain:payment-recorded', event => { successMessage = event.detail.message; event.preventDefault(); });
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
  assert.equal(w.document.querySelector('#captain-payments').hasAttribute('open'), !closeReceipt);
  if (closeReceipt) assert.match(successMessage, /Change to return.*20\.00/);
  dom.window.close();
});

test('split cash UPI and card is reviewed and retried as one immutable payment',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://shop.invalid',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const plan={id:'plan',currency:'₹',totalMinor:100000,paidMinor:0,dueMinor:100000,enabled:true,version:0,methods:['Cash','Upi','Card'],guests:[{name:'Bill',totalMinor:100000,paid:false}]};const records=[];let fail=true;
 w.PosnicPro={local:{get:()=> 'branch'},post:(o,ok,bad)=>{const b=JSON.parse(o.data);if(o.url.endsWith('/record')){records.push(b);if(fail)bad({status:0});else ok({...plan,dueMinor:0,paidMinor:100000,confirmed:b.request_id,payments:[{...b,id:b.request_id,changeMinor:b.receivedMinor-b.amountMinor}]});}else ok(plan);}};
 for(const f of ['captain-money.js','captain-payments.js'])w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core',f),'utf8'));
 await w.CaptainPayments.open('1');w.document.querySelector('[data-method=Mixed]').click();
 const input=(m,f,v)=>{const e=w.document.querySelector('[data-tender="'+m+'"][data-field="'+f+'"]');if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const focus=m=>w.document.querySelector('[data-tender="'+m+'"][data-field=amount]').dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));
 input('Cash','amount','300');focus('Upi');assert.equal(w.document.querySelector('[data-tender=Upi][data-field=amount]').value,'700');
 input('Upi','amount','400');focus('Card');assert.equal(w.document.querySelector('[data-tender=Card][data-field=amount]').value,'300');
 assert.match(w.document.querySelector('#cp-split-remaining').textContent,/0.00/);
 focus('Cash');assert.equal(w.document.querySelector('[data-tender=Cash][data-field=amount]').value,'300');
 input('Cash','amount','500');input('Cash','received','600');input('Upi','amount','300');input('Card','amount','100');
 w.document.querySelector('[data-action=record]').click();assert.equal(w.document.querySelector('.cp-review'),null);assert.equal(records.length,0);
 input('Card','amount','200');w.document.querySelector('[data-action=record]').click();assert.equal(w.document.querySelector('.cp-review'),null);
 input('Upi','verified',true);input('Card','verified',true);w.document.querySelector('[data-action=record]').click();assert.match(w.document.querySelector('.cp-review').textContent,/500.00/);assert.match(w.document.querySelector('.cp-review').textContent,/300.00/);assert.match(w.document.querySelector('.cp-review').textContent,/200.00/);assert.match(w.document.querySelector('.cp-review').textContent,/100.00/);assert.equal(records.length,0);
 w.document.querySelector('[data-action=back]').click();assert.equal(w.document.querySelector('[data-tender=Cash][data-field=amount]').value,'500');w.document.querySelector('[data-action=record]').click();w.document.querySelector('[data-action=record]').click();await new Promise(r=>setImmediate(r));assert.equal(records.length,1);assert.equal(records[0].method,'Mixed');assert.equal(records[0].receivedMinor,110000);assert.deepEqual(records[0].tenders.map(t=>t.amountMinor),[50000,30000,20000]);
 fail=false;w.document.querySelector('[data-action=record]').click();await new Promise(r=>setImmediate(r));assert.deepEqual(records[1],records[0]);assert.match(w.document.querySelector('.cp-receipt').textContent,/UPI/);assert.equal(w.document.querySelector('[data-action=record]'),null);dom.window.close();
});
test('cash entry separates bill allocation, handed cash and live change in single and split payments', async () => {
 const dom=new JSDOM('<body></body>',{url:'https://shop.invalid',runScripts:'outside-only'}),w=dom.window;
 try {
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const plan={id:'plan',currency:'₹',dueMinor:34300,enabled:true,methods:['Cash','Card'],guests:[{name:'Table 99',totalMinor:34300,paid:false}]};
 w.PosnicPro={local:{get:()=> 'branch'},post:(_o,ok)=>ok(plan)};
 for(const f of ['captain-money.js','captain-payments.js'])w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core',f),'utf8'));
 await w.CaptainPayments.open('99');
 const enter=(selector,value)=>{const e=w.document.querySelector(selector);e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const summary=()=>w.document.querySelector('#cp-cash-summary').textContent;
 enter('#cp-received','555');assert.match(summary(),/Change to return.*212.00/);
 enter('#cp-received','300');assert.match(summary(),/Still to collect.*43.00/);
 w.document.querySelector('[data-action=exact-cash]').click();assert.equal(w.document.querySelector('#cp-received').value,'343.00');assert.match(summary(),/0.00/);
 w.document.querySelector('[data-method=Mixed]').click();
 assert.match(w.document.querySelector('.cp-split').textContent,/Left to allocate/);
 assert.match(w.document.querySelector('fieldset').textContent,/Cash towards bill.*Cash handed over/s);
 enter('[data-tender=Cash][data-field=amount]','343');enter('[data-tender=Cash][data-field=received]','555');assert.match(summary(),/Change to return.*212.00/);
 enter('[data-tender=Cash][data-field=amount]','300');assert.match(summary(),/255.00/);
 enter('[data-tender=Cash][data-field=received]','200');assert.match(summary(),/Still to collect.*100.00/);
 w.document.querySelector('[data-action=exact-cash]').click();assert.equal(w.document.querySelector('[data-tender=Cash][data-field=received]').value,'300');assert.match(summary(),/0.00/);
 } finally {w.close();}
});
