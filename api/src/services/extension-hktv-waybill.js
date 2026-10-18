'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const namespace = require('./extension-namespace');
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
function identity(order) {
  return JSON.stringify([order.key, order.orderId, order.trackingId, order.status, order.commercialHash]);
}
async function provider({ db, scope }) {
  const root = process.env.POSNIC_HKTV_CONNECTOR_ROOT;
  if (!root || !path.isAbsolute(root)) fail('hktv_cloud_connection_required', 503);
  const config = JSON.parse(await fs.readFile(path.join(root, 'private/config.json'), 'utf8'));
  if (config.tenantDb !== db.databaseName || config.license !== String(scope.license) || config.branchId !== String(scope.branchId)) fail('hktv_connection_scope_mismatch', 403);
  const { HktvReader } = require(path.join(root, 'src/hktv.cjs'));
  return new HktvReader({ storeCode: config.storeCode, uuid: config.uuid, privateKey: await fs.readFile(config.privateKeyFile) });
}
async function readWaybill({ db, scope, descriptor, actor, input, readState = namespace.readNamespace, getProvider = provider }) {
  if (descriptor.id !== 'posnic.hktvmall-gogox' || !actor.permissions.includes('read')) fail('hktv_waybill_forbidden', 403);
  if (!input || Object.keys(input).some(k => !['orderKey', 'paperSize'].includes(k)) || !/^[a-f0-9]{64}$/.test(input.orderKey || '') || !['A5', 'LABEL_WAYBILL_ONLY', 'LABEL_WITH_SKU_LIST'].includes(input.paperSize)) fail('hktv_waybill_input_invalid', 422);
  const before = await readState(db, scope, descriptor, actor);
  const order = (before.state.orders || []).find(o => o.key === input.orderKey);
  if (before.busy || !order || !order.trackingId || !['CONFIRMED', 'ACKNOWLEDGED', 'PICKED'].includes(order.status) || order.reviewStatus === 'changed-order') fail('hktv_waybill_order_unavailable');
  const reader = await getProvider({ db, scope });
  if (reader.storeCode !== before.state.storeCode) fail('hktv_connection_store_mismatch', 403);
  const result = await reader.printWaybills([order], input.paperSize);
  if (result?.code !== 'success' || typeof result.data !== 'string' || !/<html[\s>]/i.test(result.data) || Buffer.byteLength(result.data) > 2 * 1024 * 1024) fail('hktv_waybill_response_invalid', 502);
  const after = await readState(db, scope, descriptor, actor);
  const latest = (after.state.orders || []).find(o => o.key === order.key);
  if (after.busy || !latest || identity(latest) !== identity(order)) fail('hktv_waybill_changed_refresh_required');
  return { title: 'HKTVmall original waybill', html: result.data, orderId: order.orderId, trackingId: order.trackingId, sha256: crypto.createHash('sha256').update(result.data).digest('hex') };
}
module.exports = { readWaybill };
