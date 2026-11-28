"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const create=require('../frontend/static/script/js/modules/js/customer-wallet-requests');
const scope={licenseId:'shop',branchId:'branch',userId:'cashier',customerId:'customer'};
const input={kind:'add',amount:'25.00',type:'in',date:'2026-11-28',description:'Deposit'};
function fixture(){const data=new Map();let tail=Promise.resolve();const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};const locks={request(_key,_options,fn){const work=tail.then(fn);tail=work.catch(()=>{});return work;}};return {data,storage,locks,store:create({storage,locks,randomUUID})};}
const saved=record=>({state:'saved',commandId:record.commandId,kind:record.request.kind,request:record.request,entryId:record.request.entryId||'abcdef0123456789abcdef01',balance:25});
test('two tabs preserve one original and reopening keeps scope isolation',async()=>{
 const f=fixture(),other=create({...f,randomUUID});const results=await Promise.all([f.store.prepare(scope,input),other.prepare(scope,{...input,amount:'40'})]);
 assert.equal(results.filter(r=>r.created).length,1);assert.deepEqual(results[0].record,results[1].record);assert.deepEqual(other.load(scope),results[0].record);
 for(const key of Object.keys(scope))assert.equal(other.load({...scope,[key]:'other'}),null);
});
test('uncertain, changed, or stale responses cannot discard originals',async()=>{
 const f=fixture(),{record}=await f.store.prepare(scope,input);
 for(const status of [{state:'absent'},{...saved(record),commandId:randomUUID()},{...saved(record),request:{...record.request,amount:99}},{...saved(record),kind:'remove'},{...saved(record),entryId:''}]){
  await assert.rejects(f.store.complete(scope,record.commandId,status));assert.deepEqual(f.store.load(scope),record);
 }
 await f.store.complete(scope,record.commandId,saved(record));const next=(await f.store.prepare(scope,input)).record;
 await assert.rejects(f.store.complete(scope,record.commandId,saved(record)));assert.deepEqual(f.store.load(scope),next);
});
test('removal completion must name the original entry',async()=>{
 const f=fixture(),{record}=await f.store.prepare(scope,{kind:'remove',entryId:'abcdef0123456789abcdef01'});
 await assert.rejects(f.store.complete(scope,record.commandId,{...saved(record),entryId:'abcdef0123456789abcdef02'}));
 await f.store.complete(scope,record.commandId,saved(record));assert.equal(f.store.load(scope),null);
});
test('unavailable, unreadable and silently failing storage prevents preparation',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw new Error('quota');};await assert.rejects(f.store.prepare(scope,input),/quota/);
 const g=fixture();g.storage.setItem=()=>{};await assert.rejects(g.store.prepare(scope,input));
 const h=fixture();await h.store.prepare(scope,input);for(const key of h.data.keys())h.data.set(key,'broken');assert.throws(()=>h.store.load(scope));await assert.rejects(h.store.prepare(scope,input));
 assert.throws(()=>create({storage:h.storage,randomUUID}).prepare(scope,input));
});
test('invalid input is never saved and failed cleanup keeps the original',async()=>{
 for(const amount of ['1.001','-1','NaN','1e3','0']){const f=fixture();await assert.rejects(f.store.prepare(scope,{...input,amount}));assert.equal(f.data.size,0);}
 const f=fixture(),{record}=await f.store.prepare(scope,input);f.storage.removeItem=()=>{};
 await assert.rejects(f.store.complete(scope,record.commandId,saved(record)));assert.deepEqual(f.store.load(scope),record);
});
