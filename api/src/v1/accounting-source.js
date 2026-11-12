'use strict';

const { createHash } = require('node:crypto');

// This read contract captures saved source values. Accounting interpretation
// belongs to the connector's explicit mappings and reconciliation.
const projection = {
  _id: 1, license: 1, branch_id: 1, sales_id: 1, updated_date: 1,
  date: 1, created_date: 1, sale_process: 1, payment_status: 1,
  currencyCode: 1, currencyDigits: 1,
  sales_total: 1, sales_sub_total: 1, items_total: 1,
  items_subtotal: 1, items_return_total: 1, items_return_subtotal: 1,
  sales_round_off: 1, round_off: 1, return_round_off: 1,
  paid_amount: 1, balance: 1, payment_mode: 1, payment_pending: 1,
  partial_check: 1, partial_balance: 1, tax: 1, return_tax: 1,
  discount: 1, return_discount: 1, source_invoice_id: 1,
  'items.item_id': 1, 'items.item_quantity': 1, 'items.total_amount': 1,
  'items.tax': 1, 'items.tax_type': 1, 'items.tax_amount': 1,
  'items.pricing.version': 1,
  'items.pricing.currency.currencyCode': 1,
  'items.pricing.currency.currencyDigits': 1
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function exportSale(doc) {
  const sourceId = {
    kind: doc._id?._bsontype === 'ObjectId' ? 'objectId' : 'string',
    value: String(doc._id)
  };
  const payload = canonical(JSON.parse(JSON.stringify(doc)));
  const sourceJson = JSON.stringify({ schema: 'posnic.sale-source.v1', sourceId, values: payload });
  return {
    sourceId, sourceJson,
    revision: createHash('sha256').update(sourceJson, 'utf8').digest('hex')
  };
}

module.exports = { projection, exportSale };
