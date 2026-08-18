'use strict';
/*
 * The ONE line-tax engine (TAX_INTERNATIONALIZATION_ROADMAP T1).
 *
 * This algorithm exists today in six places - sale.service.js:357-551 (the
 * canonical copy this file extracts VERBATIM), sale.model's recalc path,
 * receiving_add's partial, and three copies in the frontend's sales.js.
 * Consolidation happens one call site at a time, each behind the parity
 * tests in tests/unit/services/tax-engine.test.js: the vectors pin this
 * exact behaviour, and a swapped site must keep the full suite green.
 *
 * NOTHING here is new math. Six branches, exactly as the field has proven
 * them: (discount-amount|discount-percent|none) x (exclusive|inclusive),
 * plus the legacy fallback where a rate-less line carries a GST amount.
 * The one deliberate asymmetry is preserved too: the per-line stored tax
 * is rounded to 2dp while the header sum keeps full precision - the
 * research doc documents why changing that is a per-shop opt-in (T4),
 * never a side effect of refactoring.
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Compute one sale line's money, exactly as sale.service always has.
 *
 * @param {object} line
 * @param {number} line.itemAmount        sellingPrice * quantity
 * @param {number} line.sellingPrice      unit price as sent
 * @param {number} line.itemQuantity
 * @param {number} line.itemTax           percentage rate (0 = none)
 * @param {string} line.taxType           'exclusive' | 'inclusive' | ''
 * @param {number} line.discountAmount    per-unit discount amount
 * @param {number} line.discountPercentage
 * @param {number} [line.gstAmount]       legacy per-line GST amount fallback
 * @returns {{ total:number, tax:number, taxForItem:number, discount:number,
 *             subtotal:number, effectiveTax:number, effectiveTaxType:string }}
 */
function computeLineTax(line) {
  const itemAmount = Number(line.itemAmount) || 0;
  const sellingPrice = Number(line.sellingPrice) || 0;
  const itemQuantity = Number(line.itemQuantity) || 0;
  const itemTax = Number(line.itemTax) || 0;
  const taxType = line.taxType || '';
  const discountAmount = Number(line.discountAmount) || 0;
  const discountPercentage = Number(line.discountPercentage) || 0;
  const gstAmount = Number(line.gstAmount) || 0;

  let total = 0;
  let tax = 0;
  let taxForItem = 0;
  let discount = 0;
  let subtotal = 0;
  let effectiveTax = itemTax;
  let effectiveTaxType = taxType;

  if (discountAmount > 0 && itemTax > 0) {
    const itemDiscountAmountMultiple = discountAmount * itemQuantity;
    let subTotal = itemAmount - itemDiscountAmountMultiple;
    if (taxType === 'exclusive') {
      tax = (subTotal / 100) * itemTax;
      total = subTotal + tax;
      discount = itemDiscountAmountMultiple;
      subtotal = subTotal + itemDiscountAmountMultiple;
      taxForItem = round2(tax);
    } else {
      const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
      const tax_itemprice = sellingPrice - tax_price;
      const tax_discount_multiple = tax_itemprice * itemQuantity;
      const tax_quantity_multiple = tax_discount_multiple - itemDiscountAmountMultiple;
      total = tax_quantity_multiple + (tax_quantity_multiple / 100) * itemTax;
      subTotal = tax_quantity_multiple;
      tax = (subTotal / 100) * itemTax;
      discount = itemDiscountAmountMultiple;
      subtotal = subTotal + itemDiscountAmountMultiple;
      taxForItem = round2(tax);
    }
  } else if (discountPercentage > 0 && itemTax > 0) {
    const itemTaxTotalCalculation = itemAmount - itemAmount * (discountPercentage / 100);
    if (taxType === 'exclusive') {
      total = itemTaxTotalCalculation + (itemTaxTotalCalculation / 100) * itemTax;
      tax = (itemTaxTotalCalculation / 100) * itemTax;
      discount = itemAmount * (discountPercentage / 100);
      subtotal = itemTaxTotalCalculation + discount;
      taxForItem = round2(tax);
    } else {
      total = itemTaxTotalCalculation;
      const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
      const tax_itemprice = sellingPrice - tax_price;
      const tax_discount_multiple = tax_itemprice * itemQuantity;
      discount = tax_discount_multiple * (discountPercentage / 100);
      const tax_quantity_multiple = tax_discount_multiple - discount;
      tax = (tax_quantity_multiple / 100) * itemTax;
      subtotal = tax_quantity_multiple + discount;
      taxForItem = round2(tax);
    }
  } else if (itemTax > 0) {
    if (taxType === 'exclusive') {
      total = itemAmount + (itemAmount / 100) * itemTax;
      tax = (itemAmount / 100) * itemTax;
      discount = 0;
      subtotal = itemAmount;
      taxForItem = round2(tax);
    } else {
      total = itemAmount;
      const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
      const tax_itemprice = sellingPrice - tax_price;
      const tax_quantity_multiple = tax_itemprice * itemQuantity;
      tax = (tax_quantity_multiple / 100) * itemTax;
      discount = 0;
      subtotal = tax_quantity_multiple;
      taxForItem = round2(tax);
    }
  } else if (discountAmount > 0) {
    const itemDiscountAmountMultiple = discountAmount * itemQuantity;
    total = itemAmount - itemDiscountAmountMultiple;
    tax = 0;
    discount = itemDiscountAmountMultiple;
    subtotal = itemAmount;
    taxForItem = 0;
  } else if (discountPercentage > 0) {
    const itemTaxTotalCalculation = itemAmount - itemAmount * (discountPercentage / 100);
    total = itemTaxTotalCalculation;
    if (itemTax <= 0 && gstAmount > 0) {
      // Legacy inclusive fallback: reconstruct from the sent GST amount.
      const discountFactor = discountPercentage / 100;
      const lineTotal = itemTaxTotalCalculation;
      const afterDiscountBeforeTax = lineTotal - gstAmount;
      let baseBeforeDiscount = afterDiscountBeforeTax;
      if (discountFactor < 1) {
        baseBeforeDiscount = afterDiscountBeforeTax / (1 - discountFactor);
      }
      tax = gstAmount;
      taxForItem = round2(gstAmount);
      discount = baseBeforeDiscount * discountFactor;
      subtotal = baseBeforeDiscount;
      if (afterDiscountBeforeTax !== 0) {
        effectiveTax = round2((gstAmount / afterDiscountBeforeTax) * 100);
      }
      effectiveTaxType = 'inclusive';
    } else {
      tax = 0;
      taxForItem = 0;
      discount = itemAmount * (discountPercentage / 100);
      subtotal = itemAmount;
    }
  } else {
    total = itemAmount;
    tax = 0;
    taxForItem = 0;
    discount = 0;
    subtotal = itemAmount;
  }

  return { total, tax, taxForItem, discount, subtotal, effectiveTax, effectiveTaxType };
}

module.exports = { computeLineTax, round2 };
