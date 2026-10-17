'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient,ObjectId}=require('mongodb');
const service=require('../src/services/paid-bill-edit');
let server,client,db,old,payload,afterBill,request;
const branchId=new ObjectId(),license=new ObjectId(),id=new ObjectId(),itemA=new ObjectId(),itemB=new ObjectId(),customer=new ObjectId(),register=new ObjectId();
before(async()=>{server=await MongoMemoryServer.create();client=await MongoClient.connect(server.getUri());db=client.db('paid-edit');});
after(async()=>{await client?.close();await server?.stop();});
beforeEach(async()=>{
 await db.dropDatabase();
 await db.collection('branches').insertOne({_id:branchId,license,allow_payment_correction:true,currency:'INR'});
 await db.collection('payment_method').insertMany(['Cash','UPI'].map(payment_value=>({branch_id:branchId,license,payment_value})));
 await db.collection('items').insertMany([{_id:itemA,branch_id:branchId,license,track_inventory:true,available_quantity:4},{_id:itemB,branch_id:branchId,license,track_inventory:false,available_quantity:0}]);
 old={_id:id,branch_id:branchId,license,sales_id:'TEST-27',customer_id:customer,updated_date:new Date(),payment_status:'Paid',sale_process:'KOT',paid_amount:357,sales_total:357,items_total:357,payment_pending:0,captain_payment_plan:'plan',multi_payment:{UPI:299.96,Cash:57.04},items:[{item_id:itemA,item_quantity:1,item_total:189},{item_id:itemB,item_quantity:1,item_total:168}]};
 await db.collection('sales').insertOne(old);
 await db.collection('captain_payment_plans').insertOne({_id:'plan',branch_id:branchId,license,state:'paid',payments:[{amountMinor:35700,allocations:{[String(id)]:35700}}]});
 await db.collection('cashregister').insertOne({_id:register,branch_id:branchId,license,register_status:'Opened',register_sales:[{sales_id:id,register_amount:357,multi_payment:old.multi_payment}]});
 payload={customer_id:String(customer),paid_bill_correction:{id:'test-correction-000001',reason:'Wrong item and payment recorded',originalTotal:357,updatedAt:old.updated_date.toISOString()}};
 afterBill={items:[{item_id:String(itemB),item_quantity:1,item_total:168}],sales_total:168,items_total:168,paid_amount:168,payment_status:'Paid',payment_mode:'UPI',multi_payment:{UPI:168},tax:8,discount:0};
 request={db,user:{_id:new ObjectId(),username:'Tester',access:{sales:{write:true}}},tenantContext:{branchId,licenseId:license},params:{id:String(id)}};
});
const apply=()=>service.amend(request,payload,{}, {quote:async()=>({status:true,data:structuredClone(afterBill)})});
test('corrects removed item and mixed payment to UPI 168 with audit and exactly-once stock restoration',async()=>{
 const plan=await db.collection('captain_payment_plans').findOne({_id:'plan'});
 assert.equal((await apply()).status,true);await apply();
 const sale=await db.collection('sales').findOne({_id:id});
 assert.equal(sale.sales_total,168);assert.equal(sale.paid_amount,168);assert.deepEqual(sale.multi_payment,{UPI:168});
 assert.equal(sale.items.length,1);assert.equal(sale.captain_payment_plan,undefined);
 assert.equal(sale.paid_bill_corrections.length,1);assert.equal(sale.paid_bill_corrections[0].before.sales_total,357);
 assert.equal(sale.paid_bill_corrections[0].money_movement,false);
 assert.equal((await db.collection('items').findOne({_id:itemA})).available_quantity,5);
 assert.equal((await db.collection('items').findOne({_id:itemB})).available_quantity,0);
 assert.deepEqual(await db.collection('captain_payment_plans').findOne({_id:'plan'}),plan);
 const drawer=await db.collection('cashregister').findOne({_id:register});assert.equal(drawer.register_sales[0].register_amount,168);assert.deepEqual(drawer.register_sales[0].multi_payment,{UPI:168});
 assert.equal(sale.payment_correction_pending,undefined);
});
test('recovers after stock write interruption without restoring twice',async()=>{
 const original=db.collection.bind(db);let failed=false;
 request.db={collection(name){const col=original(name);if(name!=='items')return col;return new Proxy(col,{get(t,k){if(k==='updateOne')return async(...args)=>{const result=await t.updateOne(...args);if(!failed){failed=true;throw Error('interrupted');}return result;};const v=t[k];return typeof v==='function'?v.bind(t):v;}});}};
 await assert.rejects(apply(),/interrupted/);request.db=db;await apply();
 assert.equal((await original('items').findOne({_id:itemA})).available_quantity,5);
 assert.equal((await original('sales').findOne({_id:id})).paid_bill_corrections.length,1);
});
for(const mode of ['disabled','closed','shared','stale','no permission','extra item','wrong total'])test('rejects '+mode+' before changing the bill',async()=>{
 if(mode==='disabled')await db.collection('branches').updateOne({_id:branchId},{$set:{allow_payment_correction:false}});
 if(mode==='closed')await db.collection('cashregister').updateOne({_id:register},{$set:{register_status:'Closed'}});
 if(mode==='shared')await db.collection('captain_payment_plans').updateOne({_id:'plan'},{$set:{'payments.0.allocations.other':100}});
 if(mode==='stale')payload.paid_bill_correction.originalTotal=400;
 if(mode==='no permission')request.user.access={};
 if(mode==='extra item')afterBill.items[0].item_quantity=2;
 if(mode==='wrong total')afterBill.multi_payment={UPI:100};
 await assert.rejects(apply());assert.deepEqual(await db.collection('sales').findOne({_id:id}),old);
 assert.equal((await db.collection('items').findOne({_id:itemA})).available_quantity,4);
});



