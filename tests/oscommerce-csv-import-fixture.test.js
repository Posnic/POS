'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  buildSaleImportEnvelope,
  evaluateIdempotency,
  IDEMPOTENCY_OUTCOMES,
} = require('../connectors/sdk/external-sale-idempotency');

const DIR = path.join(__dirname, 'fixtures', 'oscommerce');

function readCsv(name) {
  const lines = fs
    .readFileSync(path.join(DIR, name), 'utf8')
    .split(/\r\n|\n/)
    .filter((line) => line.trim());

  const headers = lines[0].split(',').map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i];
    });
    return obj;
  });

  return { headers, rows };
}

function groupOrders(rows) {
  const grouped = {};
  for (const row of rows) {
    const id = row['Order ID'];
    if (!grouped[id]) {
      grouped[id] = {
        orderId: id,
        date: row['Order Date'],
        currency: row['Currency'],
        status: row['Order Status'],
        customerName: row['Customer Name'],
        customerEmail: row['Customer Email'],
        items: [],
      };
    }
    grouped[id].items.push({
      sku: row['SKU'],
      name: row['Product Name'],
      quantity: row['Quantity'],
      unitPrice: row['Unit Price'],
    });
  }
  return Object.values(grouped);
}

test('osCommerce CSV fixture multi-line order maps to a single external sale payload', () => {
  const csv = readCsv('orders.csv');
  const grouped = groupOrders(csv.rows);

  const order5001 = grouped.find((o) => o.orderId === 'SYNTH-OSC-5001');
  assert.ok(order5001, 'Order SYNTH-OSC-5001 must exist');
  assert.strictEqual(
    order5001.items.length,
    2,
    'SYNTH-OSC-5001 must group its two CSV rows into two line items'
  );
  assert.strictEqual(order5001.items[0].sku, 'SYNTH-OSC-SKU-001');
  assert.strictEqual(order5001.items[1].sku, 'SYNTH-OSC-SKU-002');
});

test('duplicate external order id does not create a second POS sale (idempotency)', () => {
  const csv = readCsv('orders.csv');
  const grouped = groupOrders(csv.rows);
  const order = grouped.find((o) => o.orderId === 'SYNTH-OSC-5001');

  // Build a standard import envelope from the grouped CSV payload
  const envelope = buildSaleImportEnvelope({
    provider: 'oscommerce_csv',
    store: 'default_store',
    externalOrderId: order.orderId,
    payload: order,
  });

  // Simulate an existing database record from the first import
  const existingRecord = {
    saleId: 'pos_sale_rec_999',
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    payload: order,
  };

  // Evaluate the identical envelope simulating a duplicate retry
  const evalResult = evaluateIdempotency({
    existingRecord,
    incomingEnvelope: envelope,
  });

  // Assert the contract: exact payload retry yields RETURN_EXISTING
  assert.strictEqual(evalResult.outcome, IDEMPOTENCY_OUTCOMES.DUPLICATE_RETRY);
  assert.strictEqual(evalResult.action, 'RETURN_EXISTING');
});

test('fixture covers missing SKU and invalid amount errors', () => {
  const csv = readCsv('invalid-orders.csv');

  // We test the invalid data structure directly without inventing a non-existent
  // validation mapper, since no existing application validation contract for
  // osCommerce CSVs currently exists.

  // Row 1: missing SKU (empty string)
  assert.strictEqual(csv.rows[0]['Order ID'], 'SYNTH-OSC-BAD-1');
  assert.strictEqual(csv.rows[0]['SKU'], '');

  // Row 2: negative Unit Price
  assert.strictEqual(csv.rows[1]['Order ID'], 'SYNTH-OSC-BAD-2');
  assert.strictEqual(csv.rows[1]['Unit Price'], '-120.00');

  // Row 3: non-numeric Unit Price
  assert.strictEqual(csv.rows[2]['Order ID'], 'SYNTH-OSC-BAD-3');
  assert.strictEqual(csv.rows[2]['Unit Price'], 'not_a_number');
});

test('osCommerce fixture documentation describes the integration boundary', () => {
  const documentation = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');

  assert.match(documentation, /Required columns/i);
  assert.match(documentation, /Validation errors/i);
  assert.match(documentation, /API integration versus CSV fallback/i);
  assert.match(documentation, /Live osCommerce database connections/i);
});
