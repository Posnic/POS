const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const source=fs.readFileSync('frontend/static/script/js/modules/js/kot_v2.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="v-pills-dashboard"></div><div id="kot" class="page_loader"></div>',{url:'http://localhost/#/kot_v2',runScripts:'outside-only'}),w=dom.window;
 w.$=require('jquery')(w);w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const calls=[],effects=[],errors=[];
 const sale={_id:'a'.repeat(24),table_number:'6',dine_type:'Dine-in',person_count:2,updated_date:'2026-10-05T06:00:00Z',created_date:'2026-10-05T06:00:00Z',payment_status:'Unpaid',sale_process:'KOT',sales_total:60,items:[{item_id:'tea',line_id:'original',item_name:'Tea',item_quantity:2,item_price:30}],restaurant_details:{rounds:[{id:'c0',items:[{id:'c0i0',line_key:'original',product:'tea',name:'Tea',quantity:2,served:0,remaining:2}]}]}};
 let search;
 w.PosnicPro={i18n:{t:(_,fallback)=>fallback},local:{get:k=>({table_options:'enable',branch_id_set:'b',username:'owner',currencySign:'₹'}[k])},escapeHtml:s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),HideSideBarModal(){},alert:(_,m)=>errors.push(m),restaurantFeedback:{apply(){},load(){},play:k=>effects.push(k)},kot:{bindProductSearch:(_,callback)=>search=callback,editLine:(l,q)=>({product_id:l.item_id,line_id:l.line_id,quantity:q??l.item_quantity,price:l.item_price}),},kotWorkspace:{editPayload:(s,items)=>({order_id:s._id,items,seen_at:s.updated_date})}};
 for(const method of ['get','post','put'])w.PosnicPro[method]=(o,done,fail)=>{const body=typeof o.data==='string'?JSON.parse(o.data):o.data;calls.push({method,url:o.url,body});if(setup.failure&&method==='post'){fail({responseJSON:setup.failureResponse||{message:'Offline'}});return;}let data={};if(o.url==='captain/v1/tables')data={tables:[{id:'t6',tableorder_value:'6',status:'occupied',orders:[{id:sale._id}]},{id:'t7',tableorder_value:'7',status:'available',orders:[]}]};else if(o.url==='sales')data={list:sale.payment_status==='Paid'?[]:[sale],total:1};else if(o.url==='sales/'+sale._id)data=JSON.parse(JSON.stringify(sale));else if(o.url==='items/instantItemTax')data={id:'tax',rate:5,name:'GST'};else if(o.url==='items/instanceItemInsert')data={id:'instant',selling_price:25};done({type:'success',data});};
 w.eval(source);const app=w.PosnicPro.kot_v2;
 const click=async a=>{w.document.querySelector('[data-action="'+a+'"]').click();await flush();};
 return {dom,w,app,calls,effects,errors,sale,click,search:()=>search,close:()=>dom.window.close()};
}
test('add again stays in a durable draft, preserves original quantity, sends one additional line',async()=>{const h=setup();h.app.state.selected=h.sale._id;h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('again');h.w.document.querySelector('dialog form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.calls.filter(c=>c.method==='post').length,0);assert.equal(h.sale.items[0].item_quantity,2);assert.equal(h.app.state.draft.items[0].quantity,1);assert.notEqual(h.app.state.draft.items[0].line_id,'original');assert.ok(h.w.localStorage.length);await h.click('send');const sent=h.calls.find(c=>c.url==='sales/updateOrder');assert.equal(sent.body.items.length,2);assert.equal(sent.body.items[0].quantity,2);assert.equal(sent.body.items[1].quantity,1);assert.deepEqual(h.effects,['first','sent']);assert.equal(h.app.state.draft,null);h.close();});
test('off-menu creation does not submit a kitchen ticket',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();assert.equal(h.w.document.querySelector('[data-action=offmenu]'),null);await h.click('add');assert.ok(h.w.document.querySelector('.kv2-search-row [data-action=offmenu]'));await h.click('offmenu');h.w.document.querySelector('[name=name]').value='Soup';h.w.document.querySelector('[name=price]').value='25';h.w.document.querySelector('dialog form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.app.state.draft.items[0].name,'Soup');assert.equal(h.calls.filter(c=>c.url==='sales/updateOrder'||c.url==='sales/qrOrder').length,0);const payload=h.calls.find(c=>c.url==='items/instanceItemInsert').body;assert.equal(payload.quick_sale_default_tax,true);assert.equal(payload.quick_sale_tax.rate,5);h.close();});
test('failed send retains immutable request and has no success animation',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});setup.failure=true;await h.click('send');const saved=JSON.stringify(h.app.state.draft.intent);await h.click('send');assert.equal(JSON.stringify(h.app.state.draft.intent),saved);assert.equal(h.effects.includes('sent'),false);assert.equal(h.errors.length,2);setup.failure=false;h.close();});
test('serving a portion targets the exact round without opening confirmation',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('serve');assert.equal(h.w.document.querySelector('dialog'),null);assert.deepEqual(h.calls.find(c=>c.url==='sales/serveKitchenItems').body.items,[{id:'c0i0',quantity:1}]);h.close();});
test('settled order is cleared after refresh and active filter is first',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();h.sale.payment_status='Paid';await h.app.refresh();assert.equal(h.app.state.selected,null);assert.equal(h.app.state.sale,null);assert.equal(h.w.document.querySelector('.kv2-floor nav button').textContent,'Active');h.close();});
test('floor query includes partial payments until fully settled',async()=>{const h=setup();h.sale.payment_status='Pending';h.app.showDataTablePage();await flush();const filters=JSON.parse(h.calls.find(c=>c.url==='sales').body.filters);assert.deepEqual(filters.payment_status,{$nin:['Paid','Cancelled']});assert.equal(h.app.state.sales.length,1);h.close();});
test('customer changes during an additional round persist on its saved order',async()=>{const h=setup();h.w.$.fn.autocomplete=function(){return this;};h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');await h.click('customer');h.w.document.querySelector('[data-customer-mode=new]').click();h.w.document.querySelector('[name=name]').value='Guest';h.w.document.querySelector('[name=phone]').value='9876543210';h.w.document.querySelector('dialog form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();const saved=h.calls.find(c=>c.url==='sales/orderCustomer');assert.equal(saved.body.saleId,h.sale._id);assert.equal(saved.body.name,'Guest');assert.equal(h.app.state.draft.customer.name,'Guest');assert.equal(h.calls.some(c=>c.url==='sales/updateOrder'),false);h.close();});
test('empty orders offer a table picker with distinct available and occupied choices',async()=>{const h=setup();h.sale.payment_status='Paid';h.app.showDataTablePage();await flush();assert.match(h.w.document.querySelector('.kv2-welcome').textContent,/No active orders/);await h.click('new');const d=h.w.document.querySelector('.kv2-seating-dialog');assert.equal(d.querySelector('[name=table]').value,'t7');assert.equal(d.querySelector('[value=t6]').disabled,true);d.querySelector('[data-guests="6"]').click();assert.equal(d.querySelector('[name=guests]').value,'6');assert.equal(d.querySelector('[data-guests="6"]').getAttribute('aria-pressed'),'true');const input=d.querySelector('[name=guests]');input.value='3';input.dispatchEvent(new h.w.Event('input'));assert.equal(d.querySelector('[data-guests="3"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-guests="6"]').getAttribute('aria-pressed'),'false');assert.equal(h.calls.filter(c=>c.method==='post').length,0);h.close();});
test('catalogue selection reviews quantity and notes before adding to the unsent round',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();h.app.state.catalogueLoaded=true;h.app.state.catalogue=[{item_id:'tea',item_name:'Tea',selling_price:30}];await h.click('add');await h.click('pick');const d=h.w.document.querySelector('.kv2-product-dialog');assert.ok(d);d.querySelector('[name=qty]').value='3';d.querySelector('[name=note]').value='Less sugar';d.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.app.state.draft.items[0].quantity,3);assert.equal(h.app.state.draft.items[0].item_description,'Less sugar');assert.equal(h.calls.some(c=>c.url==='sales/updateOrder'||c.url==='sales/qrOrder'),false);h.close();});
test('zero-price catalogue items request a price before they enter the draft',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();h.app.state.catalogueLoaded=true;h.app.state.catalogue=[{item_id:'special',item_name:'Special',selling_price:0}];await h.click('add');await h.click('pick');const d=h.w.document.querySelector('.kv2-product-dialog');assert.equal(h.w.document.activeElement.name,'price');d.querySelector('[name=price]').value='125';d.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.app.state.draft.items[0].price,125);assert.equal(h.calls.some(c=>c.url==='sales/updateOrder'||c.url==='sales/qrOrder'),false);h.close();});

