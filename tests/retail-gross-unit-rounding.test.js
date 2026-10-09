"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../api/src/services/pricing-authority");
const engines = [
  require("../api/src/services/tax-engine"),
  require("../frontend/static/script/js/core/tax-engine"),
];
test("gross-unit retail prices multiply the displayed penny value, with opt-in only", () => {
  for (const engine of engines) {
    const line = {
      sellingPrice: 0.83,
      itemAmount: 1.66,
      itemQuantity: 2,
      itemTax: 20,
      taxType: "exclusive",
    };
    assert.equal(engine.round2(engine.computeLineTax(line).total), 1.99);
    assert.equal(
      engine.round2(
        engine.computeLineTax({ ...line, roundGrossUnit: true }).total,
      ),
      2,
    );
    assert.equal(
      engine.round2(
        engine.computeLineTax({
          ...line,
          roundGrossUnit: true,
          discountPercentage: 10,
        }).total,
      ),
      1.8,
    );
    assert.equal(
      engine.round2(
        engine.computeLineTax({
          ...line,
          roundGrossUnit: true,
          itemQuantity: 8,
        }).total,
      ),
      8,
    );
  }
});
test("catalogue and override snapshots preserve the same gross-unit totals at confirmation", () => {
  const product = {
    _id: "item",
    name: "One pound item",
    selling_price: 0.83,
    tax: 20,
    tax_type: "exclusive",
  };
  const snapshot = pricing.resolve({
    product,
    branch: { currency: "GBP" },
    roundGrossUnit: true,
  });
  const amount = pricing.calculate(snapshot, 2);
  assert.equal(amount.total_amount, 2);
  for (const price of [1, 1.3, 20]) {
    const entered = pricing.resolve({
      product,
      branch: { currency: "GBP" },
      submitted: price / 1.2,
      allowCounterPriceOverride: true,
      roundGrossUnit: true,
    });
    assert.equal(pricing.calculate(entered, 2).total_amount, price * 2);
    const restored = pricing.resolve({
      product,
      previous: { pricing: entered },
      submitted: entered.selling_price,
    });
    assert.equal(pricing.calculate(restored, 2).total_amount, price * 2);
  }
});
