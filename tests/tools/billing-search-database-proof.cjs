const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('../../api/node_modules/mongodb-memory-server');
const { MongoClient, ObjectId } = require('../../api/node_modules/mongodb');
const demo = require('../../api/src/services/demo-data');
const Repository = require('../../api/src/repositories/item.repository');
test('real Mongo: exact matches before limit, safe scope, and complete paginated catalogue', async () => {
 const server=await MongoMemoryServer.create(); const client=new MongoClient(server.getUri());
 const previous=demo.filter;
 try {
  await client.connect(); const col=client.db('billing_search_regression').collection('items');
  demo.filter=async()=>({}); const repo=Object.create(Repository.prototype);repo.getCollection=async()=>col;
  const branchId=new ObjectId(), licenseId=new ObjectId(), context={branchId,licenseId};
  const rows=Array.from({length:221},(_,i)=>({name:'A Item '+String(i).padStart(3,'0'),track_inventory:false}));
  rows.push({name:'Tea',selling_price:50,tax:5,tax_type:'exclusive',available_quantity:110,track_inventory:false,plu_code:'15'});
  for(let i=0;i<20;i++) rows.push({name:'Z Ice Tea '+i,track_inventory:false});
  rows.push({name:'Chicken Biryani',track_inventory:false,itemid:'SKU-CB',barcodes:['890001']});
  await col.insertMany(rows.map(row=>({...row,license:licenseId,branch_access:[{branch_id:branchId}]})));
  await col.insertOne({name:'Tea',license:licenseId,branch_access:[{branch_id:new ObjectId()}],track_inventory:false});
  let result=await repo.getOnlineItemsAjaxList({query:'Tea',limit:5},context);
  assert.equal(result.status,true,result.message);assert.equal(result.data.length,5);assert.equal(result.data[0].item_name,'Tea');
  for(const query of ['CB','biry chi','SKU-CB','890001']) {
   result=await repo.getOnlineItemsAjaxList({query},context);assert.equal(result.status,true,result.message);
   assert.equal(result.data[0].item_name,'Chicken Biryani',query);
  }
  result=await repo.getOnlineItemsAjaxList({query:'15',limit:1},context);assert.equal(result.data[0].item_name,'Tea');
  result=await repo.getOnlineItemsAjaxList({query:'.*'},context);assert.equal(result.data.length,0);
  let offset=0, all=[]; do { result=await repo.getOnlineSalesItems({offset,limit:100},context);assert.equal(result.status,true,result.message);all.push(...result.data);offset=result.next_offset; } while(offset!==null);
  assert.equal(all.length,rows.length);assert.equal(all.filter(item=>item.name==='Tea').length,1);
  assert.equal(all.find(item=>item.name==='Tea').available_quantity,'110');
  await col.deleteMany({});
  await col.insertMany(Array.from({length:2},(_,i)=>({name:'Unavailable '+i,license:licenseId,branch_access:[{branch_id:branchId}],track_inventory:true,available_quantity:0})));
  result=await repo.getOnlineSalesItems({limit:2},context);assert.equal(result.data.length,0);assert.equal(result.next_offset,2);
 } finally { demo.filter=previous;await client.close();await server.stop(); }
});