test('confirmed price rejection unlocks the draft so an item can be removed',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});setup.failure=true;setup.failureResponse={message:'Price changed',data:{state:'item_price_mismatch',expected_price:12}};try{await h.click('send');assert.equal(h.app.state.draft.intent,undefined);assert.equal(h.app.state.draft.items.length,1);await h.click('removeDraft');assert.equal(h.app.state.draft.items.length,0);assert.equal(h.effects.includes('sent'),false);}finally{setup.failure=false;setup.failureResponse=null;h.close();}});
test('revisiting with a saved draft opens its review without losing the round',async()=>{const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});h.app.showDataTablePage();await flush();assert.equal(h.app.state.expanded,false);assert.equal(h.app.state.filter,'active');assert.equal(h.app.state.sales.length,1);assert.equal(h.app.state.draft.items.length,1);await h.click('expand');assert.equal(h.app.state.expanded,true);assert.equal(h.app.state.draft.items.length,1);h.close();});

test('refresh gives immediate busy feedback, prevents repeat clicks and confirms only successful loads',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();
 const original=h.w.PosnicPro.get;let finish,fail,requests=0;
 h.w.PosnicPro.get=(o,done,reject)=>{if(o.url==='captain/v1/tables'){requests++;finish=()=>original(o,done,reject);fail=()=>reject({responseJSON:{message:'Offline'}});}else original(o,done,reject);};
 const button=()=>h.w.document.querySelector('[data-action=refresh]');
 button().click();assert.equal(button().dataset.feedback,'loading');assert.equal(button().disabled,true);button().click();assert.equal(requests,1);
 finish();await flush();assert.equal(button().dataset.feedback,'success');assert.equal(button().disabled,false);assert.equal(button().getAttribute('aria-busy'),'false');
 button().click();fail();await flush();assert.equal(button().dataset.feedback,'error');assert.equal(button().disabled,false);assert.ok(h.errors.includes('Offline'));h.close();
});

