"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
const create=require('../frontend/static/script/js/modules/js/invoice-payment-requests');
const script=fs.readFileSync('frontend/static/script/js/modules/js/invoice-payment-recovery.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(data=new Map(),language='_english'){
 const dom=new JSDOM('<div id="invoices_pay_strip"><input id="ie_pay_amount" value="25.00"><select id="ie_pay_method"><option>Cash</option></select><input id="ie_pay_reference" value="Original"><button id="ie_pay_confirm">Record</button></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,$=jquery(w);
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 Object.defineProperty(w,'localStorage',{value:storage});let tail=Promise.resolve();
 Object.defineProperty(w.navigator,'locks',{value:{request(_key,_options,fn){const work=tail.then(fn);tail=work.catch(()=>{});return work;}}});
 w.crypto.randomUUID=randomUUID;w.createInvoicePaymentRequests=create;w.$=$;
 const calls={posts:[],gets:[],alerts:[],refresh:[]},identity={user:'cashier'},dict=JSON.parse(fs.readFileSync('languages/'+language+'.json','utf8'));
 const invoice={_id:'invoice',license:'shop',branch_id:'branch'};
 w.PosnicPro={local:{get:()=>identity.user},i18n:{t:(key,fallback)=>dict[key]||fallback},ACLForModule:()=>{},alert:(...args)=>calls.alerts.push(args),
  post:(options,ok,fail)=>calls.posts.push({options,ok,fail}),get:(options,ok,fail)=>calls.gets.push({options,ok,fail}),
  invoices:{_current:invoice,payOpen:()=>{},showDetails:id=>calls.refresh.push(id),load:()=>{},loadSummary:()=>{}}};
 w.eval(script);
 return {dom,w,$,data,storage,calls,identity,invoice,app:w.PosnicPro.invoices,close:()=>dom.window.close()};
}
function saved(record,extra={}){return {type:'success',data:{state:'saved',commandId:record.commandId,releasePending:false,result:{status:true,data:{commandId:record.commandId,amount:25}},...extra}};}
test('response loss retains the request across reload; checking a saved result never sends another payment',async()=>{
 const f=setup();let g;try{
  await f.app.payConfirm();assert.equal(f.calls.posts.length,1);assert.equal(f.data.size,1);
  const request=JSON.parse(f.calls.posts[0].options.data);assert.equal(request.amount,'25.00');
  f.calls.posts[0].fail();await f.app.payConfirm();assert.equal(f.calls.posts.length,1);
  g=setup(f.data,'ar');g.app.paymentRecovery.reopen(g.invoice);
  assert.equal(g.$('#ie_pay_amount').prop('disabled'),true);assert.equal(g.calls.posts.length,0);
  g.$('#ie_payment_recovery button').first().trigger('click');
  assert.ok(g.calls.gets[0].options.url.endsWith(request.commandId));
  await g.calls.gets[0].ok(saved(request));await tick();
  assert.equal(g.data.size,0);assert.equal(g.calls.posts.length,0);assert.deepEqual(g.calls.refresh,['invoice']);
 }finally{f.close();g?.close();}
});
test('absent and pending states require an explicit unchanged retry or confirmed continuation',async()=>{
 const f=setup();try{
  await f.app.payConfirm();const original=f.calls.posts[0].options.data,request=JSON.parse(original);f.calls.posts[0].fail();
  f.$('#ie_payment_recovery button').first().trigger('click');await f.calls.gets[0].ok({type:'success',data:{state:'absent',commandId:request.commandId}});
  assert.equal(f.calls.posts.length,1);f.$('#ie_pay_amount').val('999');
  f.$('#ie_payment_recovery button').last().trigger('click');assert.equal(f.calls.posts[1].options.data,original);
  f.calls.posts[1].fail();f.$('#ie_payment_recovery button').first().trigger('click');
  await f.calls.gets[1].ok({type:'success',data:{state:'pending',commandId:request.commandId,canRecover:true}});
  assert.equal(f.calls.posts.length,2);f.$('#ie_payment_recovery button').last().trigger('click');
  assert.ok(f.calls.posts[2].options.url.endsWith('/recover'));assert.deepEqual(JSON.parse(f.calls.posts[2].options.data),{confirmed:true});
 }finally{f.close();}
});
test('permission holds and late responses cannot discard or expose another account request',async()=>{
 const f=setup();try{
  await f.app.payConfirm();const request=JSON.parse(f.calls.posts[0].options.data);f.calls.posts[0].fail();
  f.$('#ie_payment_recovery button').first().trigger('click');await f.calls.gets[0].ok({type:'success',data:{state:'pending',commandId:request.commandId,canRecover:false}});
  assert.equal(f.$('#ie_payment_recovery button').length,1);
  f.$('#ie_payment_recovery button').first().trigger('click');f.identity.user='another';
  await f.calls.gets[1].ok(saved(request));await tick();assert.equal(f.data.size,1);assert.equal(f.calls.refresh.length,0);
 }finally{f.close();}
});
test('unavailable storage blocks submission and success with pending release keeps evidence',async()=>{
 const f=setup(),g=setup();try{
  f.storage.setItem=()=>{throw Error('quota');};await f.app.payConfirm();assert.equal(f.calls.posts.length,0);
  await g.app.payConfirm();const request=JSON.parse(g.calls.posts[0].options.data);g.calls.posts[0].ok({type:'success'});
  await g.calls.gets[0].ok(saved(request,{releasePending:true,canRecover:true}));
  assert.equal(g.data.size,1);assert.equal(g.calls.posts.length,1);assert.equal(g.$('#ie_payment_recovery button').length,2);
 }finally{f.close();g.close();}
});

test('invalid and above-balance input does not retain or send a new request',async()=>{
 const f=setup();try{
  f.invoice.total=10;
  for(const value of ['25.00','0','-1','1e2']){f.$('#ie_pay_amount').val(value);await f.app.payConfirm();}
  assert.equal(f.data.size,0);assert.equal(f.calls.posts.length,0);assert.equal(f.calls.alerts.length,4);
 }finally{f.close();}
});

test('replacement waits for confirmed stop, survives a lost stop reply and never automatically pays',async()=>{
 const f=setup();try{
  await f.app.payConfirm();const original=JSON.parse(f.calls.posts[0].options.data);f.calls.posts[0].fail();
  f.$('#ie_payment_recovery button').first().trigger('click');
  await f.calls.gets[0].ok({type:'success',data:{state:'absent',commandId:original.commandId,canStop:true}});
  assert.equal(f.$('#ie_payment_recovery button').length,3);
  f.$('#ie_payment_recovery button').last().trigger('click');
  assert.ok(f.calls.posts[1].options.url.endsWith('/stop'));assert.deepEqual(JSON.parse(f.calls.posts[1].options.data),{confirmed:true});
  f.calls.posts[1].fail();assert.equal(f.data.size,1);assert.equal(f.calls.posts.length,2);
  f.$('#ie_payment_recovery button').first().trigger('click');
  await f.calls.gets[1].ok({type:'success',data:{state:'stopped',commandId:original.commandId,canReplace:true}});
  assert.equal(f.data.size,1);f.$('#ie_payment_recovery button').last().trigger('click');await tick();
  assert.equal(f.data.size,0);assert.equal(f.calls.posts.length,2);assert.deepEqual(f.calls.refresh,['invoice']);
  await f.app.payConfirm();assert.notEqual(JSON.parse(f.calls.posts[2].options.data).commandId,original.commandId);
 }finally{f.close();}
});
