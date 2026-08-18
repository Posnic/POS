/*
 * The ONE line-tax engine - frontend port (TAX ROADMAP T1).
 *
 * A faithful mirror of api/src/services/tax-engine.js, kept honest by
 * POS/tests/tax-engine-parity.test.js, which runs the same vectors through
 * BOTH files and requires identical answers - edit one without the other
 * and CI goes red. The sales screen's three former copies and the
 * receiving screen's partial all call this instead of carrying their own
 * arithmetic.
 *
 * UMD-ish on purpose: the browser gets window.PosnicTaxEngine, the parity
 * test require()s the same file.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PosnicTaxEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function round2(value) {
        return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }

    function computeLineTax(line) {
        var itemAmount = Number(line.itemAmount) || 0;
        var sellingPrice = Number(line.sellingPrice) || 0;
        var itemQuantity = Number(line.itemQuantity) || 0;
        var itemTax = Number(line.itemTax) || 0;
        var taxType = line.taxType || '';
        var discountAmount = Number(line.discountAmount) || 0;
        var discountPercentage = Number(line.discountPercentage) || 0;
        var gstAmount = Number(line.gstAmount) || 0;

        var total = 0;
        var tax = 0;
        var taxForItem = 0;
        var discount = 0;
        var subtotal = 0;
        var effectiveTax = itemTax;
        var effectiveTaxType = taxType;

        var tax_price, tax_itemprice, tax_discount_multiple, tax_quantity_multiple;

        if (discountAmount > 0 && itemTax > 0) {
            var itemDiscountAmountMultiple = discountAmount * itemQuantity;
            var subTotal = itemAmount - itemDiscountAmountMultiple;
            if (taxType === 'exclusive') {
                tax = (subTotal / 100) * itemTax;
                total = subTotal + tax;
                discount = itemDiscountAmountMultiple;
                subtotal = subTotal + itemDiscountAmountMultiple;
                taxForItem = round2(tax);
            } else {
                tax_price = (sellingPrice * itemTax) / (100 + itemTax);
                tax_itemprice = sellingPrice - tax_price;
                tax_discount_multiple = tax_itemprice * itemQuantity;
                tax_quantity_multiple = tax_discount_multiple - itemDiscountAmountMultiple;
                total = tax_quantity_multiple + (tax_quantity_multiple / 100) * itemTax;
                subTotal = tax_quantity_multiple;
                tax = (subTotal / 100) * itemTax;
                discount = itemDiscountAmountMultiple;
                subtotal = subTotal + itemDiscountAmountMultiple;
                taxForItem = round2(tax);
            }
        } else if (discountPercentage > 0 && itemTax > 0) {
            var itemTaxTotalCalculation = itemAmount - itemAmount * (discountPercentage / 100);
            if (taxType === 'exclusive') {
                total = itemTaxTotalCalculation + (itemTaxTotalCalculation / 100) * itemTax;
                tax = (itemTaxTotalCalculation / 100) * itemTax;
                discount = itemAmount * (discountPercentage / 100);
                subtotal = itemTaxTotalCalculation + discount;
                taxForItem = round2(tax);
            } else {
                total = itemTaxTotalCalculation;
                tax_price = (sellingPrice * itemTax) / (100 + itemTax);
                tax_itemprice = sellingPrice - tax_price;
                tax_discount_multiple = tax_itemprice * itemQuantity;
                discount = tax_discount_multiple * (discountPercentage / 100);
                tax_quantity_multiple = tax_discount_multiple - discount;
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
                tax_price = (sellingPrice * itemTax) / (100 + itemTax);
                tax_itemprice = sellingPrice - tax_price;
                tax_quantity_multiple = tax_itemprice * itemQuantity;
                tax = (tax_quantity_multiple / 100) * itemTax;
                discount = 0;
                subtotal = tax_quantity_multiple;
                taxForItem = round2(tax);
            }
        } else if (discountAmount > 0) {
            var amtMultiple = discountAmount * itemQuantity;
            total = itemAmount - amtMultiple;
            tax = 0;
            discount = amtMultiple;
            subtotal = itemAmount;
            taxForItem = 0;
        } else if (discountPercentage > 0) {
            var afterPct = itemAmount - itemAmount * (discountPercentage / 100);
            total = afterPct;
            if (itemTax <= 0 && gstAmount > 0) {
                var discountFactor = discountPercentage / 100;
                var afterDiscountBeforeTax = afterPct - gstAmount;
                var baseBeforeDiscount = afterDiscountBeforeTax;
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

        return {
            total: total,
            tax: tax,
            taxForItem: taxForItem,
            discount: discount,
            subtotal: subtotal,
            effectiveTax: effectiveTax,
            effectiveTaxType: effectiveTaxType,
        };
    }

    return { computeLineTax: computeLineTax, round2: round2 };
});
