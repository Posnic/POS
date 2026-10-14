const { test } = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../frontend/static/script/js/core/shelf-labels');
const { quote } = require('../api/src/services/shelf-label-pricing');
const base = { paper: 'a4', width: 63, height: 33, margin: 5, gap: 2, start: 1 };

test('A4 fits 24 labels and rejects impossible dimensions and starting slots', () => {
    const g = labels.geometry(base);
    assert.deepEqual([g.columns, g.rows, g.capacity], [3, 8, 24]);
    assert.throws(() => labels.geometry({ ...base, width: 220 }), /do not fit/);
    assert.throws(() => labels.geometry({ ...base, gap: NaN }), /valid/);
    assert.throws(() => labels.geometry({ ...base, start: 25 }), /Starting position/);
});
test('copy runs continue across sheets and a partly used sheet starts at the chosen slot', () => {
    const entries = [{ item: 'A', copies: 25 }, { item: 'B', copies: 2 }];
    const g = labels.geometry({ ...base, start: 3 });
    const first = labels.slots(entries, g, 0, 1, 27);
    assert.deepEqual(first.cells.slice(0, 4), [null, null, 'A', 'A']);
    assert.equal(first.pages, 2);
    assert.deepEqual(labels.slots(entries, g, 1, 1, 27).cells.slice(0, 6), ['A', 'A', 'A', 'B', 'B', null]);
});
test('later print batches preserve the correct product and never materialize an entire catalogue', () => {
    const entries = [{ item: 'A', copies: 999 }, { item: 'B', copies: 999 }, { item: 'C', copies: 5 }];
    const result = labels.slots(entries, labels.geometry(base), 0, 1999, 2000);
    assert.equal(result.amount, 5);
    assert.equal(result.total, 2003);
    assert.deepEqual(result.cells.slice(0, 6), ['C', 'C', 'C', 'C', 'C', null]);
    assert.throws(() => labels.slots(entries, labels.geometry(base), 0, 1, 2001), /2,000/);
    assert.throws(() => labels.count([{ copies: 0 }]), /Copies/);
});
test('roll paper has one label per page and ignores A4 starting slots', () => {
    const g = labels.geometry({ ...base, paper: 'roll', start: 20 });
    assert.equal(g.capacity, 1);
    assert.equal(g.start, 1);
    assert.equal(labels.slots([{ item: 'A', copies: 3 }], g, 2, 1, 3).cells[0], 'A');
});
test('label prices include VAT and discounts; unknown or variable prices are blocked', () => {
    const p = { _id: 'product', name: 'Item', selling_price: 2, tax: 20, tax_type: 'exclusive', discount_amount: 0.5 };
    assert.equal(quote(p, { currency: 'GBP' }).label_price, 1.8);
    assert.equal(quote({ ...p, selling_price: 2.4, tax_type: 'inclusive', discount_amount: 0, discount_percentage: 25 }, { currency: 'GBP' }).label_price, 1.8);
    assert.equal(quote({ ...p, open_price: true }, { currency: 'GBP' }).label_price, null);
    assert.equal(quote({ ...p, tax: 'invalid' }, { currency: 'GBP' }).label_price, null);
    assert.equal(quote({ ...p, tax: 0, selling_price: 150, discount_amount: 0 }, { currency: 'JPY' }).label_currency_digits, 0);
});
test('preview and print sheet CSS retains physical size and styling without extra pages', () => {
    const s = { ...base, font: 'Arial', fontSize: 10, align: 'right', ink: '#123456', background: '#eeeeee', guides: true };
    const css = labels.css(s, labels.geometry(s));
    assert.match(css, /size:A4;margin:0/);
    assert.match(css, /grid-template-columns:repeat\(3,63mm\)/);
    assert.match(css, /font-family:Arial;font-size:10px;text-align:right/);
    assert.match(css, /\.sl-sheet:last-child\{break-after:auto\}/);
});
