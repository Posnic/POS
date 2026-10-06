'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/kot-workspace.js', 'utf8');
function setup(overrides = {}) {
  const dom = new JSDOM('<div id="kot_table_details"><div class="kot-item"><button class="kot-modify-btn" data-sale-id="sale"></button><button class="kot-serve-all"></button></div></div>', {url:'https://shop.invalid',runScripts:'outside-only'});
  const w = dom.window;
  w.$ = require('jquery')(w);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const calls = [];
  w.PosnicPro = {escapeHtml: s => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),i18n:{t:(_,s)=>s},local:{get:()=> 'branch'},alert:(_type,message)=>calls.push({error:message}),kot:{editLine:line=>({...line}),currentTableNumber:'6',loadTableDetails:()=>{},loadTables:()=>{}}, ...overrides};
  for (const method of ['get','post','put']) if (!w.PosnicPro[method]) w.PosnicPro[method] = (options,done) => {calls.push({method,...options,body:typeof options.data==='string'?JSON.parse(options.data):options.data});done({type:'success',data:{}});};
  w.eval(source);
  return {dom,w,calls,app:w.PosnicPro.kotWorkspace};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));
test('individual serving uses the exact KOT round line and absolute quantity; held items fire separately',async()=>{
  const {dom,w,calls,app}=setup();
  app.mount({_id:'sale',restaurant_details:{rounds:[{items:[{id:'c0i0',name:'Tea',quantity:2,served:1,remaining:1},{id:'c1i0',name:'Tea',quantity:3,served:0,remaining:3,held:true}]}]}});
  const buttons=[...w.document.querySelectorAll('.kot-workspace-line button')];
  buttons[0].click();buttons[0].click();await flush();
  assert.equal(calls.length,1);assert.deepEqual(calls[0].body.items,[{id:'c0i0',quantity:2}]);
  buttons[1].click();await flush();assert.equal(calls[1].url,'sales/fireKitchenItems');assert.deepEqual(calls[1].body.items,['c1i0']);
  dom.window.close();
});
test('notes preserve line identity, modifiers, allergies, prices and observed revision',async()=>{
  const sale={_id:'sale',updated_date:'2026-10-05T06:00:00Z',items:[{line_id:'line-one',item_name:'Tea <img src=x>',price:10,modifiers:[{id:'sugar'}],allergies:['milk'],item_quantity:2}],extra_discount:5,extra_discount_type:'percent'};
  const {dom,w,calls,app}=setup({get:(_o,done)=>done({type:'success',data:sale})});
  await app.notes('sale');
  assert.equal(w.document.querySelector('dialog img'),null);
  w.document.querySelector('[name=note0]').value='No sugar';
  w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  const saved=calls[0].body;assert.equal(saved.seen_at,sale.updated_date);assert.equal(saved.items[0].line_id,'line-one');assert.deepEqual(saved.items[0].allergies,['milk']);assert.equal(saved.items[0].item_description,'No sugar');assert.equal(saved.extra_discount,5);assert.equal('person_count' in saved,false);
  dom.window.close();
});
test('payment controls remain absent when collection is not enabled',async()=>{
  const {dom,w,app}=setup();w.CaptainPayments={available:async()=>false};
  app.mount({_id:'sale',table_number:'6'});await flush();
  assert.doesNotMatch(w.document.body.textContent,/Split payment|Collect payment/);dom.window.close();
});
test('a failed service request retains controls and surfaces the server error',async()=>{
  const {dom,w,calls,app}=setup({post:(_o,done)=>done({type:'error',message:'Order changed'})});
  app.mount({_id:'sale',restaurant_details:{rounds:[{items:[{id:'c0i0',name:'Tea',quantity:1,served:0,remaining:1}]}]}});
  const button=w.document.querySelector('.kot-workspace-line button');button.click();await flush();assert.equal(button.disabled,false);assert.equal(calls[0].error,'Order changed');dom.window.close();
});

test('a table move retries the same durable request after an uncertain completion',async()=>{
  const moves=[];let attempts=0;
  const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url.includes('tables')?{tables:[{id:'destination',tableorder_value:'7',status:'available'}]}:{_id:'sale',person_count:5,dine_type:'Dine-in'}}),post:(o,done,fail)=>{
    moves.push({url:o.url,body:JSON.parse(o.data)});
    if(o.url.endsWith('/complete') && attempts++===0)fail({responseJSON:{message:'Connection interrupted'}});else done({type:'success',data:{}});
  }});
  await app.move('sale');w.document.querySelector('[name=table]').value='destination';
  const submit=()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  submit();await flush();assert.equal(w.localStorage.length,1);assert.match(w.document.querySelector('[role=alert]').textContent,/Connection interrupted/);
  submit();await flush();assert.equal(moves.length,3);assert.equal(moves[0].body.request_id,moves[2].body.request_id);assert.equal(moves[0].body.guests,5);assert.equal(w.localStorage.length,0);dom.window.close();
});

