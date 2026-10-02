'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDojoClient, verifySale } = require('../src/services/dojo-client');
const config = { environment: 'sandbox', apiKey: 'sk_sandbox_test', softwareHouseId: 'test-house', resellerId: 'test-reseller' };
test('Dojo uses pinned HTTPS/version, literal Basic key and terminal routing headers', async () => {
  const calls = [];
  const client = createDojoClient(config, { transport: async (url, options) => {
    calls.push({ url, ...options }); return { ok: true, status: 200, json: async () => ({ id: 'test' }) };
  } });
  await client.createIntent({ valueMinor: 1050, currencyCode: 'GBP', reference: 'POS-123' });
  await client.createSession('tm_test', 'pi_test');
  await client.signature('ts_test', false);
  await client.cancelSession('ts_test');
  await client.refund('pi_test', 100);
  assert.equal(calls[0].url, 'https://api.dojo.tech/payment-intents');
  assert.equal(calls[0].headers.Authorization, 'Basic sk_sandbox_test');
  assert.equal(calls[0].headers.version, '2026-02-27');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(JSON.parse(calls[0].body).amount.value, 1050);
  assert.equal(calls[1].headers['software-house-id'], 'test-house');
  assert.equal(JSON.parse(calls[1].body).details.sessionType, 'Sale');
  assert.deepEqual(JSON.parse(calls[2].body), { accepted: false });
  assert.equal(calls[3].method, 'PUT');
  assert.equal(JSON.parse(calls[4].body).amount, 100);
});
test('Dojo rejects key/environment mismatch, invalid paths and automatic signature acceptance', () => {
  assert.throws(() => createDojoClient({ ...config, environment: 'production' }), /configuration_invalid/);
  const client = createDojoClient(config);
  assert.throws(() => client.getIntent('../secret'), /identifier_invalid/);
  assert.throws(() => client.signature('ts_test'), /decision_required/);
  assert.throws(() => client.createIntent({ valueMinor: 1.1, currencyCode: 'GBP', reference: 'ref' }), /amount_invalid/);
});
test('network and provider errors are redacted and never silently retried', async () => {
  let calls = 0;
  const client = createDojoClient(config, { transport: async () => { calls++; throw Error(config.apiKey); } });
  await assert.rejects(client.createSession('tm_test', 'pi_test'), { message: 'dojo_connection_outcome_unknown' });
  assert.equal(calls, 1);
  const denied = createDojoClient(config, { transport: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(denied.getIntent('pi_test'), { message: 'dojo_credentials_rejected' });
});
test('only matching captured terminal AND intent with exact amount authorize a sale', () => {
  const expected = { paymentIntentId: 'pi_test', sessionId: 'ts_test', terminalId: 'tm_test',
    valueMinor: 1050, currencyCode: 'GBP', reference: 'POS-123' };
  const intent = { id: 'pi_test', reference: 'POS-123', captureMode: 'Auto', status: 'Captured',
    amount: { value: 1050, currencyCode: 'GBP' }, totalAmount: { value: 1050, currencyCode: 'GBP' }, refundedAmount: 0 };
  const session = { id: 'ts_test', terminalId: 'tm_test', status: 'Captured',
    details: { sessionType: 'Sale', sale: { paymentIntentId: 'pi_test' } } };
  assert.equal(verifySale(intent, session, expected), 'captured');
  assert.equal(verifySale({ ...intent, status: 'Authorized' }, session, expected), 'pending');
  assert.equal(verifySale({ ...intent, status: 'Created' }, { ...session, status: 'Expired' }, expected), 'reconciliation-required');
  assert.equal(verifySale({ ...intent, status: 'Created' }, { ...session, status: 'SignatureVerificationRequired' }, expected), 'signature-required');
  for (const changed of [{ reference: 'other' }, { refundedAmount: 1 }, { totalAmount: { value: 1051, currencyCode: 'GBP' } }])
    assert.throws(() => verifySale({ ...intent, ...changed }, session, expected), /payment_mismatch/);
  assert.throws(() => verifySale(intent, { ...session, terminalId: 'tm_other' }, expected), /payment_mismatch/);
});
