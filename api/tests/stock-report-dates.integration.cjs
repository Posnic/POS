'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const ItemRepository = require('../src/repositories/item.repository');

test('stock valuation includes catalogue dates and legacy dates within the scoped range', async () => {
  const server = await MongoMemoryServer.create();
  const client = new MongoClient(server.getUri());
  try {
    await client.connect();
    const collection = client.db('stock_report_date_test').collection('items');
    const branch = new ObjectId();
    const license = new ObjectId();
    const row = {
      branch_access: [{ branch_id: branch }],
      license,
      track_inventory: true,
      available_quantity: 7,
      company_price: 60,
      selling_price: 100,
      created_date: new Date('2026-10-29T00:00:00Z'),
    };
    await collection.insertMany([
      { ...row, name: 'Catalogue item' },
      {
        ...row,
        name: 'Legacy item',
        created_date: null,
        createdAt: row.created_date,
        available_quantity: 2,
      },
      { ...row, name: 'Other tenant', license: new ObjectId() },
      { ...row, name: 'Other branch', branch_access: [{ branch_id: new ObjectId() }] },
      { ...row, name: 'Untracked', track_inventory: false },
      { ...row, name: 'Outside range', created_date: new Date('2020-01-01') },
    ]);
    const repo = Object.create(ItemRepository.prototype);
    repo.getCollection = async () => collection;
    const data = {
      branchid: [String(branch)],
      starting_date: '2026-10-29T00:00:00Z',
      ending_date: '2026-10-29T23:59:59Z',
    };
    const context = { licenseId: String(license), options: { page: 1, limit: 1 } };
    const result = await repo.itemStockReportTable(data, context);
    assert.equal(result.status, true);
    assert.equal(result.total, 2);
    assert.equal(result.list.length, 1);
    assert.equal(result.company_total, 540);
    assert.equal(result.selling_total, 900);
    const second = await repo.itemStockReportTable(data, {
      ...context,
      options: { page: 2, limit: 1 },
    });
    assert.equal(second.list[0].name, 'Catalogue item');
    assert.equal(second.list[0].available_quantity, 7);
    assert.equal(second.list[0].company_total, 420);
  } finally {
    await client.close();
    await server.stop();
  }
});
