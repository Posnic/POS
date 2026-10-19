'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_REQUEST = 768 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const fail = (code, status = 403) => {
  throw Object.assign(new Error(code), { code, status });
};

// Operations are declared by the signed package. Transport destinations and
// secrets are provisioned by the operator, never by a package or browser.
function connectorOperations(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('extension_connector_contract_invalid', 422);
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 64) fail('extension_connector_contract_invalid', 422);
  const result = Object.create(null);
  for (const [name, permissions] of entries) {
    if (
      !/^[a-z][a-zA-Z0-9.-]{1,79}$/.test(name) ||
      !Array.isArray(permissions) ||
      !permissions.length ||
      permissions.length > 3 ||
      permissions.some((p) => !['read', 'write', 'manage'].includes(p))
    )
      fail('extension_connector_contract_invalid', 422);
    result[name] = Object.freeze([...new Set(['read', ...permissions])]);
  }
  return Object.freeze(result);
}

async function configuration() {
  const filename = process.env.POSNIC_EXTENSION_CONNECTORS_FILE;
  if (!filename || !path.isAbsolute(filename)) fail('extension_connector_unavailable', 503);
  const stat = await fs.stat(filename);
  if (stat.size > 128 * 1024) fail('extension_connector_configuration_invalid', 503);
  const entries = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (!Array.isArray(entries) || entries.length > 256)
    fail('extension_connector_configuration_invalid', 503);
  return entries;
}

async function requestConnector({
  descriptor,
  scope,
  actor,
  input,
  load = configuration,
  fetcher = fetch,
}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !['operation', 'payload'].includes(k)) ||
    typeof input.operation !== 'string' ||
    !Object.hasOwn(descriptor.connectorOperations || {}, input.operation)
  )
    fail('extension_connector_operation_forbidden');
  const permissions = descriptor.connectorOperations[input.operation];
  if (!permissions.every((p) => actor.permissions?.includes(p)))
    fail('extension_connector_permission_denied');
  const license = String(scope.license),
    branchId = String(scope.branchId);
  if (![license, branchId, actor.userId].every((v) => /^[a-f0-9]{24}$/.test(v || '')))
    fail('extension_connector_scope_invalid');
  const grants = (await load()).filter(
    (grant) =>
      grant.enabled === true &&
      grant.extensionId === descriptor.id &&
      grant.license === license &&
      grant.branchId === branchId &&
      grant.packageDigest === descriptor.packageDigest
  );
  if (grants.length !== 1) fail('extension_connector_not_provisioned', 503);
  const grant = grants[0];
  // A connector is a separately supervised local service, not a general HTTP
  // proxy. Remote service access belongs inside that isolated connector.
  let endpoint;
  try {
    endpoint = new URL(grant.endpoint);
  } catch {
    fail('extension_connector_configuration_invalid', 503);
  }
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/v1/requests' ||
    !path.isAbsolute(grant.secretFile || '')
  )
    fail('extension_connector_configuration_invalid', 503);
  const secret = await fs.readFile(grant.secretFile);
  if (secret.length < 32 || secret.length > 256)
    fail('extension_connector_configuration_invalid', 503);
  const body = JSON.stringify({
    protocol: 1,
    requestId: crypto.randomUUID(),
    issuedAt: Date.now(),
    extensionId: descriptor.id,
    packageDigest: descriptor.packageDigest,
    scope: { license, branchId },
    actor: { userId: actor.userId, permissions: [...actor.permissions] },
    operation: input.operation,
    payload: input.payload ?? {},
  });
  if (Buffer.byteLength(body) > MAX_REQUEST) fail('extension_connector_request_too_large', 413);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(endpoint.href, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-posnic-signature': signature },
      body,
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json'))
      fail('extension_connector_failed', 502);
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE)
      fail('extension_connector_response_too_large', 502);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_RESPONSE) {
        controller.abort();
        fail('extension_connector_response_too_large', 502);
      }
      chunks.push(Buffer.from(chunk));
    }
    let result;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail('extension_connector_invalid_response', 502);
    }
    if (
      !result ||
      result.requestId !== JSON.parse(body).requestId ||
      !Object.hasOwn(result, 'result')
    )
      fail('extension_connector_invalid_response', 502);
    return result.result;
  } catch (error) {
    if (error.code?.startsWith('extension_connector_')) throw error;
    fail('extension_connector_unavailable', 503);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { connectorOperations, requestConnector, MAX_REQUEST, MAX_RESPONSE };
