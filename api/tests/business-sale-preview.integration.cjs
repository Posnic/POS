'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
let mongo, client, db, BaseModel, mongoose;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  process.env.MONGODB_URI = mongo.getUri('business_preview');
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db('business_preview');
  BaseModel = require('../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = client;
  BaseModel._connectedUri = process.env.MONGODB_URI;
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
});
after(async () => {
  await mongoose?.disconnect();
  if (BaseModel?.mongoClient && BaseModel.mongoClient !== client)
    await BaseModel.mongoClient.close();
  await client?.close();
  await mongo?.stop();
});
test('decision preview reconciles with the saved Mongoose sale and performs no sale or stock writes', async () => {
  const service = require('../src/services/sale.service');
  const {
    prepareDiscountIntent,
    discountIntentFromPricing,
  } = require('../src/services/business-discount-intent');
  const { createDecisionLedger } = require('../src/services/business-decision-ledger');
  for (const options of [
    { tax: 0, roundOff: true },
    { tax: 18, roundOff: false },
  ]) {
    const license = new ObjectId(),
      branchId = new ObjectId(),
      itemId = new ObjectId(),
      userId = new ObjectId();
    BaseModel.license = license;
    BaseModel.currentBranch = branchId;
    BaseModel.loggedUser = userId;
    BaseModel.loggedUserName = 'Test cashier';
    const branch = {
      _id: branchId,
      license,
      branch_name: 'Central',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
      roundOff: options.roundOff,
    };
    await db.collection('branches').insertOne(branch);
    await db.collection('items').insertOne({
      _id: itemId,
      license,
      branch_id: branchId,
      name: 'Test item',
      item_name: 'Test item',
      itemid: 'ITEM1',
      selling_price: 100.27,
      available_quantity: 50,
      company_price: 20,
      tax: options.tax,
      tax_type: 'exclusive',
      track_inventory: false,
    });
    const context = {
      licenseId: String(license),
      branchId: String(branchId),
      userId: String(userId),
      userName: 'Test cashier',
      branchName: 'Central',
      salesPrefix: 'INV',
      deviceId: 'desktop-00000000001',
      stockManagement: false,
      roundOff: options.roundOff,
      branchSettings: branch,
    };
    const data = {
      billing_transaction_id: 'operation-' + new ObjectId(),
      sales_total: 0,
      payment_mode: 'Cash',
      items: [{ item_id: String(itemId), item_quantity: 2 }],
      extra_discount: 10,
      extra_discount_type: 'percent',
    };
    const intent = await prepareDiscountIntent(data, context, 'Regular customer');
    assert.equal(await db.collection('sales').countDocuments({ license }), 0);
    assert.equal((await db.collection('items').findOne({ _id: itemId })).available_quantity, 50);
    const source = {
      businessId: String(license),
      branchId: String(branchId),
      requesterId: String(userId),
      deviceId: context.deviceId,
    };
    const approver = {
      businessId: String(license),
      accountId: String(new ObjectId()),
      branches: [{ id: String(branchId) }],
      capabilities: ['discounts.approve'],
    };
    const ledger = createDecisionLedger(db);
    const request = await ledger.create(source, intent);
    await ledger.decide(approver, String(request._id), {
      decisionId: 'decision-' + new ObjectId(),
      expectedRevision: 0,
      outcome: 'approved',
      reason: '',
    });
    const executionId = 'execution-' + new ObjectId();
    const result = await service.processSale(data, '', 'Add', context, {
      beforeCommit: async (pricing) => {
        const current = discountIntentFromPricing(data, context, 'Regular customer', pricing);
        const claim = await ledger.claim(
          source,
          String(request._id),
          current.revisionHash,
          executionId,
          approver
        );
        assert.equal(claim.executionPermit, 'start');
        return {
          decisionId: String(request._id),
          revisionHash: current.revisionHash,
          executionId,
          approverId: approver.accountId,
        };
      },
    });
    assert.equal(result.status, true, JSON.stringify(result));
    const stored = await db
      .collection('sales')
      .findOne({ license, billing_transaction_id: data.billing_transaction_id });
    assert.ok(stored);
    assert.equal(stored.business_decision_receipt.decisionId, String(request._id));
    assert.equal(stored.business_decision_receipt.revisionHash, intent.revisionHash);
    assert.equal(stored.business_decision_receipt.executionId, executionId);
    await require('../src/models/sale.model').updateOne(
      { _id: stored._id },
      { $set: { 'business_decision_receipt.revisionHash': 'f'.repeat(64) } }
    );
    assert.equal(
      (await db.collection('sales').findOne({ _id: stored._id })).business_decision_receipt
        .revisionHash,
      intent.revisionHash
    );
    // A lost response leaves the decision applying, while the sale itself
    // supplies the durable proof needed to reconcile after process restart.
    const recovering = createDecisionLedger(db);
    assert.equal(
      (
        await recovering.claim(
          source,
          String(request._id),
          intent.revisionHash,
          executionId,
          approver
        )
      ).executionPermit,
      'reconcile'
    );
    assert.equal(
      (await recovering.acknowledge(source, String(request._id), executionId, String(stored._id)))
        .state,
      'applied'
    );
    assert.equal(Math.round(stored.sales_total * 100), intent.summary.payableMinor);
    assert.equal(Math.round(stored.sale_extra_discount * 100), intent.summary.discountMinor);
    assert.equal(
      intent.summary.beforeDiscountMinor -
        intent.summary.discountMinor +
        intent.summary.roundingMinor,
      intent.summary.payableMinor
    );
  }
});
