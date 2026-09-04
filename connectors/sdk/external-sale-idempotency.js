'use strict';

/**
 * External sale idempotency helper (Parent: #34, Issue: #399).
 *
 * Connectors importing external ecommerce sales (Shopify, WooCommerce, Magento,
 * custom carts) can retry after network timeouts or transient 5xx errors.
 * Without stable idempotency semantics, retries risk creating duplicate sales
 * in the local POS database.
 *
 * Core invariants:
 *   1. Stable identity: Retrying the same logical external order with the same
 *      payload must always produce the identical idempotency key, regardless
 *      of network retry attempts.
 *   2. Conflict detection: If an incoming import uses an existing external
 *      order ID but carries a materially different payload (e.g. edited quantities,
 *      discount changes, customer alteration), the connector must receive a
 *      `PAYLOAD_MUTATED_CONFLICT` and flag for manual merchant review instead of
 *      silently overwriting or duplicating the sale.
 *   3. Versioned revisions: If an order modification is intentional, an explicit
 *      logical version can be advanced, producing an isolated versioned key.
 *   4. Namespace safety: Provider and store identifiers are normalized and
 *      delimited with canonical delimiters to prevent cross-tenant/cross-store collisions.
 */

const crypto = require('crypto');

/**
 * Normalized key validation pattern.
 * Allows alphanumeric characters, dashes, and underscores.
 */
const SAFE_TOKEN_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Status outcomes when evaluating an incoming import against an existing sale record.
 */
const IDEMPOTENCY_OUTCOMES = Object.freeze({
  NEW_IMPORT: 'NEW_IMPORT',
  DUPLICATE_RETRY: 'DUPLICATE_RETRY',
  PAYLOAD_MUTATED_CONFLICT: 'PAYLOAD_MUTATED_CONFLICT',
});

/**
 * Sorts object keys recursively to ensure deterministic JSON serialization
 * regardless of key insertion order.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

/**
 * Computes a deterministic SHA-256 digest of a payload.
 *
 * @param {*} payload
 * @returns {string} Hex-encoded SHA-256 digest
 */
function hashPayload(payload) {
  if (payload === undefined || payload === null) {
    return crypto.createHash('sha256').update('').digest('hex');
  }
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Generates a stable idempotency key for an external sale.
 *
 * @param {object} params
 * @param {string} params.provider - E.g. 'shopify', 'woocommerce', 'magento'
 * @param {string} params.store - Store/branch/tenant identifier
 * @param {string} params.externalOrderId - Unique order identifier in the external system
 * @param {number} [params.version=1] - Logical version of the order (incremented on deliberate revisions)
 * @param {number} [params.attempt=1] - Network retry attempt counter (tracked for diagnostic telemetry, but decoupled from logical key)
 * @returns {string} Formatted stable idempotency key
 */
function generateIdempotencyKey({ provider, store, externalOrderId, version = 1, attempt = 1 } = {}) {
  if (!provider || typeof provider !== 'string') {
    throw new TypeError('provider must be a non-empty string');
  }
  if (!store || typeof store !== 'string') {
    throw new TypeError('store must be a non-empty string');
  }
  if (!externalOrderId || (typeof externalOrderId !== 'string' && typeof externalOrderId !== 'number')) {
    throw new TypeError('externalOrderId must be a non-empty string or number');
  }

  const cleanProvider = String(provider).trim().toLowerCase();
  const cleanStore = String(store).trim();
  const cleanOrderId = String(externalOrderId).trim();
  const numVersion = Math.max(1, parseInt(version, 10) || 1);

  // Validate characters to avoid injection or ambiguous key parsing
  if (!SAFE_TOKEN_RE.test(cleanProvider)) {
    throw new Error(`Invalid provider format: "${cleanProvider}"`);
  }
  if (!SAFE_TOKEN_RE.test(cleanStore)) {
    throw new Error(`Invalid store format: "${cleanStore}"`);
  }
  if (!SAFE_TOKEN_RE.test(cleanOrderId)) {
    throw new Error(`Invalid externalOrderId format: "${cleanOrderId}"`);
  }

  return `posnic:extsale:${cleanProvider}:${cleanStore}:${cleanOrderId}:v${numVersion}`;
}

/**
 * Builds a standardized external-sale envelope containing the stable idempotency key,
 * payload digest, and retry metadata.
 *
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.store
 * @param {string} params.externalOrderId
 * @param {*} params.payload - The sale payload (items, totals, customer)
 * @param {number} [params.version=1]
 * @param {number} [params.attempt=1]
 * @returns {object} Import envelope ready for the POS API
 */
function buildSaleImportEnvelope({ provider, store, externalOrderId, payload, version = 1, attempt = 1 } = {}) {
  const idempotencyKey = generateIdempotencyKey({
    provider,
    store,
    externalOrderId,
    version,
    attempt,
  });
  const payloadHash = hashPayload(payload);

  return {
    idempotencyKey,
    provider: String(provider).trim().toLowerCase(),
    store: String(store).trim(),
    externalOrderId: String(externalOrderId).trim(),
    version: Math.max(1, parseInt(version, 10) || 1),
    attempt: Math.max(1, parseInt(attempt, 10) || 1),
    payloadHash,
    payload,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Evaluates an incoming external-sale import against existing records
 * to determine whether it is a fresh import, an exact duplicate retry,
 * or a conflicting mutated payload requiring manual review.
 *
 * @param {object} params
 * @param {object|null} params.existingRecord - Previously stored sale/import record
 * @param {object} params.incomingEnvelope - Result from buildSaleImportEnvelope()
 * @returns {object} { outcome: IDEMPOTENCY_OUTCOMES, action: string, reason?: string }
 */
function evaluateIdempotency({ existingRecord, incomingEnvelope }) {
  if (!incomingEnvelope || !incomingEnvelope.idempotencyKey) {
    throw new TypeError('incomingEnvelope with idempotencyKey is required');
  }

  if (!existingRecord) {
    return {
      outcome: IDEMPOTENCY_OUTCOMES.NEW_IMPORT,
      action: 'PROCEED_CREATE',
    };
  }

  const incomingHash = incomingEnvelope.payloadHash || hashPayload(incomingEnvelope.payload);
  const existingHash = existingRecord.payloadHash || hashPayload(existingRecord.payload);

  if (incomingHash === existingHash) {
    return {
      outcome: IDEMPOTENCY_OUTCOMES.DUPLICATE_RETRY,
      action: 'RETURN_EXISTING',
      saleId: existingRecord.saleId || existingRecord._id || null,
      message: 'Exact retry detected; returning existing sale without duplication.',
    };
  }

  return {
    outcome: IDEMPOTENCY_OUTCOMES.PAYLOAD_MUTATED_CONFLICT,
    action: 'HOLD_MANUAL_REVIEW',
    existingHash,
    incomingHash,
    message: 'External order payload differs from previously recorded sale for the same idempotency key.',
    recommendation: 'Do not automatically overwrite. Prompt merchant for reconciliation or issue a new order version.',
  };
}

module.exports = {
  IDEMPOTENCY_OUTCOMES,
  canonicalize,
  hashPayload,
  generateIdempotencyKey,
  buildSaleImportEnvelope,
  evaluateIdempotency,
};
