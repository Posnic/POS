'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const locks = require('../../../src/services/captain-restructure-lock');
const paymentGuard = require('../../../src/services/captain-payment-guard');
let server, db, scope, sales;
beforeAll(async()=>{server=await MongoMemoryServer.create();await mongoose.connect(server.getUri('restructure-lock'));db=mongoose.connection.db;},60000);
afterAll(async()=>{await mongoose.disconnect();await server?.stop();});
beforeEach(async()=>{
  await db.dropDatabase();scope={branchId:new ObjectId(),license:new ObjectId()};
  sales=[0,1].map(()=>({_id:new ObjectId(),branch_id:scope.branchId,license:scope.license,
    sale_process:'KOT',payment_status:'Unpaid',order_state:'accepted',sales_total:120,
    items:[{item_id:'corn',quantity:1}],updated_date:new Date('2026-09-30T09:00:00Z')}));
  await db.collection('sales').insertMany(sales);
});
const input=(requestId='transfer-request-0001')=>({requestId,actor:'staff-1',intent:{kind:'transfer',quantity:1},sales});

test('validation rejection prevents a late reservation without touching sales',async()=>{
  expect(await locks.rejectIntent(db,scope,input())).toBe(true);
  await expect(locks.reserve(db,scope,input())).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').find().toArray()).toEqual(sales);
  await expect(locks.rejectIntent(db,scope,{...input(),actor:'staff-2'})).rejects.toMatchObject({status:409});
  await expect(locks.rejectIntent(db,scope,{...input(),intent:{kind:'move'}})).rejects.toMatchObject({status:409});
});

test('validation rejection cannot overwrite a concurrent accepted reservation',async()=>{
  const journal=await locks.reserve(db,scope,input());
  expect(await locks.rejectIntent(db,scope,input())).toBe(false);
  expect((await locks.read(db,scope,input().requestId,'staff-1')).stage).toBe('reserved');
  expect(await db.collection('sales').countDocuments({captain_payment_plan:journal._id})).toBe(2);
});
test('reservation fences both orders from the existing payment and edit writers',async()=>{
  const journal=await locks.reserve(db,scope,input());
  expect(journal.stage).toBe('reserved');
  for(const sale of await db.collection('sales').find().toArray()){
    expect(sale.captain_payment_plan).toBe(journal._id);
    await expect(paymentGuard.mutable(db,sale)).rejects.toMatchObject({status:409});
    expect((await db.collection('sales').updateOne({_id:sale._id,captain_payment_plan:{$exists:false}},{$set:{payment_status:'Paid'}})).matchedCount).toBe(0);
  }
  expect(journal.payments).toEqual([]);
});
test('same request resumes, but changed intent and another staff member cannot reuse it',async()=>{
  const first=await locks.reserve(db,scope,input());
  expect((await locks.reserve(db,scope,input()))._id).toBe(first._id);
  await expect(locks.reserve(db,scope,{...input(),intent:{kind:'merge'}})).rejects.toMatchObject({status:409});
  await expect(locks.reserve(db,scope,{...input(),actor:'staff-2'})).rejects.toMatchObject({status:409});
});
test('stale source data cancels the attempt and clears any earlier reservation',async()=>{
  const last=[...sales].sort((a,b)=>String(a._id).localeCompare(String(b._id))).at(-1);
  await db.collection('sales').updateOne({_id:last._id},{$set:{sales_total:121}});
  await expect(locks.reserve(db,scope,input())).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  expect((await locks.read(db,scope,input().requestId,'staff-1')).stage).toBe('cancelled');
});

