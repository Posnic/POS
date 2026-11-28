"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const create=require('../frontend/static/script/js/modules/js/invoice-payment-requests');
const scope={licenseId:'shop',branchId:'branch',userId:'cashier',invoiceId:'invoice'};
function fixture(){const data=new Map();let tail=Promise.resolve();const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const locks={request(_key,_options,fn){const work=tail.then(fn);tail=work.catch(()=>{});return work;}};
 return {data,storage,locks,store:create({storage,locks,randomUUID})};}
const values={amount:'25.00',method:'Cash',reference:'receipt'};
const saved=record=>({state:'saved',releasePending:false,commandId:record.request.commandId,result:{status:true,data:{commandId:record.request.commandId,amount:25}}});
test('two tabs retain one original; reopening and other scopes remain isolated',async()=>{
 const f=fixture(),other=create({...f,randomUUID});
 const results=await Promise.all([f.store.prepare(scope,values),other.prepare(scope,{...values,amount:'30'})]);
 assert.equal(results.filter(result=>result.created).length,1);assert.deepEqual(results[0].record,results[1].record);
 assert.deepEqual(other.load(scope),results[0].record);
 assert.equal(other.load({...scope,invoiceId:'another'}),null);assert.equal(other.load({...scope,userId:'another'}),null);
 assert.equal(f.data.size,1);
});
test('uncertain or mismatched results never discard the request',async()=>{
 const f=fixture(),{record}=await f.store.prepare(scope,values),id=record.request.commandId;
 for(const status of [{state:'absent'}, {...saved(record),releasePending:true},{...saved(record),commandId:randomUUID()}, {...saved(record),result:{status:true,data:{commandId:id,amount:30}}}]){
  await assert.rejects(f.store.complete(scope,id,status));assert.deepEqual(f.store.load(scope),record);
 }
 assert.equal(await f.store.complete(scope,id,saved(record)),true);assert.equal(f.store.load(scope),null);
});
test('unreadable or unavailable storage fails before a request can be sent',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw new Error('quota');};await assert.rejects(f.store.prepare(scope,values),/quota/);
 const g=fixture();await g.store.prepare(scope,values);for(const key of g.data.keys())g.data.set(key,'broken');
 assert.throws(()=>g.store.load(scope));await assert.rejects(g.store.prepare(scope,values));
 assert.throws(()=>create({storage:g.storage,randomUUID}).prepare(scope,values));
});
test('a stale confirmation cannot clear a newer request',async()=>{
 const f=fixture(),first=(await f.store.prepare(scope,values)).record;
 await f.store.complete(scope,first.request.commandId,saved(first));
 const second=(await f.store.prepare(scope,values)).record;
 await assert.rejects(f.store.complete(scope,first.request.commandId,saved(first)));
 assert.deepEqual(f.store.load(scope),second);
});
