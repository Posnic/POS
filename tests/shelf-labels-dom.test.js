const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, 'frontend/static/script/js', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(failBulk = false) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'frontend/modules/items.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://labels.example/' });
    const w = dom.window;
    // jsdom lacks canvas text measurement; barcode encoding and SVG rendering remain real.
    w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 6 }) });
    w.eval(script('jquery.min.js'));
    w.eval(script('JsBarcode.all.min.js'));
    const $ = w.jQuery;
    $.fn.modal = function () { this.addClass('show'); return this; };
    const items = Array.from({ length: 30 }, (_, i) => ({ _id: String(i), name: 'Product ' + i, barcode_id: '7622202828256', label_price: 1.75, label_currency_digits: 2 }));
    w.PosnicPro = {
        i18n: { t: (_key, fallback) => fallback },
        local: { get: key => ({ branchname: 'Test Shop', currencySign: '£' })[key] },
        listFilter: { legacyFilters: () => ({ category: 'test' }) }, items: {},
        get: (params, ok, fail) => queueMicrotask(() => {
            if (failBulk && params.data.limit === 100) return fail();
            ok({ type: 'success', data: { list: items, total: 30, total_pages: 1 } });
        })
    };
    let printed;
    w.printJS = options => { printed = options; };
    w.eval(script('core/shelf-labels.js'));
    $('#document_width').val(63 / 25.4); $('#document_height').val(33 / 25.4);
    $('#bar-fontSize').val(10); $('#barcodeLabelType').val('EAN13');
    $('#bar-height').val(30); $('#bar-width').val(1);
    return { dom, w, $, getPrint: () => printed };
}

test('the real designer previews A4, prints the same sheets and restores its layout', async () => {
    const { dom, w, $, getPrint } = setup();
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-paper').val('a4').trigger('change');
    assert.equal($('#sl-preview .sl-label').length, 24, $('#sl-status').text());
    assert.match($('#sl-preview').text(), /£ 1.75/);
    assert.match($('#sl-preview').text(), /Test Shop/);
    assert.equal($('#sl-preview svg').length, 24);
    assert.ok(!$('#sl-preview style').text().includes('@page'));
    w.PosnicShelfLabels.print(false);
    const output = new JSDOM(getPrint().printable);
    assert.equal(output.window.document.querySelectorAll('.sl-sheet').length, 2);
    assert.equal(output.window.document.querySelectorAll('.sl-label').length, 30);
    assert.match(getPrint().style, /size:A4/);
    $('#sl-paper').val('roll');
    w.PosnicShelfLabels.open(); await tick();
    assert.equal($('#sl-paper').val(), 'a4');
    $('#sl-clear').trigger('click');
    assert.equal($('#sl-summary').text(), 'Select products to print.');
    assert.equal($('#sl-print').prop('disabled'), true);
    output.window.close(); dom.window.close();
});

test('a failed select-all request cannot print the previously loaded subset', async () => {
    const { dom, w, $, getPrint } = setup(true);
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-all').trigger('click'); await tick();
    assert.match($('#sl-status').text(), /Could not load/);
    assert.equal($('#sl-print').prop('disabled'), true);
    w.PosnicShelfLabels.print(false);
    assert.equal(getPrint(), undefined);
    dom.window.close();
});
