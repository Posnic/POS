"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{JSDOM}=require('jsdom');
const createStore=require('../frontend/static/script/js/modules/js/customer-wallet-requests'),createView=require('../frontend/static/script/js/modules/js/customer-wallet-recovery');
const scope={licenseId:'shop',branchId:'branch',userId:'cashier',customerId:'customer'},input={kind:'add',amount:'25.00',type:'in',date:'2026-11-28'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(language='en'){
 const dom=new JSDOM('<main></main>'),container=dom.window.document.querySelector('main'),data=new Map();let tail=Promise.resolve(),active=scope;
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const locks={request(_key,_options,fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
 const store=createStore({storage,locks,randomUUID}),calls=[];let respond=async()=>{throw new Error('network');},saved=[];
 const view=createView({container,scope,store,currentScope:()=>active,language:()=>language,onSaved:value=>saved.push(value),request:(...args)=>{calls.push(args);return respond(...args);}});
 return {dom,container,data,store,calls,view,saved,setRespond:fn=>respond=fn,setScope:value=>active=value};
}
function result(record){return {type:'success',data:{state:'saved',commandId:record.commandId,kind:record.request.kind,request:record.request,balance:25,entryId:'abcdef0123456789abcdef01'}};}
test('lost reply retains the original, reopening is read-only, explicit check completes it',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);assert.ok(original);assert.equal(f.calls.length,1);
 f.view.reopen();assert.equal(f.calls.length,1);assert.equal(f.container.querySelector('[data-action=continue]'),null);
 await f.view.submit({...input,amount:'40'});assert.equal(f.calls.length,1);assert.deepEqual(f.store.load(scope),original);
 f.setRespond(async()=>result(original));await f.view.check();assert.equal(f.store.load(scope),null);assert.equal(f.saved.length,1);assert.match(f.container.textContent,/current balance/);f.dom.window.close();
});
test('pending permits only confirmed recovery without altered money',async()=>{
 const f=fixture('ar');await f.view.submit(input);const original=f.store.load(scope);
 f.setRespond(async(method,url,body)=>method==='GET'?{type:'success',data:{state:'pending',commandId:original.commandId,request:original.request}}:result(original));
 await f.view.check();assert.equal(f.container.dir,'rtl');f.container.querySelector('[data-action=continue]').click();await tick();await tick();
 assert.deepEqual(f.calls.at(-1),['POST','customers/customer/wallet-requests/'+original.commandId+'/recover',{confirmed:true}]);assert.equal(f.store.load(scope),null);f.dom.window.close();
});
test('absent permits unchanged retry and changed pending details remain held',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);
 f.setRespond(async()=>({type:'success',data:{state:'pending',commandId:original.commandId,request:{...original.request,amount:99}}}));await f.view.check();assert.equal(f.container.querySelector('[data-action=continue]'),null);
 f.setRespond(async(method)=>method==='GET'?{type:'success',data:{state:'absent',commandId:original.commandId}}:result(original));await f.view.check();f.container.querySelector('[data-action=continue]').click();await tick();await tick();
 assert.deepEqual(f.calls.at(-1)[2],{confirmed:true,request:original.request});assert.equal(f.store.load(scope),null);f.dom.window.close();
});
test('switching accounts ignores a late result and keeps the original',async()=>{
 const f=fixture();let resolve;f.setRespond(()=>new Promise(done=>resolve=done));const send=f.view.submit(input);await tick();const original=f.store.load(scope);
 f.setScope({...scope,userId:'another'});resolve(result(original));await send;
 assert.deepEqual(f.store.load(scope),original);assert.equal(f.saved.length,0);f.dom.window.close();
});
test('unreadable saved evidence never sends a request',async()=>{
 const f=fixture();await f.store.prepare(scope,input);for(const key of f.data.keys())f.data.set(key,'broken');f.view.reopen();await f.view.submit(input);assert.equal(f.calls.length,0);assert.match(f.container.textContent,/needs review/);f.dom.window.close();
});