test('serve shows immediate pending feedback, confirms the portion and restores retry after failure',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();
 const post=h.w.PosnicPro.post;let done,fail,count=0;h.w.PosnicPro.post=(o,success,reject)=>{count++;done=()=>{const line=h.sale.restaurant_details.rounds[0].items[0];line.served=1;line.remaining=1;post(o,success,reject);};fail=()=>reject({responseJSON:{message:'Offline'}});};
 const button=()=>h.w.document.querySelector('[data-action=serve]');button().click();assert.equal(button().disabled,true);assert.equal(button().getAttribute('aria-busy'),'true');assert.ok(button().classList.contains('kv2-serving'));button().click();assert.equal(count,1);
 done();await flush();assert.match(button().textContent,/1\/2/);assert.ok(button().classList.contains('kv2-serve-saved'));assert.equal(button().disabled,false);
 button().click();fail();await flush();assert.equal(button().disabled,false);assert.equal(button().getAttribute('aria-busy'),null);assert.match(button().textContent,/1\/2/);assert.equal(h.w.document.querySelector('.kv2-serving'),null);h.close();
});

test('takeaway card uses its short number and elapsed minutes advance without rebuilding the order',async()=>{
 const h=setup();h.sale.dine_type='Take away';h.sale.token_id='8';h.sale.takeaway_number=8;h.sale.sales_id='S-LONG-00008';h.sale.created_date=new Date(Date.now()-14*60000).toISOString();h.app.showDataTablePage();await flush();
 const root=h.w.document.querySelector('#kot_v2');Object.defineProperty(root,'offsetParent',{get:()=>h.w.document.body});Object.defineProperty(h.w.document,'hidden',{get:()=>false});
 const card=root.querySelector('[data-table^="takeaway-"]');assert.match(card.textContent,/Takeaway 8/);assert.doesNotMatch(card.textContent,/S-LONG/);const before=root.innerHTML;const now=h.w.Date.now;
 h.w.Date.now=()=>now()+2*60000;h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));assert.match(card.querySelector('[data-elapsed]').textContent,/16 min/);assert.equal(card.dataset.age,'waiting');assert.equal(root.querySelector('[data-table^="takeaway-"]'),card);
 h.w.Date.now=()=>now()+17*60000;h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));assert.equal(card.dataset.age,'late');h.close();
});

