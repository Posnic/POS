'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { startPayment, pollPayment } = require('../src/services/dojo-payment-journal');
let mongo, client, db;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); db = client.db('dojo'); });
after(async () => { await client?.close(); await mongo?.stop(); });
function fixture() {
  const scope = { license: new ObjectId(), branchId: new ObjectId() };
  const quote = { paymentId: 'host-payment-1', valueMinor: 1050, currencyCode: 'GBP',
    terminalId: 'tm_test', configurationId: 'merchant-config-1' };
  const calls = { intents: 0, sessions: 0 };
  let intent;
  const session = { id: 'ts_test', terminalId: 'tm_test', status: 'Captured',
    details: { sessionType: 'Sale', sale: { paymentIntentId: 'pi_test' } } };
  const provider = { environment: 'sandbox',
    createIntent: async row => { calls.intents++; intent = { id: 'pi_test', captureMode: 'Auto', status: 'Captured',
      reference: row.reference, amount: { value: row.valueMinor, currencyCode: 'GBP' },
      totalAmount: { value: row.valueMinor, currencyCode: 'GBP' } }; return intent; },
    createSession: async () => { calls.sessions++; return session; },
    getSession: async () => session, getIntent: async () => intent,
  };
  return { scope, quote, provider, calls, session };
}
test('concurrent starts issue one intent and session; polling verifies capture and scope', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 12 }, () => startPayment(db, f.scope, f.quote, f.provider)));
  assert.deepEqual(f.calls, { intents: 1, sessions: 1 });
  assert.equal((await pollPayment(db, f.scope, f.quote.paymentId, f.quote.configurationId, f.provider)).status, 'captured');
  await startPayment(db, f.scope, f.quote, f.provider);
  assert.deepEqual(f.calls, { intents: 1, sessions: 1 });
  await assert.rejects(startPayment(db, f.scope, { ...f.quote, valueMinor: 1 }, f.provider), /payment_conflict/);
  await assert.rejects(pollPayment(db, { ...f.scope, branchId: new ObjectId() }, f.quote.paymentId, f.quote.configurationId, f.provider), /payment_unavailable/);
  await assert.rejects(pollPayment(db, f.scope, f.quote.paymentId, 'other-config', f.provider), /payment_unavailable/);
});
test('lost intent response stays unresolved across retries, without another payment request', async () => {
  const f = fixture();
  f.provider.createIntent = async () => { f.calls.intents++; throw Error('lost response'); };
  await assert.rejects(startPayment(db, f.scope, f.quote, f.provider), /lost response/);
  assert.equal((await startPayment(db, f.scope, f.quote, f.provider)).status, 'creating-intent');
  assert.equal(f.calls.intents, 1);
  await assert.rejects(pollPayment(db, f.scope, f.quote.paymentId, f.quote.configurationId, f.provider), /reconciliation_required/);
});
test('lost session response cannot trigger a second terminal charge', async () => {
  const f = fixture();
  f.provider.createSession = async () => { f.calls.sessions++; throw Error('lost response'); };
  await assert.rejects(startPayment(db, f.scope, f.quote, f.provider), /lost response/);
  assert.equal((await startPayment(db, f.scope, f.quote, f.provider)).status, 'creating-session');
  assert.deepEqual(f.calls, { intents: 1, sessions: 1 });
});
test('expired session is uncertain and mismatch never creates a capture receipt', async () => {
  const f = fixture();
  await startPayment(db, f.scope, f.quote, f.provider);
  f.session.status = 'Expired';
  const getIntent = f.provider.getIntent;
  f.provider.getIntent = async () => ({ ...await getIntent(), status: 'Created' });
  assert.equal((await pollPayment(db, f.scope, f.quote.paymentId, f.quote.configurationId, f.provider)).status, 'reconciliation-required');
  f.provider.getIntent = async () => ({ ...await getIntent(), reference: 'wrong-payment' });
  await assert.rejects(pollPayment(db, f.scope, f.quote.paymentId, f.quote.configurationId, f.provider), /payment_mismatch/);
});
