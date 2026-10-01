'use strict';

// Exercises the three release candidates with synthetic databases and loopback
// HTTP. The transport maps two test HTTPS origins to loopback; this does not
// attest production TLS, provider payments, customer delivery or live deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const intranet = process.env.POSNIC_INTRANET_ROOT;
  const billingRoot = process.env.POSNIC_WEB_API_ROOT;
  if (!intranet || !billingRoot) throw new Error('Set POSNIC_INTRANET_ROOT and POSNIC_WEB_API_ROOT to the release checkouts.');
  const savedEnvironment = { ...process.env };
  const realFetch = global.fetch;
  const memory = await MongoMemoryServer.create();
  const client = await MongoClient.connect(memory.getUri());
  const { MongoClient: ControlClient, ObjectId: ControlId } = require(path.join(billingRoot, 'node_modules/mongodb'));
  const controlClient = await ControlClient.connect(memory.getUri());
  const control = controlClient.db('synthetic_control');
  const shop = client.db('synthetic_cloud_shop');
  const servers = [];
  try {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = memory.getUri(shop.databaseName);
    process.env.ASK_POSNIC_KNOWLEDGE_TOKEN = crypto.randomBytes(24).toString('hex');
    process.env.ASK_POSNIC_BILLING_TOKEN = crypto.randomBytes(24).toString('hex');
    process.env.ASK_POSNIC_KNOWLEDGE_URL = 'https://knowledge.example.test/api/ask-posnic/published-bundle';
    process.env.ASK_POSNIC_BILLING_URL = 'https://billing.example.test/api/managed-ai/entitlement';
    process.env.POSNIC_MANAGED_AI_PROVIDER = 'off';
    process.env.ASK_POSNIC_VECTOR_BUCKET = '';
    const BaseModel = require('../src/models/base.model');
    BaseModel.mongoClient = client;
    BaseModel.database = shop;
    const license = new ObjectId(), branch = new ObjectId(), owner = new ControlId();
    await shop.collection('branches').insertOne({ _id: branch, license, currency: 'USD' });
    const req = { user: { _id: String(owner), license: String(license), branch_id: String(branch), role: 'admin' } };
    const requireAuth = (request, response, next) => {
      if (request.headers['x-synthetic-owner'] !== 'yes') return response.status(401).json({ error: 'unauthorized' });
      request.session = { user: { role: 'admin', email: 'synthetic@example.invalid' } };
      next();
    };
    const knowledgeApp = express(); knowledgeApp.use(express.json());
    await require(path.join(intranet, 'ask-posnic-knowledge')).mount(knowledgeApp, { control, requireAuth, requireAdmin: (_request, _response, next) => next(), audit: async () => {} });
    const billingApp = express(); billingApp.use(express.json());
    require(path.join(billingRoot, 'managed-ai')).mount(billingApp, { db: control, requireAuth, user: async () => ({ _id: owner }), payments: {}, checkoutRateLimit: (_request, response) => response.status(429).json({ error: 'No provider calls in this check.' }) });
    for (const app of [knowledgeApp, billingApp]) servers.push(await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); }));
    const origins = { 'https://knowledge.example.test': `http://127.0.0.1:${servers[0].address().port}`, 'https://billing.example.test': `http://127.0.0.1:${servers[1].address().port}` };
    global.fetch = (address, options) => {
      const url = new URL(address);
      assert.ok(origins[url.origin], 'The contract check must never contact an external service.');
      return realFetch(origins[url.origin] + url.pathname + url.search, options);
    };
    const request = async (route, body, method = 'POST') => {
      const response = await realFetch(origins['https://knowledge.example.test'] + '/api/ask-posnic/' + route, { method, headers: { 'Content-Type': 'application/json', 'x-synthetic-owner': 'yes' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.ok(response.ok, route + ': ' + response.status);
      return response.json();
    };
    const source = await request('knowledge', { title: 'How do I open the synthetic register?', content: 'Open Registers, enter the opening float and confirm.', kind: 'faq', visibility: 'customer' });
    await request('knowledge', { title: 'Private officer note', content: 'This must never reach the shop.', visibility: 'internal' });
    const sync = require('../src/services/ask-posnic-knowledge-sync.service');
    const platform = require('../src/services/ask-posnic-platform.service');
    assert.equal((await sync.sync(req, { force: true })).imported, 0);
    await request(`knowledge/${source._id}/status`, { status: 'review' }, 'PATCH');
    await request(`knowledge/${source._id}/status`, { status: 'published' }, 'PATCH');
    assert.equal((await sync.sync(req, { force: true })).imported, 1);
    const matches = await platform.retrieve(req, source.title);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].text, source.content);
    assert.equal(await shop.collection('ask_posnic_documents').countDocuments({ title: 'Private officer note' }), 0);
    await request(`knowledge/${source._id}/status`, { status: 'retired' }, 'PATCH');
    await sync.sync(req, { force: true });
    assert.deepEqual(await platform.currentMatches(req, matches), []);

    const start = new Date(Date.now() - 60000), end = new Date(Date.now() + 86400000);
    await control.collection('tenants').insertOne({ tenantDb: shop.databaseName });
    await control.collection('subscriptions').insertOne({ userId: owner, tenantDb: shop.databaseName, status: 'active', validUntil: end });
    await control.collection('payment_checkout_attempts').insertOne({ id: 'synthetic_purchase', tenantId: shop.databaseName, productType: 'managed_ai', billingInterval: 'month', amountMinor: 9900, currency: 'INR', aiAllowanceUsdMinor: 100 });
    await control.collection('payment_subscriptions').insertOne({ id: 'synthetic_subscription', checkoutAttemptId: 'synthetic_purchase', tenantId: shop.databaseName, productType: 'managed_ai', status: 'active', currentPeriodStart: start, currentPeriodEnd: end, createdAt: start });
    const entitlement = require('../src/services/managed-ai-entitlement.service');
    const credits = require('../src/services/managed-ai-credits.service');
    const context = { licenseId: String(license), branchId: String(branch) };
    assert.equal((await entitlement.get({ force: true })).active, false, 'Subscription activation without captured money grants nothing.');
    await control.collection('payment_transactions').insertOne({ id: 'synthetic_captured_payment', checkoutAttemptId: 'synthetic_purchase', status: 'paid', amountMinor: 9900, currency: 'INR', paidAt: new Date() });
    assert.equal((await entitlement.get({ force: true })).allowance_minor, 100);
    const account = await credits.ensureAccount(context);
    assert.equal(account.allowance_minor, 100);
    assert.match(account.month, /^billing:/);
    const model = 'global.amazon.nova-2-lite-v1:0';
    const hold = await credits.reserve(context, { feature: 'synthetic_contract', model, promptChars: 100, maxOutputTokens: 100 });
    assert.equal(hold.ok, true);
    await credits.reconcile(context, hold, { model, tokensIn: 30, tokensOut: 20 });
    const used = await credits.ensureAccount(context);
    assert.equal(used.reserved_minor, 0);
    assert.ok(used.used_minor > 0);
    await control.collection('payment_refunds').insertOne({ paymentTransactionId: 'synthetic_captured_payment', status: 'processed' });
    assert.equal((await entitlement.get({ force: true })).active, false);
    assert.equal((await credits.ensureAccount(context)).allowance_minor, 0);
    assert.equal((await credits.reserve(context, { feature: 'after_refund', model, promptChars: 100, maxOutputTokens: 100 })).ok, false);
    assert.equal((await shop.collection(credits.COLLECTION).findOne({ license: String(license), month: account.month })).used_minor, used.used_minor, 'Refunding funding cannot erase incurred spend.');
    console.log('PASS: Intranet review/publication/withdrawal reaches POS; paid billing grants, metering and refund revocation cross service boundaries. Synthetic data only; no provider calls.');
  } finally {
    global.fetch = realFetch;
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([client.close(), controlClient.close()]);
    await memory.stop();
    process.env = savedEnvironment;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
