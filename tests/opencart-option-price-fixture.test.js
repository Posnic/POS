const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtureDir = path.join(__dirname, 'fixtures', 'opencart');

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureDir, file), 'utf8')
  );
}

test('OpenCart option fixture contains positive and negative price adjustments', () => {
  const fixture = readJson('option-price-adjustments.json');

  const adjustments = fixture.products[0].options.map(
    (option) => option.price_adjustment
  );

  assert.ok(adjustments.includes(5));
  assert.ok(adjustments.includes(-3));
  assert.ok(adjustments.includes(0));
});

test('OpenCart option adjustments produce expected charged prices and totals', () => {
  const fixture = readJson('option-price-adjustments.json');

  for (const order of fixture.orders) {
    const calculatedUnitPrice =
      order.base_price + order.option_adjustment;

    const calculatedSubtotal =
      calculatedUnitPrice * order.quantity;

    assert.equal(
      calculatedUnitPrice,
      order.charged_unit_price
    );

    assert.equal(
      calculatedSubtotal,
      order.line_subtotal
    );

    assert.equal(
      order.expected_pos_line.item_quantity,
      order.quantity
    );

    assert.equal(
      order.expected_pos_line.item_price,
      order.charged_unit_price
    );
  }
});

test('OpenCart fixture preserves discount and tax expectations', () => {
  const fixture = readJson('option-price-adjustments.json');
  const order = fixture.orders.find(
    (item) => item.discount_amount > 0
  );

  assert.ok(order);

  assert.equal(order.discount_amount, 10);
  assert.equal(order.taxable_amount, 100);
  assert.equal(order.tax_amount, 10);
  assert.equal(order.line_total, 110);

  assert.equal(
    order.expected_pos_line.discount_amount,
    order.discount_amount
  );

  assert.equal(
    order.expected_pos_line.tax_amount,
    order.tax_amount
  );
});

test('unsupported OpenCart option combinations are explicitly rejected', () => {
  const fixture = readJson(
    'unsupported-option-combinations.json'
  );

  assert.ok(fixture.unsupported_combinations.length > 0);

  for (const combination of fixture.unsupported_combinations) {
    assert.equal(combination.expected_action, 'reject');
    assert.ok(combination.reason);
  }
});