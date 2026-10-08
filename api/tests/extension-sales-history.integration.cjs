'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { listSales, dailySales } = require('../src/services/extension-sales-history');
test('paid history pages without gaps and reports the local payment day across DST', async () => {
  const mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('history_acceptance');
    const scope = { license: new ObjectId(), branchId: new ObjectId() };
    const descriptor = { id: 'posnic.example' },
      currency = { currencyCode: 'GBP', currencyDigits: 2, factor: 100 };
    await db
      .collection('branches')
      .insertOne({ _id: scope.branchId, license: scope.license, time_zone: 'Europe/London' });
    const base = {
      license: scope.license,
      branch_id: scope.branchId,
      extensionId: descriptor.id,
      status: 'paid',
      method: 'cash',
      paidAt: new Date('2026-10-25T12:00:00Z'),
      valueMinor: 100,
      currency,
      payload: { customer_name: 'Customer' },
    };
    const rows = Array.from({ length: 105 }, (_, i) => ({
      ...base,
      _id: i.toString(16).padStart(64, '0'),
      saleId: new ObjectId(),
    }));
    await db.collection('extension_payments').insertMany(rows);
    const input = { db, scope, descriptor };
    const first = await listSales(input),
      second = await listSales({ ...input, after: first.next }),
      third = await listSales({ ...input, after: second.next });
    assert.deepEqual([first.sales.length, second.sales.length, third.sales.length], [50, 50, 5]);
    assert.equal(
      new Set([...first.sales, ...second.sales, ...third.sales].map((s) => s.id)).size,
      105
    );
    assert.equal(third.next, null);
    assert.equal(
      (await listSales({ ...input, scope: { ...scope, branchId: new ObjectId() } })).sales.length,
      0
    );
    await assert.rejects(listSales({ ...input, after: 'invalid' }), {
      code: 'extension_history_cursor_invalid',
    });
    await assert.rejects(dailySales({ ...input, day: '2026-02-30' }), {
      code: 'extension_report_date_invalid',
    });
    await db.collection('extension_payments').insertMany([
      {
        ...base,
        _id: 'a'.repeat(64),
        saleId: new ObjectId(),
        paidAt: new Date('2026-10-24T23:30:00Z'),
        method: 'card',
        valueMinor: 250,
      },
      {
        ...base,
        _id: 'b'.repeat(64),
        saleId: new ObjectId(),
        paidAt: new Date('2026-10-26T00:00:00Z'),
        valueMinor: 999,
      },
      {
        ...base,
        _id: 'c'.repeat(64),
        saleId: new ObjectId(),
        currency: { currencyCode: 'EUR', currencyDigits: 2, factor: 100 },
        valueMinor: 300,
      },
      { ...base, _id: 'd'.repeat(64), saleId: new ObjectId(), status: 'pending', valueMinor: 888 },
    ]);
    const report = await dailySales({ ...input, day: '2026-10-25' });
    const gbp = report.totals.find((group) => group.currency.currencyCode === 'GBP');
    assert.equal(gbp.cashMinor, 10500);
    assert.equal(gbp.cardMinor, 250);
    assert.equal(
      report.totals.find((group) => group.currency.currencyCode === 'EUR').cashMinor,
      300
    );
    assert.equal(report.timeZone, 'Europe/London');
    const month = await dailySales({...input,day:'2026-10-01',endDay:'2026-10-31'});
    assert.equal(month.totals.find(g=>g.currency.currencyCode==='GBP').cashMinor,11499);
    assert.equal(month.totals.find(g=>g.currency.currencyCode==='GBP').cardMinor,250);
    for(const endDay of ['2026-09-30','2026-02-30','2028-10-01'])await assert.rejects(dailySales({...input,day:'2026-10-01',endDay}),{code:'extension_report_date_invalid'});
  } finally {
    await client.close();
    await mongo.stop();
  }
});