test('legacy cover eligibility still requires the exact payment snapshot read by the caller',async()=>{
  await db.collection('sales').updateOne({_id:sales[0]._id},{$set:{payment_status:''}});
  await expect(locks.reserve(db,scope,{...input(),intent:{kind:'covers'}})).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  expect((await db.collection('sales').findOne({_id:sales[0]._id})).payment_status).toBe('');
});
test('two competing requests have one winner without clearing the winner reservations',async()=>{
  const results=await Promise.allSettled([locks.reserve(db,scope,input()),locks.reserve(db,scope,input('transfer-request-0002'))]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const winner=results.find(result=>result.status==='fulfilled').value;
  expect(await db.collection('sales').countDocuments({captain_payment_plan:winner._id})).toBe(2);
});

test.each([
  ['person_count', 8], ['table_number', 'T9'], ['table_id', 'changed-table'],
  ['dine_type', 'Take away'], ['seating_request_id', 'changed-request'],
  ['seating_primary_id', 'changed-primary'], ['seating_table_ids', ['changed-table']],
])('a stale %s rejects the move even when the update timestamp is unchanged',async(field,value)=>{
  const last=[...sales].sort((a,b)=>String(a._id).localeCompare(String(b._id))).at(-1);
  await db.collection('sales').updateOne({_id:last._id},{$set:{[field]:value}});
  await expect(locks.reserve(db,scope,{...input(),intent:{kind:'move'}})).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  expect((await db.collection('sales').findOne({_id:last._id}))[field]).toEqual(value);
  expect((await locks.read(db,scope,input().requestId,'staff-1')).stage).toBe('cancelled');
});
test('cancellation is idempotent and its tombstone refuses another reservation',async()=>{
  await locks.reserve(db,scope,input());
  await locks.cancel(db,scope,input().requestId,'staff-1');
  await locks.cancel(db,scope,input().requestId,'staff-1');
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  await expect(locks.reserve(db,scope,input())).rejects.toMatchObject({status:409});
});

test.each([['sales_sub_total',100],['subtotal',100],['total',105],['items_subtotal',100],['items_total',105],['discount',3],['tax',5],['sales_tax',5],['round_off',0.01],
  ['sales_round_off',0.01],['captain_transfer_allocation',{version:1,totalMinor:12000}]])(
  'a changed %s cannot use an earlier financial snapshot even when total and timestamp match',async(field,value)=>{
    const last=[...sales].sort((a,b)=>String(a._id).localeCompare(String(b._id))).at(-1);
    await db.collection('sales').updateOne({_id:last._id},{$set:{[field]:value}});
    await expect(locks.reserve(db,scope,input())).rejects.toMatchObject({status:409});
    expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
    expect((await db.collection('sales').findOne({_id:last._id}))[field]).toEqual(value);
  }
);
test('an applying operation cannot be cancelled and completion retries release its own locks',async()=>{
  const journal=await locks.reserve(db,scope,input());
  await locks.applying(db,scope,input().requestId,'staff-1');
  await expect(locks.cancel(db,scope,input().requestId,'staff-1')).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').countDocuments({captain_payment_plan:journal._id})).toBe(2);
  await locks.complete(db,scope,input().requestId,'staff-1');
  await locks.complete(db,scope,input().requestId,'staff-1');
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  expect((await locks.read(db,scope,input().requestId,'staff-1')).stage).toBe('completed');
});
test('foreign branch cleanup cannot release an authorized branch reservation',async()=>{
  const journal=await locks.reserve(db,scope,input());
  await expect(locks.cancel(db,{...scope,branchId:new ObjectId()},input().requestId,'staff-1')).rejects.toMatchObject({status:409});
  expect(await db.collection('sales').countDocuments({captain_payment_plan:journal._id})).toBe(2);
});
test('recorded payments and an active edit lease are never replaced',async()=>{
  await db.collection('sales').updateOne({_id:sales[0]._id},{$set:{captain_payment_plan:'real-payment'}});
  await expect(locks.reserve(db,scope,input())).rejects.toMatchObject({status:409});
  expect((await db.collection('sales').findOne({_id:sales[0]._id})).captain_payment_plan).toBe('real-payment');
  await db.collection('sales').updateOne({_id:sales[0]._id},{$unset:{captain_payment_plan:''},$set:{captain_edit_until:new Date(Date.now()+60000)}});
  await expect(locks.reserve(db,scope,input('transfer-request-0002'))).rejects.toMatchObject({status:409});
});
test('completion releases a newly projected destination with the same operation fence',async()=>{
  const journal=await locks.reserve(db,scope,{...input(),sales:[sales[0]]});
  await locks.applying(db,scope,input().requestId,'staff-1');
  await db.collection('sales').insertOne({...sales[0],_id:new ObjectId(),captain_payment_plan:journal._id});
  await locks.complete(db,scope,input().requestId,'staff-1');
  expect(await db.collection('sales').countDocuments({captain_payment_plan:journal._id})).toBe(0);
});
test('cancelling during acquisition removes a late reservation without reviving the request',async()=>{
  let release,started;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  let intercepted=false;
  const delayed={collection(name){
    const collection=db.collection(name);
    if(name!=='sales')return collection;
    return new Proxy(collection,{get(target,key){
      if(key==='updateOne')return async(...args)=>{
        if(!intercepted){intercepted=true;started();await gate;}
        return target.updateOne(...args);
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
  }};
  const acquiring=locks.reserve(delayed,scope,input());
  const rejected=expect(acquiring).rejects.toMatchObject({status:409});
  await waiting;
  await locks.cancel(db,scope,input().requestId,'staff-1');
  release();await rejected;
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  expect((await locks.read(db,scope,input().requestId,'staff-1')).stage).toBe('cancelled');
});
