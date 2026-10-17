const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient,ObjectId}=require('mongodb');
const service=require('../../../src/services/sale-customer');
let server,client,db;
const scope={branchId:new ObjectId(),license:new ObjectId()};
const input={create_customer_on_save:true,customer_name:'New Buyer',customer_state:'Goa'};
before(async()=>{server=await MongoMemoryServer.create();client=await MongoClient.connect(server.getUri());db=client.db('sale_customer_test');});
after(async()=>{await client?.close();await server?.stop();});
beforeEach(async()=>{await db.dropDatabase();});
async function saved(data=input){const planned=await service.plan(db,scope,data);const sale={_id:new ObjectId(),branch_id:scope.branchId,license:scope.license,customer_id:planned.id,customer_name:data.customer_name,customer_phone:data.customer_phone||'',customer_state:data.customer_state,customer_creation_pending:planned.pending};await db.collection('sales').insertOne(sale);return sale;}
test('planning an abandoned/failed sale writes no customer; successful save creates name-only customer',async()=>{
 const planned=await service.plan(db,scope,input);assert(planned.pending);assert.equal(await db.collection('customers').countDocuments(),0);
 const sale=await saved();await service.finish(db,scope,sale._id);const customer=await db.collection('customers').findOne({_id:sale.customer_id});assert.equal(customer.name,'New Buyer');assert.equal(customer.phone,'');assert.equal(customer.state,'Goa');assert(customer.updated_date instanceof Date);
 assert.equal((await db.collection('sales').findOne({_id:sale._id})).customer_creation_pending,false);
});
test('concurrent saves/retries reuse stable id and do not overwrite edited contact data',async()=>{
 const a=await saved(),b=await saved();assert.equal(String(a.customer_id),String(b.customer_id));await Promise.all([service.finish(db,scope,a._id),service.finish(db,scope,b._id)]);assert.equal(await db.collection('customers').countDocuments(),1);
 await db.collection('customers').updateOne({_id:a.customer_id},{$set:{phone:'changed',balance:99}});await service.finish(db,scope,a._id);assert.equal((await db.collection('customers').findOne({_id:a.customer_id})).balance,99);
});
test('exact existing name is reused case-insensitively; ambiguous names require selection',async()=>{
 const id=new ObjectId();await db.collection('customers').insertOne({_id:id,branch_id:scope.branchId,license:scope.license,name:'NEW BUYER'});assert.equal(String((await service.plan(db,scope,input)).id),String(id));await db.collection('customers').insertOne({branch_id:scope.branchId,license:scope.license,name:'New Buyer'});await assert.rejects(service.plan(db,scope,input),/Select the correct/);
});
test('committed sale recovery works after restart and never crosses branches or revives deletion',async()=>{
 const sale=await saved();const other={...scope,branchId:new ObjectId()};await service.recover(db,other,'New');assert.equal(await db.collection('customers').countDocuments(),0);await service.recover(db,scope,'New');assert.equal(await db.collection('customers').countDocuments(),1);
 await db.collection('customers').updateOne({_id:sale.customer_id},{$set:{is_deleted:true}});await assert.rejects(service.plan(db,scope,input),/deleted/);await service.finish(db,scope,sale._id);assert.equal((await db.collection('customers').findOne({_id:sale.customer_id})).is_deleted,true);
});
test('cloud and other till reuse the same identifier and preserve references on round-trip',async()=>{
 const sale=await saved();await service.finish(db,scope,sale._id);const docs=await db.collection('customers').find().toArray();const cloud=client.db('sale_customer_cloud'),till=client.db('sale_customer_other');await cloud.dropDatabase();await till.dropDatabase();for(const target of [cloud,till]){for(const doc of docs)await target.collection('customers').replaceOne({_id:doc._id},doc,{upsert:true});assert.equal(String((await service.plan(target,scope,input)).id),String(sale.customer_id));}assert.notEqual(String(service.customerId({...scope,branchId:new ObjectId()},input.customer_name)),String(sale.customer_id));await cloud.dropDatabase();await till.dropDatabase();
});
