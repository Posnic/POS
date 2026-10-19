const { describe, it: test, before: beforeAll, after: afterAll } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('../api/node_modules/mongodb-memory-server');
const { MongoClient, ObjectId } = require('../api/node_modules/mongodb');
const pipeline = require('../api/src/helpers/sales-history-options');

describe('recorded history filter choices', () => {
  let server, client, sales;
  const branchId = new ObjectId(), licenseId = new ObjectId();
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
    sales = client.db('choices').collection('sales');
    await sales.insertMany([
      { license: licenseId, branch_id: branchId, kitchen_actor: { name: 'Jack' }, created_by: 'Cashier', client: { device_id: 'tablet-1', device_model: 'Kitchen tablet' } },
      { license: licenseId, branch_id: branchId, kitchen_actor: { name: '' }, client: { staff_name: 'Asha', device_id: 'tablet-1', device_model: 'Kitchen tablet' } },
      { license: new ObjectId(), branch_id: branchId, created_by: 'Other tenant' },
      { license: licenseId, branch_id: new ObjectId(), created_by: 'Other branch' },
      { license: licenseId, branch_id: branchId, channel: 'marketplace' },
      { license: licenseId, branch_id: branchId, sale_method: 'Kiosk' },
      { license: new ObjectId(), branch_id: branchId, channel: 'ecommerce' },
      ...Array.from({length:12}, (_,i)=>({license:licenseId,branch_id:branchId,created_by:'Staff '+i})),
    ]);
  });
  afterAll(async () => { if (client) await client.close(); if (server) await server.stop(); });
  const options = (field, query='') => sales.aggregate(pipeline({branchId,licenseId,field,query})).toArray();
  test('initial choices are capped, tenant scoped and use original order taker', async () => {
    const rows = await options('staff');
    assert.equal(rows.length,10);
    assert.ok(rows.some(r=>r.value==='Asha'));assert.ok(rows.some(r=>r.value==='Jack'));
    assert.deepEqual(await options('staff','Cashier'),[]);
    assert.deepEqual(await options('staff','Other'),[]);
  });
  test('device search uses model or ID and deduplicates records', async () => {
    assert.deepEqual(await options('device','kitchen'),[{label:'Kitchen tablet',value:'tablet-1'}]);
    assert.equal((await options('device','tablet-1')).length,1);
    assert.deepEqual(await options('device','.*'),[]);
  });
  test('invalid field, query objects and branch IDs are rejected', () => {
    for (const extra of [{field:'password'}, {query:{$ne:''}}, {branchId:'invalid'}])
      assert.throws(()=>pipeline({branchId,licenseId,field:'staff',...extra}));
  });
  test('recorded sources include marketplace and legacy sales without module flags or tenant leakage', async () => {
    assert.deepEqual(await options('source'), [
      {value:'kiosk',label:'kiosk'}, {value:'marketplace',label:'marketplace'}, {value:'pos',label:'pos'},
    ]);
    assert.deepEqual(await options('source', 'market'), [{value:'marketplace',label:'marketplace'}]);
  });
});