test('a later correction remains audited after the Captain plan was archived',async()=>{
 await apply();const saved=await db.collection('sales').findOne({_id:id});
 payload.paid_bill_correction={id:'test-correction-000002',reason:'Correct recorded method',originalTotal:168,updatedAt:saved.updated_date.toISOString()};
 afterBill.payment_mode='Cash';afterBill.multi_payment={Cash:168};await apply();
 const again=await db.collection('sales').findOne({_id:id});assert.equal(again.paid_bill_corrections.length,2);assert.equal(again.payment_mode,'Cash');
 assert.equal((await db.collection('items').findOne({_id:itemA})).available_quantity,5);
});
test('Captain journal replay does not overwrite a corrected bill or its register',async()=>{
 const plan=await db.collection('captain_payment_plans').findOne({_id:'plan'});
 plan.sales=[old];plan.snapshot={totalMinor:35700,currencyDigits:2,currencyCode:'INR',factor:100};plan.version=1;plan.saleTotals={[String(id)]:35700};
 await apply();const saved=await db.collection('sales').findOne({_id:id});
 await require('../src/services/captain-payments').reconcile(db,{branchId,license,branch:{},options:{}},plan);
 assert.deepEqual(await db.collection('sales').findOne({_id:id}),saved);
 assert.equal((await db.collection('cashregister').findOne({_id:register})).register_sales[0].register_amount,168);
});


test('two corrections cannot both replace the same original bill',async()=>{
 const other=structuredClone(payload);other.paid_bill_correction.id='test-correction-000009';
 const results=await Promise.allSettled([apply(),service.amend(request,other,{}, {quote:async()=>({status:true,data:structuredClone(afterBill)})})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.collection('sales').findOne({_id:id})).paid_bill_corrections.length,1);
 assert.equal((await db.collection('items').findOne({_id:itemA})).available_quantity,5);
});
test('enabled inventory log is written once when retried',async()=>{
 await db.collection('branches').updateOne({_id:branchId},{$set:{stock_management_log:true}});
 await apply();await apply();assert.equal(await db.collection('stocklogs').countDocuments(),1);
});
