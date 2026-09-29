'use strict';
// Local qualification fixture, intentionally outside the fast default suite.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { prepareDesktopSummary } = require('../src/services/business-summary-preparer');
async function main() {
  process.env.POSNIC_DESKTOP = '1';
  const mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  let client;
  try {
    client = await MongoClient.connect(mongo.getUri());
    const db = client.db('reporting_load'),
      license = new ObjectId(),
      branchId = new ObjectId();
    await db.collection('sales').createIndex({ license: 1, branch_id: 1, _id: 1 });
    const at = new Date('2026-09-28T01:00:00Z');
    for (let batch = 0; batch < 20; batch++)
      await db
        .collection('sales')
        .insertMany(
          Array.from({ length: 5000 }, () => ({
            _id: new ObjectId(),
            license,
            branch_id: branchId,
            sale_process: 'Add',
            payment_status: 'Paid',
            sales_total: 123.45,
            date: at,
            updated_date: at,
          }))
        );
    const delays = monitorEventLoopDelay({ resolution: 10 });
    delays.enable();
    const started = performance.now();
    const result = await prepareDesktopSummary(
      db,
      {
        id: String(branchId),
        license: String(license),
        currency: 'INR',
        currencyDigits: 2,
        timezone: 'Asia/Kolkata',
      },
      '2026-09-28'
    );
    const elapsedMs = performance.now() - started;
    delays.disable();
    assert.equal(result.completedSales, 100000);
    assert.equal(result.billedSalesMinor, 1234500000);
    assert.equal(result.sourceComplete, false);
    process.stdout.write(
      JSON.stringify({
        documents: result.sourceDocuments,
        elapsedMs: Math.round(elapsedMs),
        eventLoopP99Ms: Math.round(delays.percentile(99) / 1e6),
        eventLoopMaxMs: Math.round(delays.max / 1e6),
      }) + '\n'
    );
  } finally {
    await client?.close();
    await mongo.stop();
  }
}
main().catch((error) => {
  process.stderr.write(String(error.code || error.message) + '\n');
  process.exitCode = 1;
});
