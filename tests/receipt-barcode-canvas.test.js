'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const core = read('frontend/static/script/js/core/PosnicPro.js');

function till(format = 'standard', barcode = true) {
    const thermal = read('api/src/json/print_standard_html.txt');
    const a4 = read('api/src/json/print_a4html.txt');
    const dom = new JSDOM('<div class="print-modal-body">' + thermal + '</div><div class="print-modal-a4-body">' + a4 + '</div>', { runScripts: 'outside-only' });
    const w = dom.window, $ = require('jquery')(w);
    w.$ = w.jQuery = $;
    // Exercise the actual barcode plugin, with only the canvas raster API stubbed.
    const draws = [], prints = [], warnings = [];
    w.HTMLCanvasElement.prototype.getContext = function () {
        const canvas = this;
        return {
            clearRect() { canvas.printedValue = ''; }, fillRect() {},
            measureText(value) { return { width: value.length * 5 }; },
            fillText(value) { canvas.printedValue = value; draws.push(value); }
        };
    };
    w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,' + this.printedValue; };
    w.console.warn = message => warnings.push(message);
    w.eval(read('frontend/static/script/js/newjavascript.js'));
    w.eval(read('frontend/static/script/js/jquery.number.min.js'));
    const settings = { currencySign: 'Rs.', printing_size: 'receipt_medium', printing_max_char: '40', gst_action: 'disable', print_type: format };
    const p = w.PosnicPro = {
        sales: {}, measuredUnits: ['kg'], BRAND_URL: 'https://www.posnic.com',
        local: { get: key => settings[key] || '' }, i18n: { t: (_key, fallback) => fallback },
        escapeHtml: value => $('<i>').text(value).html(),
        printView: (content, image) => prints.push({ content, image, format: p._printTypeOverride || format }),
        alert: (_type, message) => assert.fail(message)
    };
    for (const key of ['printBarcode', 'isMeasuredUnit', 'formatQuantity', 'removeDuplicates', 'textOverflowPrintEllipsis', 'nestedTaxCalculation', 'toggleVisibility']) {
        const start = core.indexOf('    ' + key + ': function');
        const end = core.indexOf('\n    },', start);
        w.eval('PosnicPro.' + key + ' = ' + core.slice(core.indexOf('function', start), end + 6) + ';');
    }
    w.print_type = { value: format };
    w.eval(read('api/src/helpers/sale-payment-summary.js'));
    w.eval(read('api/src/helpers/receipt-design.js'));
    const source = read('frontend/static/script/js/modules/js/sales_view.js');
    w.eval(source.slice(0, source.indexOf('\n};') + 3));
    const item = { item_name: 'Rice', item_price: 125, item_quantity: 2, item_unit: 'kg', item_discount: 0, item_discount_percentage: 0, total_amount: 250, tax: 0, tax_fields: [], igst_tax: 0, cgst_tax: 0, item_total_amount: 250, item_tax: 0, item_tax_fields: [], item_igst_tax: 0, item_cgst_tax: 0, itemsTotalAmount: 250 };
    const data = { sales_id: 'SALE-1', sale_process: 'Sales', created_date: '10/11/2026', branch_name: 'Test Shop', items: [item], items_return: [], items_subtotal: 250, items_total: 250, tax: 0, discount: 0, receipt_barcode: barcode, return_id: 'RETURN-1', date: '10/11/2026' };
    p.get = (params, done) => done({ type: 'success', data: typeof params === 'object' ? { custom_data: data, return_data: [item] } : data });
    return { dom, w, $, p, data, draws, prints, warnings };
}

for (const format of ['standard', 'a4']) {
    for (const returns of [false, true]) {
        for (const enabled of [false, true]) {
            test(`${format} ${returns ? 'return' : 'sale'} barcode ${enabled ? 'on' : 'off'} prints without a canvas, then after late mounting`, () => {
                const s = till(format, enabled);
                try {
                    s.$('#canvasTarget, #barcodeValue').remove();
                    if (!enabled) s.p.printBarcode = () => assert.fail('Disabled barcode renderer was called');
                    const print = () => returns ? s.p.sales.view.returnPrintSales('id') : s.p.sales.view.printSale('id', 'sale');
                    print();
                    assert.equal(s.prints.length, 1);
                    assert.match(s.prints[0].content, /Rice/);
                    assert.match(s.prints[0].content, /250/);
                    assert.equal(s.prints[0].image, enabled ? 'data:image/png;base64,SALE-1' : '');
                    assert.equal(s.prints[0].format, format);
                    assert.equal(s.w.document.querySelectorAll('#canvasTarget').length, 0, 'Fallback must not leak a global canvas');
                    s.$('body').append('<input id="barcodeValue" value="STALE-ID"><canvas id="canvasTarget"></canvas>');
                    s.data.sales_id = 'SALE-2';
                    print();
                    assert.equal(s.prints.length, 2);
                    assert.equal(s.prints[1].image, enabled ? 'data:image/png;base64,SALE-2' : '');
                    assert.equal(s.prints[1].format, format);
                    assert.deepEqual(s.warnings, []);
                    assert.deepEqual(s.draws, enabled ? ['SALE-1', 'SALE-2'] : []);
                } finally { s.dom.window.close(); }
            });
        }
    }
}

