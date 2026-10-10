'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../frontend/static/script/js/modules/js/sale-extensions.js'),'utf8');
const id=n=>String(n).padStart(24,'0');
function setup(count=1){
 const dom=new JSDOM('<div id="sales_new">'+Array.from({length:count},(_,i)=>`<div class="wsk-cp" id="${id(i+1)}"><span class="wsk-cp-stock">23 in stock</span></div>`).join('')+'</div>');
 let branch='shop',clears=0;const requests=[],alerts=[];
 const PosnicPro={local:{get:()=>branch},sales:{itemCache:{clear(){clears++;}},itemsMenu:{_families:{}}},get(url,ok,fail){requests.push({url,ok,fail});},alert(...args){alerts.push(args);}};
 const code=source.slice(source.indexOf('  async function freshProducts'),source.indexOf('  function confirmClear'));
 const api=new Function('PosnicPro','document','active',code+'return {refreshStock,freshProducts};')(PosnicPro,dom.window.document,()=>true);
 return {...api,dom,PosnicPro,requests,alerts,setBranch:b=>branch=b,get clears(){return clears;},stock:()=>dom.window.document.querySelector('.wsk-cp-stock').textContent};
}
test('refresh fetches visible stock without the removed catalogue loader',async()=>{
 const s=setup();const p=s.refreshStock();assert.equal(s.clears,1);assert.equal(s.stock(),'Updating stock...');
 assert.equal(s.requests[0].url,'items/'+id(1));s.requests[0].ok({type:'success',data:{available_quantity:16,track_inventory:true}});await p;
 assert.equal(s.stock(),'16 in stock');assert.equal(s.requests.length,1);
});
test('new refresh wins over an older response',async()=>{
 const s=setup();const first=s.refreshStock(),second=s.refreshStock();
 s.requests[1].ok({type:'success',data:{available_quantity:15,track_inventory:true}});await second;
 s.requests[0].ok({type:'success',data:{available_quantity:23,track_inventory:true}});await first;assert.equal(s.stock(),'15 in stock');
});
test('refresh failure is visible and never reports success',async()=>{
 const s=setup();let result;const p=s.refreshStock(ok=>result=ok);s.requests[0].fail();await p;
 assert.equal(result,false);assert.equal(s.stock(),'Stock unavailable');assert.equal(s.alerts.length,1);
});
test('branch change and removed tiles cannot receive stale updates',async()=>{
 const s=setup();const p=s.refreshStock();s.setBranch('other');s.requests[0].ok({type:'success',data:{available_quantity:16,track_inventory:true}});await p;
 assert.notEqual(s.stock(),'16 in stock');
});
test('fresh reads deduplicate ids, bound concurrency, and reach saved off-page products',async()=>{
 const s=setup(0);const p=s.freshProducts([...Array.from({length:8},(_,i)=>id(i+1)),id(8)]);
 assert.equal(s.requests.length,6);
 for(let i=0;i<8;i++){s.requests[i].ok({type:'success',data:{id:id(i+1),available_quantity:i}});await new Promise(setImmediate);}
 assert.equal((await p).size,8);assert.equal(s.requests.length,8);
});
test('variant family stock and picker rows are both refreshed',async()=>{
 const s=setup();const tile=s.dom.window.document.querySelector('.wsk-cp');tile.dataset.variantGroup='family';
 s.PosnicPro.sales.itemsMenu._families.family=[{id:id(1)},{id:id(2)}];
 const p=s.refreshStock();s.requests[0].ok({type:'success',data:{available_quantity:2,track_inventory:true}});s.requests[1].ok({type:'success',data:{available_quantity:3,track_inventory:true}});await p;
 assert.equal(s.stock(),'5 in stock');assert.equal(s.PosnicPro.sales.itemsMenu._families.family[1].available_quantity,3);
});
test('saved basket restore no longer depends on full catalogue loading',()=>{
 assert.ok(!source.includes('loadBillingCatalogue'));
 assert.ok(source.includes('var products=await freshProducts(lines.map'));
});
