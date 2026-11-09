const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('../api/node_modules/mongodb-memory-server');
const { MongoClient, ObjectId } = require('../api/node_modules/mongodb');
const demo = require('../api/src/services/demo-data');
const history = require('../api/src/services/purchase-history');

test('combined purchases filter both collections before whole-result sorting, counting and paging', async (t) => {
  const server = await MongoMemoryServer.create();
  t.after(() => server.stop());
  const client = await MongoClient.connect(server.getUri());
  t.after(() => client.close());
  t.mock.method(demo, 'filter', async () => ({ demo_pack: { $exists: false } }));
  const db = client.db('localtest');
  const wall = { branch_id: new ObjectId(), license: new ObjectId() };
  const supplier = new ObjectId();
  const party = { supplier_id: supplier, supplier_name: 'Parts supplier' };
  const context = { branchId: wall.branch_id, licenseId: wall.license };
  const settings = { supplier_id: String(supplier), sort: 'total_desc', page: 11, limit: 10 };
  await db.collection('purchase_orders').insertMany(Array.from({length:100}, (_,i) => ({
    ...wall, ...party, po_id:'PO-'+i, grand_total:i+1, status:'ordered'
  })));
  const receipt = { ...wall, ...party, receiving_id:'R-1', items_total:'0.50', receiving_status:'Received' };
  await db.collection('receivings').insertMany([
    receipt, {...receipt,_id:new ObjectId(),license:new ObjectId()}, {...receipt,_id:new ObjectId(),branch_id:new ObjectId()},
    {...receipt,_id:new ObjectId(),supplier_id:new ObjectId()}, {...receipt,_id:new ObjectId(),demo_pack:'sample'}
  ]);
  const result = await history(db,context,settings);
  assert.equal(result.total,101);
  assert.equal(result.purchases,1);
  assert.equal(result.purchaseAmount,0.5);
  assert.deepEqual(result.list.map(row=>[row.kind,row.no,row.total]),[['purchase','R-1',0.5]]);
  const completed = await history(db,context,{status:'received', supplier_id:String(supplier)});
  assert.equal(completed.total,1);
  assert.equal(completed.list[0].no,'R-1');
});