test('enabled, disabled and enabled reprints do not reuse a previous barcode or paper override', () => {
    const s = till();
    try {
        s.p.sales.view.printSale('id', 'sale', false, 'a4');
        s.data.receipt_barcode = false;
        s.p.sales.view.printSale('id', 'sale');
        s.data.receipt_barcode = true;
        s.data.sales_id = 'SALE-3';
        s.p.sales.view.printSale('id', 'sale');
        assert.deepEqual(s.prints.map(p => p.image), ['data:image/png;base64,SALE-1', '', 'data:image/png;base64,SALE-3']);
        assert.deepEqual(s.prints.map(p => p.format), ['a4', 'standard', 'standard']);
        assert.equal(s.p._printTypeOverride, null);
        assert.equal(s.p.sales.view._layoutOverride, null);
    } finally { s.dom.window.close(); }
});

for (const failure of ['missing plugin', 'missing context', 'context error', 'serialization error', 'invalid target', 'invalid barcode', 'missing sale ID']) {
    test(`${failure} does not abort the receipt or reuse stale image data`, () => {
        const s = till();
        try {
            s.$('body').append('<input id="barcodeValue" value="STALE-ID"><canvas id="canvasTarget"></canvas>');
            s.p.sales.view.printSale('id', 'sale');
            switch (failure) {
                case 'missing plugin': delete s.$.fn.barcode; break;
                case 'missing context': s.w.HTMLCanvasElement.prototype.getContext = () => null; break;
                case 'context error': s.w.HTMLCanvasElement.prototype.getContext = () => { throw Error('Context unavailable'); }; break;
                case 'serialization error': s.w.HTMLCanvasElement.prototype.toDataURL = () => { throw Error('SecurityError'); }; break;
                case 'invalid target': s.$('#canvasTarget').replaceWith('<div id="canvasTarget"></div>'); break;
                case 'invalid barcode': s.data.sales_id = 'தமிழ்'; break;
                case 'missing sale ID': delete s.data.sales_id; break;
            }
            s.p.sales.view.printSale('id', 'sale');
            assert.equal(s.prints.length, 2);
            assert.equal(s.prints[1].image, '');
            assert.match(s.prints[1].content, /Rice/);
        } finally { s.dom.window.close(); }
    });
}

test('legacy no-argument callers still render the existing visible canvas', () => {
    const s = till();
    try {
        s.$('#canvasTarget, #barcodeValue').remove();
        s.$('body').append('<input id="barcodeValue" value="LEGACY-1"><canvas id="canvasTarget"></canvas>');
        assert.equal(s.p.printBarcode(), 'data:image/png;base64,LEGACY-1');
        assert.equal(s.w.document.getElementById('canvasTarget').printedValue, 'LEGACY-1');
    } finally { s.dom.window.close(); }
});

test('ordinary sales still route to the receipt designer without touching legacy barcode rendering', () => {
    const s = till();
    try {
        const calls = [];
        s.p.receiptDesigner = { printSale: (...args) => calls.push(args) };
        s.p.printBarcode = () => assert.fail('Designer print entered legacy barcode path');
        s.p.sales.view.printSale('id', 'sale', false, 'a4');
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], s.data);
        assert.equal(calls[0][1], 'a4');
        assert.equal(s.prints.length, 0);
        assert.equal(s.p._printTypeOverride, null);
    } finally { s.dom.window.close(); }
});

for (const value of ['', undefined, 'தமிழ்']) {
    test(`legacy invalid input ${String(value)} clears a previous visible barcode`, () => {
        const s = till();
        try {
            s.$('#canvasTarget, #barcodeValue').remove();
            s.$('body').append('<input id="barcodeValue" value="LEGACY-1"><canvas id="canvasTarget"></canvas>');
            s.p.printBarcode();
            if (value === undefined) s.$('#barcodeValue').remove();
            else s.$('#barcodeValue').val(value);
            assert.equal(s.p.printBarcode(), '');
            assert.equal(s.w.document.getElementById('canvasTarget').printedValue, '');
        } finally { s.dom.window.close(); }
    });
}

test('legacy missing plugin clears a previous visible barcode', () => {
    const s = till();
    try {
        s.$('#canvasTarget, #barcodeValue').remove();
        s.$('body').append('<input id="barcodeValue" value="LEGACY-1"><canvas id="canvasTarget"></canvas>');
        s.p.printBarcode();
        delete s.$.fn.barcode;
        assert.equal(s.p.printBarcode(), '');
        assert.equal(s.w.document.getElementById('canvasTarget').printedValue, '');
    } finally { s.dom.window.close(); }
});
