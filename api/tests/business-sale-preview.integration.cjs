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

test('Community checkout uses authenticated owner approval, final pricing and one durable execution receipt', async () => {
  const flags = [
    'POSNIC_DESKTOP',
    'POSNIC_BUSINESS_DECISIONS',
    'POSNIC_BUSINESS_LOCAL_DECISIONS',
    'POSNIC_SYNC_PAIRED',
  ];
  const prior = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
  try {
    for (const key of flags) process.env[key] = key === 'POSNIC_SYNC_PAIRED' ? '0' : '1';
    const crypto = require('node:crypto'),
      bcrypt = require('bcryptjs');
    const { createCheckoutDecisions } = require('../src/services/business-checkout-decisions');
    const { createCheckoutTransport } = require('../src/services/business-checkout-transport');
    const { createBusinessAccess, opaque, proof } = require('../src/services/business-access');
    const { decide } = require('../src/services/business-decisions');
    const service = require('../src/services/sale.service');
    const license = new ObjectId(),
      branchId = new ObjectId(),
      itemId = new ObjectId();
    const cashier = {
      _id: new ObjectId(),
      license,
      activate: true,
      authVersion: 1,
      usertype: 'cashier',
      branch_access: [{ branch_id: branchId }],
      access: { sales: { write: true } },
    };
    const owner = {
      ...cashier,
      _id: new ObjectId(),
      usertype: 'admin',
      username: opaque(),
      password: await bcrypt.hash('Fixture-password-only', 4),
    };
    const branch = {
      _id: branchId,
      license,
      branch_name: 'Community',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
      roundOff: false,
      stock_management: false,
    };
    BaseModel.license = license;
    BaseModel.currentBranch = branchId;
    BaseModel.loggedUser = cashier._id;
    BaseModel.loggedUserName = 'Cashier';
    await db.collection('branches').insertOne(branch);
    await db.collection('users').insertMany([cashier, owner]);
    await db.collection('items').insertOne({
      _id: itemId,
      license,
      branch_id: branchId,
      name: 'Item',
      item_name: 'Item',
      itemid: 'COMM1',
      selling_price: 100,
      available_quantity: 50,
      company_price: 20,
      tax: 0,
      track_inventory: false,
    });
    const context = {
      licenseId: String(license),
      branchId: String(branchId),
      userId: String(cashier._id),
      userName: 'Cashier',
      branchName: 'Community',
      salesPrefix: 'INV',
      deviceId: 'register-browser-0001',
      stockManagement: false,
      roundOff: false,
      branchSettings: branch,
    };
    const payload = {
      billing_transaction_id: crypto.randomUUID(),
      sales_total: 0,
      payment_mode: 'Cash',
      sale_process: 'add',
      items: [{ item_id: String(itemId), item_quantity: 2 }],
      extra_discount: 10,
      extra_discount_type: 'percent',
    };
    const checkout = createCheckoutDecisions(db);
    const controller = require('../src/controllers/sales.controller');
    const req = {
      user: cashier,
      session: { selectedBranchId: String(branchId) },
      headers: {},
      ip: '127.0.0.1',
      get(name) {
        return this.headers[name.toLowerCase()];
      },
    };
    const invoke = async (method, body) => {
      const response = {
        code: 200,
        status(value) {
          this.code = value;
          return this;
        },
        json(value) {
          this.body = value;
          return this;
        },
      };
      await controller[method]({ ...req, method: 'POST', params: {}, body }, response, (error) => {
        throw error;
      });
      return response;
    };
    const requested = await invoke('businessDiscountDecision', {
      sale: payload,
      reason: 'Loyal customer',
    });
    assert.equal(requested.code, 200, JSON.stringify(requested.body));
    const row = requested.body.data;
    assert.equal(row.state, 'pending');
    const capabilities = await checkout.capabilities(context, cashier);
    assert.equal(capabilities.enabled, true);
    assert.equal(capabilities.recoveryVersion, 1);
    assert.equal(capabilities.requesterId, String(cashier._id));
    const resumed = await checkout.lookup(context, cashier, payload.billing_transaction_id);
    assert.equal(resumed.id, row.id);
    assert.equal(resumed.checkout.state, 'not_started');
    assert.equal(await checkout.lookup(context, cashier, crypto.randomUUID()), null);
    assert.equal(await db.collection('sales').countDocuments({ license }), 0);
    await assert.rejects(
      checkout.gate(context, cashier, { ...payload, business_decision_id: row.id }),
      { code: 'decision_not_approved' }
    );
    const access = createBusinessAccess(db),
      verifier = opaque();
    const pending = await access.request({
      codeChallenge: proof(verifier),
      deviceName: 'Owner phone',
    });
    await access.decide(pending.request, 'allow', owner.username, 'Fixture-password-only');
    const grant = await access.exchange(pending.request, verifier),
      identity = await access.authenticate(grant.token);
    await decide(db, identity.session._id, row.id, {
      decisionId: crypto.randomUUID(),
      expectedRevision: 0,
      outcome: 'approved',
      reason: '',
    });
    const changed = { ...payload, extra_discount: 20, business_decision_id: row.id };
    const changedGate = await checkout.gate(context, cashier, changed);
    const rejected = await service.processSale(changed, '', 'Add', context, {
      beforeCommit: changedGate,
    });
    assert.equal(rejected.status, false);
    assert.equal(rejected.decisionError.code, 'decision_revision_changed');
    assert.equal(await db.collection('sales').countDocuments({ license }), 0);
    const original = { ...payload, business_decision_id: row.id };
    const completed = await invoke('create', original);
    assert.equal(completed.code, 200, JSON.stringify(completed.body));
    const saved = completed.body;
    assert.equal(saved.type, 'success', JSON.stringify(saved));
    const sale = await db
      .collection('sales')
      .findOne({ _id: new ObjectId(String(saved.data._id)) });
    assert.equal(sale.business_decision_receipt.decisionId, row.id);
    assert.match(sale.business_decision_receipt.deviceId, /^community-/);
    assert.equal(context.deviceId, 'register-browser-0001');
    const locallySaved = await checkout.read(context, cashier, row.id);
    assert.equal(locallySaved.checkout.state, 'saved');
    const recoveryResponse = {
      json(value) {
        this.body = value;
        return this;
      },
    };
    await controller.businessDiscountDecision(
      { ...req, method: 'GET', params: { requestId: 'recoveries' }, query: {} },
      recoveryResponse,
      (error) => {
        throw error;
      }
    );
    assert.equal(recoveryResponse.body.data.references.length, 1);
    assert.equal(recoveryResponse.body.data.references[0].requestId, row.id);
    assert.equal(recoveryResponse.body.data.nextCursor, null);

    assert.equal(locallySaved.checkout.saleId, String(sale._id));
    const retry = await invoke('create', original);
    assert.equal(retry.code, 200);
    assert.equal(retry.body.data.duplicate, true);
    const transport = createCheckoutTransport(db);
    // A fresh recovery worker after checkout (or process restart) needs no
    // current owner/cashier authority to reconcile an already committed sale.
    await db
      .collection('users')
      .updateMany({ _id: { $in: [cashier._id, owner._id] } }, { $set: { activate: false } });
    const { createDecisionRecovery } = require('../src/services/business-decision-recovery');
    await createDecisionRecovery(db).tick();
    const applied = await db
      .collection('business_decisions')
      .findOne({ _id: new ObjectId(row.id) });
    assert.equal(applied.state, 'applied');
    const recovered = await db
      .collection('business_decision_local')
      .findOne({ action: 'claim', 'body.requestId': row.id });
    assert.equal(recovered.executionState, 'applied');
    assert.equal(recovered.recoveryStatus, 'confirmed');
    await createDecisionRecovery(db).tick();
    await assert.rejects(
      transport.start(
        {
          branchId: String(branchId),
          requesterId: String(cashier._id),
          requestId: row.id,
          revisionHash: row.revisionHash,
        },
        payload.billing_transaction_id
      ),
      { code: 'decision_reconciliation_required' }
    );
    assert.equal(await db.collection('sales').countDocuments({ license }), 1);
    const denied = { ...cashier, authVersion: 0 };
    await assert.rejects(checkout.read(context, denied, row.id), { code: 'cashier_access_denied' });
    await db.collection('users').updateOne({ _id: cashier._id }, { $set: { branch_access: [] } });
    await assert.rejects(checkout.read(context, cashier, row.id), {
      code: 'cashier_access_denied',
    });
  } finally {
    for (const key of flags) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
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
