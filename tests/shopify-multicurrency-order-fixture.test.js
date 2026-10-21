"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fixturePath = path.join(
  __dirname,
  "fixtures",
  "shopify",
  "order-amounts.json",
);

function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

// Convert decimal strings into integer cents to avoid
// floating-point arithmetic errors.
function toCents(amount) {
  assert.match(amount, /^\d+\.\d{2}$/);

  const [whole, fraction] = amount.split(".");
  return Number(whole) * 100 + Number(fraction);
}

function calculatedTotal(amounts, currencySide) {
  return (
    toCents(amounts.subtotal[currencySide]) +
    toCents(amounts.tax[currencySide]) -
    toCents(amounts.discount[currencySide]) +
    toCents(amounts.shipping[currencySide])
  );
}

test("Shopify fixture contains synthetic orders", () => {
  const fixture = readFixture();

  assert.equal(fixture.provider, "shopify");
  assert.equal(fixture.fixture_version, 1);
  assert.equal(fixture.orders.length, 4);

  for (const order of fixture.orders) {
    assert.match(order.id, /^SYNTH-SHOPIFY-ORD-\d{3}$/);
  }
});

test("Shopify fixture covers required currency scenarios", () => {
  const scenarios = readFixture().orders.map((order) => order.scenario);

  assert.deepEqual(scenarios, [
    "same_currency",
    "different_currencies",
    "rounding",
    "currency_mismatch",
  ]);
});

test("Shopify amounts balance in each available currency", () => {
  const { orders } = readFixture();

  for (const order of orders) {
    for (const side of ["shop", "presentment"]) {
      const total = order.amounts.total[side];

      if (total === null) {
        assert.equal(order.expected.review, true);
        continue;
      }

      assert.equal(
        calculatedTotal(order.amounts, side),
        toCents(total),
        `${order.id}: ${side} total does not balance`,
      );
    }
  }
});

test("Posnic sale totals use shop currency amounts", () => {
  const { orders } = readFixture();

  for (const order of orders) {
    if (order.expected.review) {
      assert.equal(order.expected.sale_total, null);
      assert.equal(order.expected.reporting_currency, null);
      continue;
    }

    assert.equal(order.expected.sale_total, order.amounts.total.shop);
    assert.equal(order.expected.reporting_currency, order.shop_currency);
  }
});

test("Different currencies remain separate", () => {
  const order = readFixture().orders.find(
    (item) => item.scenario === "different_currencies",
  );

  assert.equal(order.shop_currency, "EUR");
  assert.equal(order.presentment_currency, "USD");
  assert.equal(order.amounts.total.shop, "116.00");
  assert.equal(order.amounts.total.presentment, "127.60");
});

test("Rounding uses exact decimal cents", () => {
  const order = readFixture().orders.find(
    (item) => item.scenario === "rounding",
  );

  assert.equal(calculatedTotal(order.amounts, "shop"), 2669);
  assert.equal(calculatedTotal(order.amounts, "presentment"), 2920);
});

test("Missing presentment total requires manual review", () => {
  const order = readFixture().orders.find(
    (item) => item.scenario === "currency_mismatch",
  );

  assert.equal(order.amounts.total.presentment, null);
  assert.equal(order.expected.review, true);
  assert.equal(order.expected.reason, "missing_presentment_total");
  assert.equal(order.expected.sale_total, null);
});

test("All currency codes use ISO-style three-letter format", () => {
  for (const order of readFixture().orders) {
    assert.match(order.shop_currency, /^[A-Z]{3}$/);
    assert.match(order.presentment_currency, /^[A-Z]{3}$/);
  }
});