test('transfer is read-only until the reviewed amounts are confirmed',async()=>{
  const requests=[];
  const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url.includes('tables')?{canMerge:true,tables:[{id:'destination',tableorder_value:'7',status:'available'}]}:{_id:'sale',restaurant_details:{rounds:[{items:[{id:'c0i0',name:'Tea',quantity:2,served:0}]}]}}}),post:(o,done)=>{
    requests.push({url:o.url,body:JSON.parse(o.data)});done({type:'success',data:{revision:'rev',currencySymbol:'₹',currencyDigits:2,source:{totalMinor:1000},destination:{totalMinor:1000}}});
  }});
  await app.transfer('sale');w.document.querySelector('[name=table]').value='destination';w.document.querySelector('[name=qty0]').value='1';
  const submit=()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  submit();await flush();assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/preview'));assert.equal(w.localStorage.length,0);
  assert.match(w.document.querySelector('dialog').textContent,/₹10\.00/);
  submit();await flush();assert.ok(requests[1].url.endsWith('/complete'));assert.equal(requests[1].body.revision,'rev');assert.deepEqual(requests[1].body.items,[{id:'c0i0',quantity:1,servedQuantity:0}]);assert.equal(w.localStorage.length,0);dom.window.close();
});

test('merge registers a legacy custom source in the current branch only after Save',async()=>{
 const writes=[];
 const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url.includes('tables')?{canMerge:true,tables:[{id:'dest',tableorder_value:'T1',orders:[{id:'target',paid:false}]}]}:{_id:'source',table_number:'66',person_count:6,dine_type:'Dine-in'}}),post:(o,done)=>{writes.push({url:o.url,body:JSON.parse(o.data)});done({type:'success',data:{}});}});
 await app.move('source',true);assert.equal(writes.length,0);w.document.querySelector('[name=table]').value='dest';w.document.querySelector('[name=table]').dispatchEvent(new w.Event('change'));w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(writes[0].url,'captain/v1/tables/temporary');assert.deepEqual(writes[0].body,{branchId:'branch',tableorder_value:'66'});assert.equal(writes[1].url,'captain/v1/tables/merge/prepare');assert.equal(writes[1].body.targetOrderId,'target');assert.equal(writes[2].url,'captain/v1/tables/move/complete');dom.window.close();
});

test('move offers custom destination when floor is full and retries the same resolved table',async()=>{
 const writes=[];let fail=true;
 const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url.includes('tables')?{tables:[{id:'src',tableorder_value:'66',status:'occupied'}]}:{_id:'source',table_number:'66',person_count:2}}),post:(o,done,bad)=>{writes.push({url:o.url,body:JSON.parse(o.data)});if(o.url.endsWith('/complete')&&fail)bad({responseJSON:{message:'Offline'}});else done({type:'success',data:o.url.endsWith('/temporary')?{id:'custom-id'}:{}});}});
 await app.move('source');assert.equal(w.document.querySelector('select').value,'custom');assert.equal(writes.length,0);w.document.querySelector('[name=customTable]').value='a12';const submit=()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));submit();await flush();assert.equal(writes[0].body.tableorder_value,'A12');assert.equal(writes[1].body.primaryId,'custom-id');fail=false;submit();await flush();assert.equal(writes.filter(x=>x.url.endsWith('/temporary')).length,1);assert.equal(writes[2].body.request_id,writes[3].body.request_id);dom.window.close();
});

test('merge shows source and destination and includes unregistered custom orders without writes before confirmation',async()=>{
 const writes=[];
 const source={_id:'source',table_number:'66',person_count:2,dine_type:'Dine-in',items:[{item_quantity:7}]};
 const target={_id:'target',table_number:'33',person_count:3,dine_type:'Dine-in',items:[{item_quantity:1}]};
 const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url==='sales'?{list:[source,target],total:2}:o.url.includes('tables')?{canMerge:true,tables:[]}:source}),post:(o,done)=>{writes.push({url:o.url,body:JSON.parse(o.data)});done({type:'success',data:{id:'registered'}});}});
 await app.move('source',true);
 assert.match(w.document.querySelector('.kot-merge-source').textContent,/Table 66.*2 Guests.*7 Items/);
 assert.equal(w.document.querySelector('[type=submit]').disabled,true);
 const select=w.document.querySelector('select');select.value='legacy:target';select.dispatchEvent(new w.Event('change'));
 assert.match(w.document.querySelector('.kot-merge-preview').textContent,/Table 33.*3 Guests.*1 Items/);
 assert.match(w.document.querySelector('[type=submit]').textContent,/66 → 33/);
 assert.equal(writes.length,0);
 w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(writes[0].body.tableorder_value,'33');assert.equal(writes[2].body.targetOrderId,'target');assert.equal(writes[2].body.primaryId,'registered');dom.window.close();
});

test('merge empty state explains missing destinations and cannot submit',async()=>{
 const {dom,w,app}=setup({get:(o,done)=>done({type:'success',data:o.url==='sales'?{list:[]}:o.url.includes('tables')?{canMerge:true,tables:[]}:{_id:'source',table_number:'66'}})});
 await app.move('source',true);assert.match(w.document.querySelector('dialog').textContent,/No other open table orders/);assert.equal(w.document.querySelector('[type=submit]').disabled,true);dom.window.close();
});

test('saved merge can be retried when the target no longer appears in the current choices',async()=>{
 const {dom,w,calls,app}=setup({get:(o,done)=>done({type:'success',data:o.url==='sales'?{list:[]}:o.url.includes('tables')?{canMerge:true,tables:[]}:{_id:'source',table_number:'66'}})});
 const intent={request_id:'same-request',orderId:'source',primaryId:'destination',tableIds:['destination'],targetOrderId:'target'};
 w.localStorage.setItem('posnic.kot.merge:https://shop.invalid:branch:source',JSON.stringify(intent));
 await app.move('source',true);assert.equal(w.document.querySelector('[type=submit]').disabled,false);
 w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(calls[0].body.request_id,'same-request');assert.equal(calls[0].body.targetOrderId,'target');dom.window.close();
});