test('draft table selection resumes the same round without an error or send',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});const draft=h.app.state.draft;await h.click('expand');await h.click('table');assert.equal(h.app.state.expanded,false);assert.equal(h.app.state.draft,draft);assert.equal(h.errors.length,0);assert.equal(h.calls.some(c=>c.method==='post'),false);h.close();
});
test('changing tables offers review or explicit discard and preserves uncertain sends',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});
 const other=async()=>{h.app.state.filter='all';h.app.state.expanded=false;await h.click('expand');h.w.document.querySelector('[data-table="t7"]').click();await flush();};
 await other();let d=h.w.document.querySelector('dialog');assert.match(d.textContent,/Naan/);d.querySelector('[type=submit]').click();await flush();assert.equal(h.app.state.expanded,false);assert.equal(h.app.state.draft.items.length,1);
 h.app.state.draft.intent={key:'pending'};await other();d=h.w.document.querySelector('dialog');assert.doesNotMatch(d.querySelector('footer').textContent,/Discard/);d.querySelector('[data-close]').click();delete h.app.state.draft.intent;
 await other();d=h.w.document.querySelector('dialog');Array.from(d.querySelectorAll('button')).find(b=>b.textContent==='Discard draft').click();await flush();assert.equal(h.app.state.draft,null);assert.ok(h.w.document.querySelector('.kv2-seating-dialog'));assert.equal(h.calls.some(c=>c.method==='post'),false);h.close();
});
test('an empty draft does not block a different table',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();h.app.state.selected=h.sale._id;await h.app.refresh();await h.click('add');h.app.state.filter='all';await h.click('expand');h.w.document.querySelector('[data-table="t7"]').click();await flush();assert.equal(h.app.state.draft,null);assert.ok(h.w.document.querySelector('.kv2-seating-dialog'));assert.equal(h.errors.length,0);h.close();
});

test('opening table orders waits for an explicit table selection',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();assert.equal(h.app.state.selected,null);assert.equal(h.app.state.sale,null);assert.ok(h.w.document.querySelector('.kv2-welcome'));await h.click('table');assert.equal(h.app.state.selected,h.sale._id);assert.ok(h.w.document.querySelector('[data-action=add]'));h.close();
});

test('sad chef plays only after a successful order cancellation',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');
 const cancel=async()=>{await h.click('actions');h.w.document.querySelector('[data-action=cancel]').click();await flush();const d=h.w.document.querySelector('dialog');d.querySelector('[name=reason]').value='Duplicate order';d.querySelector('[type=submit]').click();await flush();};
 setup.failure=true;try{await cancel();assert.equal(h.effects.includes('cancelled'),false);h.w.document.querySelector('dialog [data-close]').click();}finally{setup.failure=false;}
 await cancel();assert.equal(h.effects.filter(e=>e==='cancelled').length,1);assert.equal(h.calls.filter(c=>c.url==='sales/updateOrder').at(-1).body.status,'cancelled');h.close();
});

test('confirmed order conflict unlocks and reconciles the draft instead of trapping saved retries',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});const key=h.app.state.draft.key;
 setup.failure=true;setup.failureResponse={message:'order_changed'};try{await h.click('send');assert.equal(h.app.state.draft.intent,undefined);assert.notEqual(h.app.state.draft.key,key);assert.equal(h.app.state.draft.items.length,1);assert.equal(h.effects.includes('sent'),false);await h.click('removeDraft');assert.equal(h.app.state.draft.items.length,0);}finally{setup.failure=false;setup.failureResponse=null;h.close();}
});

test('customer entry waits for pending-send recovery and opens automatically after rejection is reconciled',async()=>{
 const h=setup();h.w.$.fn.autocomplete=function(){return this;};h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});h.app.state.draft.intent={url:'sales/updateOrder',body:{}};
 await h.click('customer');assert.equal(h.w.document.querySelector('[name=phone]'),null);assert.match(h.w.document.querySelector('dialog').textContent,/previous submission/);
 setup.failure=true;setup.failureResponse={message:'order_changed'};try{h.w.document.querySelector('dialog [type=submit]').click();await flush();assert.ok(h.w.document.querySelector('[name=phone]'));assert.equal(h.app.state.draft.items.length,1);assert.equal(h.app.state.draft.intent,undefined);}finally{setup.failure=false;setup.failureResponse=null;h.close();}
});


