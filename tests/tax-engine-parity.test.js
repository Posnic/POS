/*
 * Cross-repo tax engine parity (TAX ROADMAP T1).
 *
 * The api engine and its frontend port must answer IDENTICALLY - the same
 * vectors run through both files, every output field compared exactly.
 * Edit one without the other and this goes red; that is the whole guard
 * that lets the frontend's three former copies die.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const api = require('../api/src/services/tax-engine');
const fe = require('../frontend/static/script/js/core/tax-engine');

const VECTORS = [];
for (const taxType of ['exclusive', 'inclusive']) {
  for (const itemTax of [0, 5, 12, 18, 28, 3.5]) {
    for (const disc of [
      { discountAmount: 0, discountPercentage: 0 },
      { discountAmount: 10, discountPercentage: 0 },
      { discountAmount: 0, discountPercentage: 10 },
      { discountAmount: 2.5, discountPercentage: 0 },
      { discountAmount: 0, discountPercentage: 33.33 },
    ]) {
      for (const qty of [1, 3, 0.75]) {
        VECTORS.push({
          sellingPrice: 199.99,
          itemQuantity: qty,
          itemAmount: 199.99 * qty,
          itemTax,
          taxType,
          gstAmount: 0,
          ...disc,
        });
      }
    }
  }
}
// The legacy GST-amount fallback shapes.
VECTORS.push(
  { sellingPrice: 100, itemQuantity: 2, itemAmount: 200, itemTax: 0, taxType: '', discountAmount: 0, discountPercentage: 10, gstAmount: 5.28 },
  { sellingPrice: 50, itemQuantity: 1, itemAmount: 50, itemTax: 0, taxType: '', discountAmount: 0, discountPercentage: 100, gstAmount: 1 }
);

test(`api engine and frontend port agree on every field across ${VECTORS.length} vectors`, () => {
  for (const v of VECTORS) {
    const a = api.computeLineTax(v);
    const f = fe.computeLineTax(v);
    assert.deepStrictEqual(f, a, 'divergence on vector ' + JSON.stringify(v));
  }
});

test('both engines expose the same surface', () => {
  assert.deepStrictEqual(Object.keys(fe).sort(), Object.keys(api).sort());
  assert.strictEqual(fe.round2(30.505), api.round2(30.505));
});
