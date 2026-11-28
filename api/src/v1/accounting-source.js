'use strict';
const { createHash } = require('node:crypto');
const fail = () => { throw Object.assign(new Error('Unsupported accounting source'), { code: 'accounting_source_unsupported' }); };
const scalar = value => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && Buffer.byteLength(value) <= 65536) return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (value?._bsontype === 'ObjectId' && typeof value.toHexString === 'function' && /^[a-f0-9]{24}$/.test(value.toHexString())) return value.toHexString();
  return fail();
};
function identity(value) {
  if (value?._bsontype === 'ObjectId') return { kind: 'objectId', value: scalar(value) };
  if (typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)) return { kind: 'string', value };
  return fail();
}
function pick(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const result = {};
  for (const key of fields) if (Object.hasOwn(value, key)) result[key] = scalar(value[key]);
  return result;
}
const HEADER = '_id license branch_id sales_id invoice_id sales_date created_date updated_date sale_process sales_total sales_subtotal subtotal paid_amount payment_pending balance tax items_total items_return_total items_return_subtotal return_tax return_discount sale_extra_discount coupon_discount_value loyalty_redeem_value sales_round_off round_off tip_amount tip_in_total wallet_amount currencyCode currencyDigits source_invoice_id'.split(' ');
const LINE = '_id item name item_name quantity qty price item_price selling_price total total_amount subtotal tax tax_amount tax_rate discount discount_type discount_amount return_quantity returned_quantity'.split(' ');
const PAYMENT = 'id at method amount date created_date created_at reference return_obj_id return_id'.split(' ');
function rows(value, select) {
  if (!Array.isArray(value) || value.length > 1000) return fail();
  return value.map(select);
}
const tender = value => pick(value, ['method', 'amount']);
function payment(value) {
  const result = pick(value, PAYMENT);
  for (const key of ['tenders', 'before', 'after']) if (Object.hasOwn(value, key)) result[key] = rows(value[key], tender);
  return result;
}
function line(value) {
  const result = pick(value, LINE);
  if (Object.hasOwn(value, 'pricing')) {
    result.pricing = pick(value.pricing, ['version']);
    if (Object.hasOwn(value.pricing, 'currency')) result.pricing.currency = pick(value.pricing.currency, ['currencyCode', 'currencyDigits']);
  }
  return result;
}
// A snapshot of selected stored evidence, not an assertion that a payment is
// immutable, settled, or eligible for posting. No default money/currency values.
function exportSale(sale, license) {
  if (typeof license !== 'string' || !license || license.length > 256 || scalar(sale?.license) !== license) return fail();
  const sourceId = identity(sale._id), values = pick(sale, HEADER);
  for (const [key, select] of Object.entries({ items: line, charges: row => pick(row, ['name', 'amount', 'tax_amount', 'taxed', 'tax_rate']), payments: payment, captain_payments: payment, payment_corrections: payment, return_refund_transactions: payment })) {
    if (Object.hasOwn(sale, key)) values[key] = rows(sale[key], select);
  }
  const customerReferences = { version: 1, customerId: sale.customer_id == null ? null : identity(sale.customer_id), legacyCustomer: sale.customer == null ? null : identity(sale.customer) };
  const sourceJson = JSON.stringify({ schema: 'posnic.sale-source.v1', sourceId, customerReferences, values });
  if (Buffer.byteLength(sourceJson) > 256 * 1024) return fail();
  return { sourceId, revision: createHash('sha256').update(sourceJson).digest('hex'), sourceJson };
}
const projection = Object.fromEntries([...HEADER, 'customer_id', 'customer', 'items', 'charges', 'payments', 'captain_payments', 'payment_corrections', 'return_refund_transactions'].map(key => [key, 1]));
module.exports = { exportSale, identity, projection };
