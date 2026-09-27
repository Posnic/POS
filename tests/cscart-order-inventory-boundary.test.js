'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'cscart');

function readFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(FIXTURES_DIR, 'order-inventory.json'),
      'utf8',
    ),
  );
}

test('CS-Cart fixture covers order and inventory mapping', () => {
  const fixture = readFixture();

  assert.strictEqual(fixture.provider, 'cscart');
  assert.strictEqual(fixture.order.order_id, 'SYNTH-CSCART-ORD-1001');
  assert.strictEqual(fixture.order.status, 'O');
  assert.strictEqual(
    fixture.order.products['SYNTH-CSCART-PROD-1001'].amount,
    '3',
  );

  assert.strictEqual(
    fixture.inventory.product_id,
    'SYNTH-CSCART-PROD-1001',
  );
  assert.strictEqual(fixture.inventory.amount, '12');

  assert.strictEqual(fixture.expected.channel, 'CSCART');
  assert.strictEqual(fixture.expected.order_import, true);
  assert.strictEqual(fixture.expected.inventory_update, true);
  assert.strictEqual(fixture.expected.review, false);
});

test('CS-Cart fixture contains only synthetic identifiers', () => {
  const fixture = readFixture();

  assert.match(fixture.order.order_id, /^SYNTH-CSCART-ORD-\d+$/);
  assert.match(
    fixture.inventory.product_id,
    /^SYNTH-CSCART-PROD-\d+$/,
  );

  for (const productId of Object.keys(fixture.order.products)) {
    assert.match(productId, /^SYNTH-CSCART-PROD-\d+$/);
  }
});

test('CS-Cart research documents the integration boundary', () => {
  const documentation = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'docs',
      'integrations',
      'cscart-order-inventory-boundary.md',
    ),
    'utf8',
  );

  assert.match(documentation, /REST API/i);
  assert.match(documentation, /authentication/i);
  assert.match(documentation, /Orders API/i);
  assert.match(documentation, /Products API/i);
  assert.match(documentation, /Shipments REST entity/i);
  assert.match(documentation, /inventory/i);
  assert.match(documentation, /public outbound webhook/i);
  assert.match(documentation, /synthetic fixture/i);
  assert.match(documentation, /Unsupported areas/i);
});
