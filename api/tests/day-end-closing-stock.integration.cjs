'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { closingStock } = require('../src/services/report-closing-stock');
test('closing stock is historical, tenant and branch scoped, precise, and never substitutes current stock', async () => {
  const server = await MongoMemoryServer.create({
    binary: { systemBinary: path.resolve(__dirname, '../../mongodb/bin/mongod.exe') },
  });
  const client = new MongoClient(server.getUri());
  try {
    await client.connect();
    const db = client.db('closing_stock_test'),
      branch = new ObjectId(),
      license = new ObjectId(),
      item = new ObjectId(),
      unknown = new ObjectId();
    const log = (date, balance, extra = {}) => ({
      branch_id: branch,
      license,
      view_item_id: item,
      date: new Date(date),
      closing_balance: balance,
      ...extra,
    });
    await db
      .collection('stocklogs')
      .insertMany([
        log('2026-10-24T10:00:00Z', '12.345'),
        log('2026-10-25T00:00:00Z', '1'),
        log('2026-10-24T12:00:00Z', '999', { branch_id: new ObjectId() }),
        log('2026-10-24T13:00:00Z', '999', { license: new ObjectId() }),
        log('2026-10-24T14:00:00Z', '999', { is_deleted: true }),
        log('2026-10-24T15:00:00Z', 'N/A', { view_item_id: unknown }),
      ]);
    const opts = {
      branch,
      license,
      end: new Date('2026-10-25T00:00:00Z'),
      itemIds: [item, unknown, new ObjectId()],
    };
    assert.deepEqual([...(await closingStock(db, opts))], [[String(item), 12.345]]);
    assert.equal((await closingStock(db, { ...opts, license: null })).size, 0);
  } finally {
    await client.close();
    await server.stop();
  }
});

test('spoilage reconciliation accounts for receipts, sales, undo and other movements without inventing missing history', async()=>{
 const server=await MongoMemoryServer.create(), client=await MongoClient.connect(server.getUri());
 try {
 const db=client.db('reconciliation'),branch=new ObjectId(),license=new ObjectId(),item=new ObjectId(),unknown=new ObjectId();
 const log=(hour,opening,closing,process,extra={})=>({branch_id:branch,license,view_item_id:item,date:new Date('2026-10-30T'+hour+':00:00Z'),opening_balance:opening,closing_balance:closing,process,...extra});
 await db.collection('stocklogs').insertMany([
 log('08',10,15,'Add Purchase'),log('09',15,13,'Add Sale'),log('10',13,11.5,'Mobile inventory damage',{spoilage_reference:'loss'}),
 log('11',11.5,13,'Mobile inventory receive',{spoilage_reference:'undo'}),log('12',13,12,'Stock count'),
 log('13',12,999,'Add Purchase',{branch_id:new ObjectId()})]);
 const options={branch,license,start:new Date('2026-10-30T00:00:00Z'),end:new Date('2026-10-31T00:00:00Z'),itemIds:[item,unknown]};
 const {reconciliation}=require('../src/services/report-closing-stock');let result=await reconciliation(db,options);
 assert.deepEqual(result.get(String(item)),{opening:10,received:5,sold:2,spoilage:0,otherIn:0,otherOut:1,closing:12,complete:true});
 assert.equal(result.get(String(unknown)).complete,false);assert.equal(result.get(String(unknown)).received,null);
 await db.collection('stocklogs').insertOne(log('14',20,19,'Add Sale'));
 result=await reconciliation(db,options);assert.equal(result.get(String(item)).complete,false);assert.equal(result.get(String(item)).sold,null);
 }finally{await client.close();await server.stop();}
});
