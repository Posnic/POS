'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  generateIdempotencyKey,
  hashPayload,
  buildSaleImportEnvelope,
  evaluateIdempotency,
  canonicalize,
  IDEMPOTENCY_OUTCOMES,
} = require('../connectors/sdk/external-sale-idempotency');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'external-sales');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

test('STATE 1: first import produces stable operation identity', () => {
  const fixture = readFixture('first-import.json');
  const envelope = buildSaleImportEnvelope(fixture);

  assert.strictEqual(
    envelope.idempotencyKey,
    'posnic:extsale:shopify:store_blr_central:SYNTH-ORD-8801:v1',
    'Generated key must follow the canonical format'
  );
  assert.ok(typeof envelope.payloadHash === 'string' && envelope.payloadHash.length === 64);

  const evalResult = evaluateIdempotency({
    existingRecord: null,
    incomingEnvelope: envelope,
  });

  assert.strictEqual(evalResult.outcome, IDEMPOTENCY_OUTCOMES.NEW_IMPORT);
  assert.strictEqual(evalResult.action, 'PROCEED_CREATE');
});

test('STATE 2: exact retry with identical payload produces identical identity and deduplicates', () => {
  const firstImport = readFixture('first-import.json');
  const exactRetry = readFixture('duplicate-retry.json');

  const envelope1 = buildSaleImportEnvelope(firstImport);
  const envelope2 = buildSaleImportEnvelope(exactRetry);

  // The idempotency key and payload hash must match exactly
  assert.strictEqual(envelope1.idempotencyKey, envelope2.idempotencyKey);
  assert.strictEqual(envelope1.payloadHash, envelope2.payloadHash);

  // Simulating existing record in database
  const existingRecord = {
    saleId: 'pos_sale_rec_1001',
    idempotencyKey: envelope1.idempotencyKey,
    payloadHash: envelope1.payloadHash,
  };

  const evalResult = evaluateIdempotency({
    existingRecord,
    incomingEnvelope: envelope2,
  });

  assert.strictEqual(evalResult.outcome, IDEMPOTENCY_OUTCOMES.DUPLICATE_RETRY);
  assert.strictEqual(evalResult.action, 'RETURN_EXISTING');
  assert.strictEqual(evalResult.saleId, 'pos_sale_rec_1001');
});

test('STATE 3: retry after transient network failure remains deduplicatable across attempt increments', () => {
  const base = readFixture('first-import.json');

  const attempt1 = buildSaleImportEnvelope({ ...base, attempt: 1 });
  const attempt2 = buildSaleImportEnvelope({ ...base, attempt: 2 });
  const attempt5 = buildSaleImportEnvelope({ ...base, attempt: 5 });

  // Key remains stable across retry attempts
  assert.strictEqual(attempt1.idempotencyKey, attempt2.idempotencyKey);
  assert.strictEqual(attempt2.idempotencyKey, attempt5.idempotencyKey);
  assert.strictEqual(attempt1.payloadHash, attempt5.payloadHash);

  const existingRecord = {
    saleId: 'pos_sale_rec_1001',
    idempotencyKey: attempt1.idempotencyKey,
    payloadHash: attempt1.payloadHash,
  };

  const evalResult = evaluateIdempotency({
    existingRecord,
    incomingEnvelope: attempt5,
  });

  assert.strictEqual(evalResult.outcome, IDEMPOTENCY_OUTCOMES.DUPLICATE_RETRY);
  assert.strictEqual(evalResult.action, 'RETURN_EXISTING');
});

test('STATE 4: changed payload for same order triggers conflict and manual review', () => {
  const firstImport = readFixture('first-import.json');
  const changedPayload = readFixture('changed-payload.json');

  const envelope1 = buildSaleImportEnvelope(firstImport);
  const envelope2 = buildSaleImportEnvelope(changedPayload);

  // Same idempotency key, but different payload hash
  assert.strictEqual(envelope1.idempotencyKey, envelope2.idempotencyKey);
  assert.notStrictEqual(envelope1.payloadHash, envelope2.payloadHash);

  const existingRecord = {
    saleId: 'pos_sale_rec_1001',
    idempotencyKey: envelope1.idempotencyKey,
    payloadHash: envelope1.payloadHash,
  };

  const evalResult = evaluateIdempotency({
    existingRecord,
    incomingEnvelope: envelope2,
  });

  assert.strictEqual(evalResult.outcome, IDEMPOTENCY_OUTCOMES.PAYLOAD_MUTATED_CONFLICT);
  assert.strictEqual(evalResult.action, 'HOLD_MANUAL_REVIEW');
  assert.ok(evalResult.recommendation);
});

