'use strict';
const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const { verifySale } = require('./dojo-client');
const fail = code => { const error = new Error(code); error.code = code; error.status = 409; throw error; };
const hash = value => createHash('sha256').update(value).digest('hex');
function identity(scope, paymentId) {
  if (!/^[a-f\d]{24}$/i.test(String(scope?.license)) ||
      !/^[a-f\d]{24}$/i.test(String(scope?.branchId)) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(paymentId || '')) fail('dojo_scope_invalid');
  return { _id: hash(`${scope.license}:${scope.branchId}:${paymentId}`),
    license: new ObjectId(String(scope.license)), branch_id: new ObjectId(String(scope.branchId)) };
}
const publicResult = row => ({ id: row._id, status: row.status,
  paymentIntentId: row.paymentIntentId || null, sessionId: row.sessionId || null });
// Internal host service, not a public amount-taking endpoint. The caller supplies
// an immutable core quote and must reserve its payment lane before invoking it.
// No undocumented provider idempotency guarantee is assumed: an interrupted POST
// remains locked for reconciliation; retries never create another terminal sale.
async function startPayment(db, scope, quote, provider) {
  const key = identity(scope, quote.paymentId);
  if (!Number.isSafeInteger(quote.valueMinor) || quote.valueMinor <= 0 || quote.currencyCode !== 'GBP' ||
      !/^tm_[A-Za-z0-9_-]{1,180}$/.test(quote.terminalId || '') ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(quote.configurationId || '') ||
      !['sandbox', 'production'].includes(provider.environment)) fail('dojo_quote_invalid');
  const binding = { valueMinor: quote.valueMinor, currencyCode: quote.currencyCode,
    terminalId: quote.terminalId, configurationId: quote.configurationId, environment: provider.environment };
  const digest = hash(JSON.stringify(binding));
  const collection = db.collection('dojo_payment_operations');
  try { await collection.insertOne({ ...key, ...binding, digest, reference: 'POS-' + key._id.slice(0, 48),
    status: 'new', createdAt: new Date() }); }
  catch (error) { if (error.code !== 11000) throw error; }
  let row = await collection.findOne(key);
  if (row.digest !== digest) fail('dojo_payment_conflict');
  if (row.status === 'new') {
    const claimed = await collection.updateOne({ ...key, status: 'new' }, { $set: { status: 'creating-intent' } });
    if (claimed.modifiedCount === 1) {
      const intent = await provider.createIntent(row);
      if (!/^pi_[A-Za-z0-9_-]{1,180}$/.test(intent?.id || '') ||
          intent.reference !== row.reference || intent.amount?.value !== row.valueMinor ||
          intent.amount?.currencyCode !== row.currencyCode || intent.captureMode !== 'Auto') fail('dojo_payment_mismatch');
      await collection.updateOne({ ...key, status: 'creating-intent' },
        { $set: { paymentIntentId: intent.id, status: 'intent-created' } });
    }
    row = await collection.findOne(key);
  }
  if (row.status === 'intent-created') {
    const claimed = await collection.updateOne({ ...key, status: 'intent-created' }, { $set: { status: 'creating-session' } });
    if (claimed.modifiedCount === 1) {
      const session = await provider.createSession(row.terminalId, row.paymentIntentId);
      if (!/^ts_[A-Za-z0-9_-]{1,180}$/.test(session?.id || '') ||
          session.terminalId !== row.terminalId || session.details?.sale?.paymentIntentId !== row.paymentIntentId ||
          session.details?.sessionType !== 'Sale') fail('dojo_payment_mismatch');
      await collection.updateOne({ ...key, status: 'creating-session' },
        { $set: { sessionId: session.id, status: 'pending' } });
    }
    row = await collection.findOne(key);
  }
  return publicResult(row);
}
async function pollPayment(db, scope, paymentId, configurationId, provider) {
  const key = identity(scope, paymentId);
  const collection = db.collection('dojo_payment_operations');
  const row = await collection.findOne(key);
  if (!row || row.configurationId !== configurationId || row.environment !== provider.environment)
    fail('dojo_payment_unavailable');
  if (row.status === 'captured') return publicResult(row);
  if (!row.sessionId || !row.paymentIntentId) fail('dojo_reconciliation_required');
  const session = await provider.getSession(row.sessionId);
  const intent = await provider.getIntent(row.paymentIntentId);
  const status = verifySale(intent, session, row);
  // A stale pending poll cannot overwrite a later confirmed capture.
  await collection.updateOne({ ...key, status: { $ne: 'captured' } },
    { $set: { status, checkedAt: new Date(), ...(status === 'captured' ? { capturedAt: new Date() } : {}) } });
  return publicResult(await collection.findOne(key));
}
module.exports = { startPayment, pollPayment };
