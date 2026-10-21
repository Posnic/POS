'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { reportSaleTax, reportSaleTotal } = require('../src/helpers/reportable-sales');

test('day-end totals use saved payable amounts and item taxes, with legacy fallback', async () => {
  const binary = path.resolve(__dirname, '../../mongodb/bin/mongod.exe');
  const server = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary } : {} });
  const client = new MongoClient(server.getUri());
  try {
    await client.connect();
    const col = client.db('day_end_test').collection('sales');
    await col.insertMany([
      { _id: 1, sales_total: 100, items_total: 110, tax_amount: 0, items: [{ tax_amount: 4 }, { tax_amount: '5.5' }] },
      { _id: 2, total: 50, tax_amount: '3', items: [] },
      { _id: 3, sales_total: 0, items_total: 100, tax_amount: 8, items: [{ tax_amount: 0 }] },
      { _id: 4, items_total: 20, items: [{ tax_amount: -2.5 }] },
      { _id: 5 },
    ]);
    const rows = await col.aggregate([{ $project: { total: reportSaleTotal(), tax: reportSaleTax() } }, { $sort: { _id: 1 } }]).toArray();
    assert.deepEqual(rows.map(({ total, tax }) => ({ total, tax })), [
      { total: 100, tax: 9.5 }, { total: 50, tax: 3 }, { total: 0, tax: 0 },
      { total: 20, tax: -2.5 }, { total: 0, tax: 0 },
    ]);
  } finally {
    await client.close();
    await server.stop();
  }
});
