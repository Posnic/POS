'use strict';
// First-party transport only. Never expose the key or provider response bodies
// to extension frames, logs, or the renderer. Journalling belongs to the caller.
const VERSION = '2026-02-27';
function fail(code, status = 409) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}
function id(value, prefix) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,180}$`).test(value))
    fail('dojo_identifier_invalid', 422);
  return value;
}
function amount(value, currencyCode) {
  if (!Number.isSafeInteger(value) || value <= 0 || currencyCode !== 'GBP')
    fail('dojo_amount_invalid', 422);
  return { value, currencyCode };
}
function createDojoClient(config, { transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!config || !['sandbox', 'production'].includes(config.environment) ||
      typeof config.apiKey !== 'string' ||
      !new RegExp(`^sk_${config.environment === 'sandbox' ? 'sandbox' : 'prod'}_[A-Za-z0-9_-]+$`).test(config.apiKey) ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(config.softwareHouseId || '') ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(config.resellerId || '')) fail('dojo_configuration_invalid', 422);
  async function request(method, path, body, terminal = false) {
    let response;
    try {
      response = await transport('https://api.dojo.tech' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: 'Basic ' + config.apiKey, version: VERSION,
          Accept: 'application/json', 'Content-Type': 'application/json',
          ...(terminal ? { 'software-house-id': config.softwareHouseId, 'reseller-id': config.resellerId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { fail('dojo_connection_outcome_unknown', 502); }
    if (!response.ok) {
      // Do not infer "not charged" from a transport error or an HTTP error.
      fail(response.status === 401 || response.status === 403 ? 'dojo_credentials_rejected' : 'dojo_request_failed', 502);
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { fail('dojo_response_invalid', 502); }
  }
  return Object.freeze({
    environment: config.environment,
    listTerminals: () => request('GET', '/terminals?statuses=Available', undefined, true),
    createIntent: ({ valueMinor, currencyCode, reference }) => {
      if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(reference))
        fail('dojo_reference_invalid', 422);
      return request('POST', '/payment-intents', { amount: amount(valueMinor, currencyCode),
        reference, captureMode: 'Auto', paymentMethods: ['Card'] });
    },
    getIntent: paymentIntentId => request('GET', '/payment-intents/' + id(paymentIntentId, 'pi')),
    createSession: (terminalId, paymentIntentId) => request('POST', '/terminal-sessions', {
      terminalId: id(terminalId, 'tm'), details: { sessionType: 'Sale', sale: { paymentIntentId: id(paymentIntentId, 'pi') } },
    }, true),
    getSession: sessionId => request('GET', '/terminal-sessions/' + id(sessionId, 'ts'), undefined, true),
    cancelSession: sessionId => request('PUT', '/terminal-sessions/' + id(sessionId, 'ts') + '/cancel', undefined, true),
    signature: (sessionId, accepted) => {
      if (typeof accepted !== 'boolean') fail('dojo_signature_decision_required', 422);
      return request('PUT', '/terminal-sessions/' + id(sessionId, 'ts') + '/signature', { accepted }, true);
    },
    refund: (paymentIntentId, valueMinor) => request('POST', '/payment-intents/' + id(paymentIntentId, 'pi') + '/refunds', {
      amount: amount(valueMinor, 'GBP').value, refundReason: 'Customer refund',
    }),
  });
}
// A successful terminal display alone cannot authorize a Posnic sale.
function verifySale(intent, session, expected) {
  if (!intent || !session || intent.id !== expected.paymentIntentId || session.id !== expected.sessionId ||
      session.terminalId !== expected.terminalId || session.details?.sessionType !== 'Sale' ||
      session.details?.sale?.paymentIntentId !== expected.paymentIntentId ||
      intent.reference !== expected.reference || intent.captureMode !== 'Auto' ||
      intent.amount?.value !== expected.valueMinor || intent.amount?.currencyCode !== expected.currencyCode ||
      intent.totalAmount?.value !== expected.valueMinor || intent.totalAmount?.currencyCode !== expected.currencyCode ||
      (intent.refundedAmount ?? 0) !== 0) fail('dojo_payment_mismatch');
  if (intent.status === 'Captured' && session.status === 'Captured') return 'captured';
  if (intent.status === 'Captured') return 'reconciliation-required';
  if (session.status === 'SignatureVerificationRequired') return 'signature-required';
  // Expiry is uncertain per Dojo's checklist. Never free stock or retry a charge.
  if (session.status === 'Expired') return 'reconciliation-required';
  if (['Declined', 'Canceled', 'SignatureVerificationRejected'].includes(session.status)) return 'not-completed';
  return 'pending';
}
module.exports = { createDojoClient, verifySale, VERSION };