test('occupied-table refusal unlocks both new and restored sends so Cancel exits without another write',async()=>{
 for(const restored of [false,true]){
  const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});
  const d=h.app.state.draft;delete d.saleId;d.table='6';d.dineType='Dine-in';const key=d.key;
  if(restored)d.intent={url:'sales/qrOrder',body:{idempotencyKey:key}};
  setup.failure=true;setup.failureResponse={message:'Table 6 already has an open order. Add to it, or settle it first.'};
  try{await h.click('send');assert.equal(d.intent,undefined);assert.notEqual(d.key,key);assert.equal(d.items.length,1);assert.equal(h.effects.includes('sent'),false);const writes=h.calls.filter(c=>c.method==='post').length;await h.click('discard');assert.equal(h.app.state.draft,null);assert.equal(h.calls.filter(c=>c.method==='post').length,writes);}finally{setup.failure=false;setup.failureResponse=null;h.close();}
 }
});

test('Cancel recovery closes after an occupied-table rejection and allows leaving the retained draft',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});
 const d=h.app.state.draft;delete d.saleId;d.table='6';d.intent={url:'sales/qrOrder',body:{idempotencyKey:d.key}};
 setup.failure=true;setup.failureResponse={message:'Table 6 already has an open order. Add to it, or settle it first.'};
 try{await h.click('discard');h.w.document.querySelector('dialog[open] [type=submit]').click();await flush();assert.equal(h.w.document.querySelector('dialog[open]'),null);assert.equal(d.intent,undefined);await h.click('discard');assert.equal(h.app.state.draft,null);}finally{setup.failure=false;setup.failureResponse=null;h.close();}
});


test('off-menu entry checks a saved send before collecting fields or creating a product',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});
 h.app.state.draft.intent={url:'sales/updateOrder',body:{}};
 await h.click('offmenu');assert.equal(h.w.document.querySelector('dialog[open] [name=price]'),null);assert.match(h.w.document.querySelector('dialog[open]').textContent,/previous submission/);assert.equal(h.calls.some(c=>c.url==='items/instanceItemInsert'),false);
 setup.failure=true;setup.failureResponse={message:'order_changed'};
 try{h.w.document.querySelector('dialog[open] [type=submit]').click();await flush();assert.equal(h.app.state.draft.intent,undefined);setup.failure=false;await h.click('offmenu');h.w.document.querySelector('dialog[open] [name=name]').value='Soup';h.w.document.querySelector('dialog[open] [name=price]').value='25';h.w.document.querySelector('dialog[open] form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();assert.equal(h.app.state.draft.items.length,2);assert.equal(h.calls.filter(c=>c.url==='items/instanceItemInsert').length,1);assert.equal(h.w.document.querySelector('dialog[open]'),null);}finally{setup.failure=false;setup.failureResponse=null;h.close();}
});

test('actions opens an anchored icon list and Escape restores trigger focus',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('actions');const menu=h.w.document.querySelector('#kv2-actions-menu');assert.ok(menu);assert.equal(h.w.document.querySelector('dialog'),null);assert.equal(menu.querySelectorAll('button svg').length,5);assert.ok(menu.querySelector('[data-action=cancel].kv2-danger'));menu.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(h.w.document.activeElement.dataset.action,'guests');menu.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.w.document.querySelector('#kv2-actions-menu'),null);assert.equal(h.w.document.activeElement.dataset.action,'actions');h.close();
});

test('kitchen payment success dismisses the receipt in favour of a message and animation',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();
 Object.defineProperty(h.w.document.querySelector('#kot_v2'),'offsetParent',{get:()=>h.w.document.body});
 const event=new h.w.CustomEvent('captain:payment-recorded',{cancelable:true,detail:{message:'Payment recorded · Change to return: ₹20.00'}});
 assert.equal(h.w.dispatchEvent(event),false);await flush();
 assert.ok(h.errors.includes('Payment recorded · Change to return: ₹20.00'));assert.ok(h.effects.includes('payment'));h.close();
});

test('confirmed payment leaves a persistent success state until the cashier chooses a table',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');
 Object.defineProperty(h.w.document.querySelector('#kot_v2'),'offsetParent',{get:()=>h.w.document.body});
 h.w.dispatchEvent(new h.w.CustomEvent('captain:payment-recorded',{cancelable:true,detail:{remaining:0,message:'Payment recorded'}}));await flush();
 for(let i=0;i<2;i++){
  await h.app.refresh();assert.equal(h.app.state.selected,null);assert.equal(h.app.state.sale,null);
  assert.match(h.w.document.querySelector('.kv2-welcome').textContent,/Table 6.*Payment recorded/);
  assert.equal(h.w.document.querySelector('[data-action=pay]'),null);
 }
 assert.equal(h.app.state.sales.length,1);await h.click('table');assert.equal(h.app.state.selected,h.sale._id);assert.equal(h.app.state.paymentMessage,'');assert.ok(h.w.document.querySelector('[data-action=pay]'));h.close();
});