test('STATE 4b: deliberate order revision with advanced version produces distinct versioned identity', () => {
  const firstImport = readFixture('first-import.json');
  const revisedOrder = {
    ...readFixture('changed-payload.json'),
    version: 2,
  };

  const envelope1 = buildSaleImportEnvelope(firstImport);
  const envelope2 = buildSaleImportEnvelope(revisedOrder);

  assert.strictEqual(envelope1.idempotencyKey, 'posnic:extsale:shopify:store_blr_central:SYNTH-ORD-8801:v1');
  assert.strictEqual(envelope2.idempotencyKey, 'posnic:extsale:shopify:store_blr_central:SYNTH-ORD-8801:v2');
  assert.notStrictEqual(envelope1.idempotencyKey, envelope2.idempotencyKey);
});

test('STATE 5: unrelated order produces isolated identity', () => {
  const orderA = readFixture('first-import.json');
  const orderB = readFixture('unrelated-order.json');

  const envelopeA = buildSaleImportEnvelope(orderA);
  const envelopeB = buildSaleImportEnvelope(orderB);

  assert.notStrictEqual(envelopeA.idempotencyKey, envelopeB.idempotencyKey);
  assert.notStrictEqual(envelopeA.payloadHash, envelopeB.payloadHash);
});

test('STATE 6: different provider or store isolates identity and avoids collisions', () => {
  const base = {
    provider: 'shopify',
    store: 'store_blr_central',
    externalOrderId: 'SYNTH-ORD-8801',
  };

  const keyShopify = generateIdempotencyKey(base);
  const keyWoocommerce = generateIdempotencyKey({ ...base, provider: 'woocommerce' });
  const keyDifferentStore = generateIdempotencyKey({ ...base, store: 'store_mum_central' });

  assert.notStrictEqual(keyShopify, keyWoocommerce);
  assert.notStrictEqual(keyShopify, keyDifferentStore);
  assert.strictEqual(keyWoocommerce, 'posnic:extsale:woocommerce:store_blr_central:SYNTH-ORD-8801:v1');
});

test('deterministic hashing: object key order does not alter payload hash', () => {
  const payload1 = { a: 1, b: { x: 10, y: 20 }, c: [1, 2, 3] };
  const payload2 = { c: [1, 2, 3], b: { y: 20, x: 10 }, a: 1 };

  assert.strictEqual(hashPayload(payload1), hashPayload(payload2));
});

test('input validation: refuses invalid or dangerous tokens', () => {
  assert.throws(() => generateIdempotencyKey({}), /provider must be a non-empty string/);
  assert.throws(() => generateIdempotencyKey({ provider: 'shopify' }), /store must be a non-empty string/);
  assert.throws(
    () => generateIdempotencyKey({ provider: 'shopify', store: 's1' }),
    /externalOrderId must be a non-empty string or number/
  );
  assert.throws(
    () => generateIdempotencyKey({ provider: 'shopify:inject', store: 's1', externalOrderId: '1' }),
    /Invalid provider format/
  );
});

test('documentation fixture check: README covers conflict rules and acceptance criteria', () => {
  const readmeContent = fs.readFileSync(path.join(FIXTURES_DIR, 'README.md'), 'utf8');

  assert.match(readmeContent, /DUPLICATE_RETRY/);
  assert.match(readmeContent, /PAYLOAD_MUTATED_CONFLICT/);
  assert.match(readmeContent, /NEEDS_MANUAL_REVIEW/);
  assert.match(readmeContent, /SYNTH-ORD-\*/);
});
