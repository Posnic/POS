'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const create=require('../frontend/static/script/js/modules/js/customer-wallet-settlements');
const scope={licenseId:'shop',branchId:'branch',userId:'cashier',customerId:'customer'};
const input={sales:[{id:'abcdef0123456789abcdef01',amount:65,paidamount:40},{id:'abcdef0123456789abcdef02',amount:35,paidamount:10}]};
function fixture(){const data=new Map();let tail=Promise.resolve();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};const locks={request(k,o,fn){const promise=tail.then(fn);tail=promise.catch(()=>{});return promise;}};return {data,storage,locks,store:create({storage,locks,randomUUID})};}
const saved=record=>({state:'saved',commandId:record.commandId,request:record.request,balance:0,sales:record.request.sales.map(row=>row.id)});
test('two tabs and reload retain one canonical original per customer scope',async()=>{
 const f=fixture(),other=create({...f,randomUUID});const results=await Promise.all([f.store.prepare(scope,input),other.prepare(scope,{sales:[input.sales[1]]})]);
 assert.equal(results.filter(r=>r.created).length,1);assert.deepEqual(results[0].record,results[1].record);assert.deepEqual(other.load(scope),results[0].record);
 for(const field of Object.keys(scope))assert.equal(other.load({...scope,[field]:'different'}),null);
});
test('only verified saved or replaceable stopped results release the original',async()=>{
 const f=fixture(),{record}=await f.store.prepare(scope,input);
 for(const result of [{state:'absent'},{state:'pending'}, {...saved(record),balance:NaN},{...saved(record),balance:-1},{...saved(record),sales:[]},{...saved(record),request:{sales:[input.sales[0]]}},{state:'stopped',commandId:record.commandId,canReplace:false}]){
  await assert.rejects(f.store.complete(scope,record.commandId,result));assert.deepEqual(f.store.load(scope),record);
 }
 await f.store.complete(scope,record.commandId,saved(record));const next=(await f.store.prepare(scope,input)).record;
 await assert.rejects(f.store.complete(scope,record.commandId,saved(record)));assert.deepEqual(f.store.load(scope),next);
 await f.store.complete(scope,next.commandId,{state:'stopped',commandId:next.commandId,canReplace:true});assert.equal(f.store.load(scope),null);
});
test('unavailable locks, quota, corruption and silent storage failures hold the request',async()=>{
 const f=fixture();assert.throws(()=>create({storage:f.storage,randomUUID}).prepare(scope,input));
 f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(f.store.prepare(scope,input),/quota/);
 const g=fixture();g.storage.setItem=()=>{};await assert.rejects(g.store.prepare(scope,input));
 const h=fixture(),{record}=await h.store.prepare(scope,input);h.storage.removeItem=()=>{};await assert.rejects(h.store.complete(scope,record.commandId,saved(record)));assert.deepEqual(h.store.load(scope),record);
 for(const k of h.data.keys())h.data.set(k,'broken');assert.throws(()=>h.store.load(scope));await assert.rejects(h.store.prepare(scope,input));
});
test('invalid selections are never stored; decimal numbers are preserved',async()=>{
 for(const request of [{sales:[]},{sales:[input.sales[0],input.sales[0]]},{sales:[{...input.sales[0],amount:'65'}]},{sales:[{...input.sales[0],paidamount:-1}]},{sales:[{...input.sales[0],amount:Infinity}]},{sales:input.sales,customer:'other'}]){
  const f=fixture();await assert.rejects(f.store.prepare(scope,request));assert.equal(f.data.size,0);
 }
 const f=fixture(),{record}=await f.store.prepare(scope,{sales:[{...input.sales[0],amount:0.1234,paidamount:0.1}]});assert.equal(record.request.sales[0].amount,0.1234);assert.deepEqual(f.store.load(scope),record);
});