test('custom names cannot bypass occupied-table checks before choosing dishes',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('new');
 const modal=h.w.document.querySelector('dialog');modal.querySelector('[name=custom]').value='6';modal.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
 assert.equal(h.app.state.draft,null);assert.match(modal.querySelector('[role=alert]').textContent,/no longer available/);assert.equal(h.calls.some(c=>c.method==='post'),false);h.close();
});

test('a refused occupied table can be changed without losing draft items, notes or customer',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('table');await h.click('add');h.search()({item_id:'new',selling_price:10,item_name:'Naan'},1,()=>{});
 const d=h.app.state.draft;d.saleId=null;d.table='6';d.guests=3;d.dineType='Dine-in';d.items[0].item_description='No onion';d.customer={name:'Guest',phone:'123'};
 setup.failure=true;setup.failureResponse={message:'Table 6 already has an open order. Add to it, or settle it first.'};
 try{await h.click('send');assert.equal(d.intent,undefined);assert.ok(h.w.document.querySelector('[data-action=changeDraftTable]'));}finally{setup.failure=false;setup.failureResponse=null;}
 const priorKey=d.key;await h.click('changeDraftTable');const modal=h.w.document.querySelector('dialog');assert.equal(modal.querySelector('[name=guests]').value,'3');modal.querySelector('[value=t7]').checked=true;modal.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
 assert.equal(h.app.state.draft,d);assert.equal(d.table,'7');assert.equal(d.tableId,'t7');assert.equal(d.items[0].item_description,'No onion');assert.equal(d.customer.name,'Guest');assert.equal(d.guests,3);assert.notEqual(d.key,priorKey);assert.equal(d.tableConflict,undefined);assert.equal(h.calls.filter(c=>c.method==='post').length,1);h.close();
});

test('table availability is checked again if another device takes it while the picker is open',async()=>{
 const h=setup();h.app.showDataTablePage();await flush();await h.click('new');
 const original=h.w.PosnicPro.get;h.w.PosnicPro.get=(options,done,fail)=>original(options,result=>{if(options.url==='captain/v1/tables')result.data.tables.find(t=>t.id==='t7').status='occupied';done(result);},fail);
 const modal=h.w.document.querySelector('dialog');modal.querySelector('[value=t7]').checked=true;modal.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
 assert.equal(h.app.state.draft,null);assert.match(modal.querySelector('[role=alert]').textContent,/no longer available/);assert.equal(h.calls.some(c=>c.method==='post'),false);h.close();
});

test('customer chooser separates search, new details and walk-in with explicit actions',async()=>{
 const h=setup();let searchConfig;h.w.$.fn.autocomplete=function(config){searchConfig=config;return this;};h.app.showDataTablePage();await flush();await h.click('table');await h.click('customer');
 const modal=h.w.document.querySelector('dialog'),submit=modal.querySelector('[type=submit]');
 assert.equal(modal.querySelector('[data-customer-panel=new]').hidden,true);assert.equal(submit.disabled,true);
 searchConfig.onSelect({data:{id:'person',name:'Anita',phone:'123'}});assert.equal(submit.disabled,false);assert.equal(submit.textContent,'Use this customer');assert.match(modal.querySelector('[data-selected-customer]').textContent,/Anita/);
 modal.querySelector('#kv2-customer-search').dispatchEvent(new h.w.Event('input'));assert.equal(submit.disabled,true);
 modal.querySelector('[data-customer-mode=new]').click();assert.equal(modal.querySelector('[data-customer-panel=new]').hidden,false);assert.equal(submit.textContent,'Add to order');
 modal.querySelector('[data-customer-mode=walkin]').click();assert.equal(submit.textContent,'Use walk-in customer');modal.querySelector('form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
 const saved=h.calls.find(c=>c.url==='sales/orderCustomer').body;assert.equal(saved.customerId,undefined);assert.equal(saved.name,'');assert.equal(saved.phone,'');h.close();
});
