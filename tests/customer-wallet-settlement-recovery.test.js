'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{JSDOM}=require('jsdom');
const createStore=require('../frontend/static/script/js/modules/js/customer-wallet-settlements'),createView=require('../frontend/static/script/js/modules/js/customer-wallet-settlement-recovery');
const scope={licenseId:'shop',branchId:'branch',userId:'cashier',customerId:'customer'},input={sales:[{id:'abcdef0123456789abcdef01',amount:65,paidamount:40}]};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(language='en'){
 const dom=new JSDOM('<main></main>'),container=dom.window.document.querySelector('main'),data=new Map();let tail=Promise.resolve(),active=scope;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},locks={request(k,o,fn){const p=tail.then(fn);tail=p.catch(()=>{});return p;}};
 const store=createStore({storage,locks,randomUUID}),calls=[],completed=[];let response=async()=>{throw Error('network');},refreshes=0;
 const view=createView({container,scope,store,currentScope:()=>active,language:()=>language,onComplete:r=>completed.push(r),onRefresh:()=>refreshes++,request:(...args)=>{calls.push(args);return response(...args);},saleLabels:{[input.sales[0].id]:'S-1042 <script>no</script>'}});
 return {dom,container,store,view,calls,completed,data,refreshes:()=>refreshes,setScope:s=>active=s,setResponse:fn=>response=fn};
}
const saved=record=>({type:'success',data:{state:'saved',commandId:record.commandId,request:record.request,sales:record.request.sales.map(s=>s.id),balance:0}});
const pending=(record,phase)=>({type:'success',data:{state:'pending',commandId:record.commandId,request:record.request,phase}});
const click=async(f,name)=>{f.container.querySelector('[data-action='+name+']').click();await tick();await tick();};
test('lost reply and reopening retain the original; saved check refreshes only explicitly',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);assert.ok(original);assert.equal(f.calls.length,1);assert.equal(f.container.querySelector('script'),null);
 f.view.reopen();await f.view.submit({sales:[{...input.sales[0],amount:99}]});assert.equal(f.calls.length,1);assert.deepEqual(f.store.load(scope),original);
 f.setResponse(async()=>saved(original));await f.view.check();assert.equal(f.store.load(scope),null);assert.equal(f.completed.length,1);assert.equal(f.refreshes(),0);
 assert.match(f.container.textContent,/after this request: 0/);await click(f,'refresh');assert.equal(f.refreshes(),1);f.dom.window.close();
});
test('Arabic continuation uses only the original ID and confirmation',async()=>{
 const f=fixture('ar');await f.view.submit(input);const original=f.store.load(scope);
 f.setResponse(async method=>method==='GET'?pending(original,'applying'):saved(original));await f.view.check();assert.equal(f.container.dir,'rtl');assert.equal(f.container.querySelector('[data-action=stop]'),null);
 await click(f,'continue');assert.deepEqual(f.calls.at(-1),['POST','customers/customer/wallet-settlements/'+original.commandId+'/recover',{confirmed:true}]);assert.equal(f.store.load(scope),null);f.dom.window.close();
});
test('stop requires confirmation and a racing reservation keeps the original',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);f.setResponse(async()=>pending(original,'prepared'));await f.view.check();const count=f.calls.length;
 await click(f,'stop');assert.equal(f.calls.length,count);await click(f,'keep');assert.equal(f.calls.length,count);
 await click(f,'stop');f.setResponse(async()=>({type:'error',data:null}));await click(f,'confirm-stop');assert.deepEqual(f.calls.at(-1)[2],{confirmed:true});assert.deepEqual(f.store.load(scope),original);
 f.setResponse(async()=>pending(original,'reserving'));await f.view.check();assert.equal(f.container.querySelector('[data-action=stop]'),null);assert.ok(f.container.querySelector('[data-action=continue]'));f.dom.window.close();
});
test('confirmed stop permits refresh; absent permits only unchanged retry',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);f.setResponse(async()=>pending(original,'prepared'));await f.view.check();await click(f,'stop');
 f.setResponse(async()=>({type:'success',data:{state:'stopped',commandId:original.commandId,canReplace:true}}));await click(f,'confirm-stop');assert.equal(f.store.load(scope),null);assert.match(f.container.textContent,/Request stopped/);
 f.setResponse(async()=>{throw Error('offline');});await f.view.submit(input);const next=f.store.load(scope);
 f.setResponse(async method=>method==='GET'?{type:'success',data:{state:'absent',commandId:next.commandId}}:saved(next));await f.view.check();await click(f,'continue');assert.deepEqual(f.calls.at(-1)[2],{confirmed:true,request:next.request});f.dom.window.close();
});
test('changed evidence, account switch and malformed storage never discard the original',async()=>{
 const f=fixture();await f.view.submit(input);const original=f.store.load(scope);
 f.setResponse(async()=>({...pending(original,'prepared'),data:{...pending(original,'prepared').data,request:{sales:[]}}}));await f.view.check();assert.equal(f.container.querySelector('[data-action=continue]'),null);
 let resolve;f.setResponse(()=>new Promise(done=>resolve=done));const check=f.view.check();await tick();f.setScope({...scope,branchId:'other'});resolve(saved(original));await check;assert.deepEqual(f.store.load(scope),original);assert.equal(f.completed.length,0);
 f.setScope(scope);for(const key of f.data.keys())f.data.set(key,'invalid');const count=f.calls.length;f.view.reopen();await f.view.submit(input);assert.equal(f.calls.length,count);f.dom.window.close();
});
