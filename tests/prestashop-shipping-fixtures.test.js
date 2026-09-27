'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'prestashop');

function readFixture() {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'shipping-statuses.json'), 'utf8'),
  );
}

test('PrestaShop shipping fixture covers carrier and tracking metadata', () => {
  const fixture = readFixture();

  const shipped = fixture.orders.find(
    (order) => order.externalOrderId === 'SYNTH-PS-ORD-1001',
  );

  assert.ok(shipped);
  assert.strictEqual(shipped.carrier.id, 12);
  assert.strictEqual(shipped.carrier.name, 'Synthetic Carrier');
  assert.strictEqual(shipped.order_carrier.tracking_number, 'SYNTH-TRACK-1001');
  assert.strictEqual(shipped.expected.shipping_metadata.shipping_state, 'SHIPPED');
  assert.strictEqual(shipped.expected.review, false);
});

test('PrestaShop shipping fixture covers cancellation without inventing tracking data', () => {
  const fixture = readFixture();

  const cancelled = fixture.orders.find(
    (order) => order.externalOrderId === 'SYNTH-PS-ORD-1002',
  );

  assert.ok(cancelled);
  assert.strictEqual(cancelled.current_state.name, 'Cancelled');
  assert.strictEqual(cancelled.order_carrier.tracking_number, '');
  assert.strictEqual(cancelled.expected.shipping_metadata.tracking_reference, null);
  assert.strictEqual(cancelled.expected.shipping_metadata.shipping_state, 'CANCELLED');
  assert.strictEqual(cancelled.expected.review, false);
});

test('unsupported PrestaShop order state requires manual review', () => {
  const fixture = readFixture();

  const unsupported = fixture.orders.find(
    (order) => order.externalOrderId === 'SYNTH-PS-ORD-1003',
  );

  assert.ok(unsupported);
  assert.strictEqual(unsupported.expected.shipping_metadata.shipping_state, null);
  assert.strictEqual(unsupported.expected.review, true);
  assert.strictEqual(
    unsupported.expected.review_reason,
    'UNSUPPORTED_PRESTASHOP_ORDER_STATE',
  );
});

test('PrestaShop shipping fixtures contain only synthetic identifiers', () => {
  const fixture = readFixture();

  for (const order of fixture.orders) {
    assert.match(order.externalOrderId, /^SYNTH-PS-ORD-\d+$/);
    assert.match(order.carrier.name, /^Synthetic /);

    if (order.order_carrier.tracking_number) {
      assert.match(order.order_carrier.tracking_number, /^SYNTH-TRACK-\d+$/);
    }
  }
});

test('PrestaShop shipping mapping documentation covers the fixture boundary', () => {
  const documentation = fs.readFileSync(
    path.join(FIXTURES_DIR, 'EXPECTED_MAPPING.md'),
    'utf8',
  );

  assert.match(documentation, /orders\.current_state/);
  assert.match(documentation, /order_carriers\.tracking_number/);
  assert.match(documentation, /shipping_state/);
  assert.match(documentation, /UNSUPPORTED_PRESTASHOP_ORDER_STATE/);
  assert.match(documentation, /manual review/i);
});
test('PrestaShop shipping mapping documents the channel boundary', () => {
  const documentation = fs.readFileSync(
    path.join(FIXTURES_DIR, 'EXPECTED_MAPPING.md'),
    'utf8',
  );

  assert.match(documentation, /Posnic channel mapping/);
  assert.match(documentation, /channel = PRESTASHOP/);
});
