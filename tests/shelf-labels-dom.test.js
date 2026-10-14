const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, 'frontend/static/script/js', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(failBulk = false, noBarcode = false, delayedBulk = false, pages = false) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'frontend/modules/items.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://labels.example/' });
    const w = dom.window;
    // jsdom lacks canvas text measurement; barcode encoding and SVG rendering remain real.
    w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 6 }) });
    w.eval(script('jquery.min.js'));
    w.eval(script('JsBarcode.all.min.js'));
    const $ = w.jQuery;
    $.fn.modal = function () { this.addClass('show'); return this; };
    const items = Array.from({ length: pages ? 60 : 30 }, (_, i) => ({ _id: String(i), name: 'Product ' + i, barcode_id: noBarcode ? '' : '7622202828256', label_price: 1.75, label_currency_digits: 2 }));
    let releaseBulk;
    const requests = [];
    w.PosnicPro = {
        i18n: { t: (_key, fallback) => fallback },
        local: { get: key => ({ branchname: 'Test Shop', currencySign: '£' })[key] },
        listFilter: { legacyFilters: () => ({ category: 'test' }) }, items: {},
        get: (params, ok, fail) => {
            requests.push(params);
            const answer = () => {
                if (params.url.startsWith('categories')) return ok({ suggestions: [] });
                if (params.url === 'items/0') return ok({ type: 'success', data: items[0] });
                if (failBulk && params.data.limit === 100) return fail();
                const start = (params.data.page - 1) * params.data.limit;
                ok({ type: 'success', data: { list: items.slice(start, start + params.data.limit), total: items.length, total_pages: Math.ceil(items.length / params.data.limit) } });
            };
            if (delayedBulk && params.data.limit === 100) releaseBulk = answer;
            else queueMicrotask(answer);
        }
    };
    let printed;
    w.printJS = options => { printed = options; };
    w.eval(script('core/shelf-labels.js'));
    $('#sl-width').val(63); $('#sl-height').val(33);
    $('#bar-fontSize').val(10); $('#barcodeLabelType').val('EAN13');
    $('#bar-height').val(30); $('#bar-width').val(1);
    return { dom, w, $, requests, release: () => releaseBulk(), next: () => $('#sl-next-step').trigger('click'), selectAll: async () => { $('#sl-all').prop('checked', true).trigger('change'); await tick(); }, getPrint: () => printed };
}

test('the real designer previews A4, prints the same sheets and restores its layout', async () => {
    const { dom, w, $, getPrint, next, selectAll } = setup();
    w.PosnicShelfLabels.open(); await tick();
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    await selectAll(); next();
    $('#sl-paper').val('a4').trigger('change');
    assert.equal($('#sl-sample .sl-label').length, 1);
    next();
    assert.equal($('#sl-preview .sl-label').length, 24, $('#sl-status').text());
    assert.match($('#sl-preview').text(), /£ 1.75/);
    assert.match($('#sl-preview').text(), /Test Shop/);
    assert.equal($('#sl-preview svg').length, 24);
    assert.ok(!$('#sl-preview style').text().includes('@page'));
    next(); w.PosnicShelfLabels.print(false);
    const output = new JSDOM(getPrint().printable);
    assert.equal(output.window.document.querySelectorAll('.sl-sheet').length, 2);
    assert.equal(output.window.document.querySelectorAll('.sl-label').length, 30);
    assert.match(getPrint().style, /size:A4/);
    $('#sl-paper').val('roll');
    w.PosnicShelfLabels.open(); await tick();
    assert.equal($('#sl-paper').val(), 'a4');
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    $('#sl-clear').trigger('click');
    assert.equal($('#sl-summary').text(), 'Select products to print.');
    assert.equal($('#sl-print').prop('disabled'), true);
    output.window.close(); dom.window.close();
});

test('a failed select-all request cannot print the previously loaded subset', async () => {
    const { dom, w, $, getPrint, selectAll } = setup(true);
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-products input[type=checkbox]').first().prop('checked', true).trigger('change'); await selectAll();
    assert.match($('#sl-status').text(), /Could not load/);
    assert.equal($('#sl-print').prop('disabled'), true);
    w.PosnicShelfLabels.print(false);
    assert.equal(getPrint(), undefined);
    dom.window.close();
});

test('opening shows only Products, selects nothing and cannot jump straight to Print', async () => {
    const { dom, w, $, getPrint } = setup();
    w.PosnicShelfLabels.open(); await tick();
    assert.match($('#sl-selection-count').text(), /^0 products · 0 labels$/);
    assert.equal($('#sl-next-step').prop('disabled'), true);
    assert.equal($('[data-sl-panel="0"]').prop('hidden'), false);
    assert.equal($('[data-sl-panel="1"]').prop('hidden'), true);
    assert.equal($('#labelBarcode,#print-preview,#label-print-button').length, 0);
    w.PosnicShelfLabels.print(false); assert.equal(getPrint(), undefined);
    dom.window.close();
});

test('individual deselection, page selection, select-all checkbox and Clear selection work', async () => {
    const { dom, w, $, selectAll } = setup();
    w.PosnicShelfLabels.open(); await tick();
    const first = $('#sl-products input[type=checkbox]').first();
    first.prop('checked', true).trigger('change'); assert.match($('#sl-selection-count').text(), /^1 products/);
    first.prop('checked', false).trigger('change'); assert.match($('#sl-selection-count').text(), /^0 products/);
    $('#sl-page-all').prop('checked', true).trigger('change');
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 30);
    $('#sl-clear').trigger('click'); assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    await selectAll();
    $('#sl-products input[type=checkbox]').first().prop('checked', false).trigger('change');
    assert.equal($('#sl-all').prop('indeterminate'), true); assert.equal($('#sl-clear').prop('disabled'), false);
    $('#sl-all').prop('checked', false).trigger('change'); assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    dom.window.close();
});

test('price-only labels work for products without barcodes, without blocking selection controls', async () => {
    const { dom, w, $, next, getPrint } = setup(false, true);
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-products input[type=checkbox]').first().prop('checked', true).trigger('change');
    assert.equal($('#sl-clear').prop('disabled'), false);
    next(); next(); assert.equal($('[data-sl-panel="1"]').prop('hidden'), false);
    assert.match($('#sl-status').text(), /Switch off Show barcode/);
    $('#sl-show-barcode').prop('checked', false).trigger('change'); next(); next();
    w.PosnicShelfLabels.print(false); assert.ok(getPrint());
    assert.ok(!getPrint().printable.includes('<svg')); assert.match(getPrint().printable, /Product 0/);
    dom.window.close();
});

test('Clear cancels select-all in flight so its late response cannot reselect products', async () => {
    const { dom, w, $, release } = setup(false, false, true);
    w.PosnicShelfLabels.open(); await tick(); $('#sl-all').prop('checked', true).trigger('change');
    assert.equal($('#sl-clear').prop('disabled'), false);
    $('#sl-clear').trigger('click'); release(); await tick();
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    assert.match($('#sl-selection-count').text(), /^0 products/);
    dom.window.close();
});

test('selection and copies survive paging; an explicit single-item action selects only that item', async () => {
    const { dom, w, $ } = setup(false, false, false, true);
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-products input[type=checkbox]').first().prop('checked', true).trigger('change');
    $('#sl-products input[type=number]').first().val(3).trigger('change');
    $('#sl-product-next').trigger('click'); await tick();
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    assert.match($('#sl-selection-count').text(), /^1 products · 3 labels$/);
    $('#sl-product-prev').trigger('click'); await tick();
    assert.equal($('#sl-products input[type=checkbox]').first().prop('checked'), true);
    assert.equal($('#sl-products input[type=number]').first().val(), '3');
    w.PosnicShelfLabels.open('0'); await tick();
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 1);
    assert.match($('#sl-selection-count').text(), /^1 products · 1 labels$/);
    dom.window.close();
});

test('search sends a literal scoped filter and does not inherit hidden Items filters', async () => {
    const { dom, w, $, requests } = setup();
    w.PosnicPro.listFilter.legacyFilters = () => ({ name: 'unrelated hidden filter' });
    w.PosnicShelfLabels.open(); await tick();
    assert.deepEqual(JSON.parse(requests.find(r => r.url === 'items').data.filters), {});
    $('#sl-search').val('Product+(0)').trigger($.Event('keydown', { key: 'Enter' })); await tick();
    const filter = JSON.parse(requests.filter(r => r.url === 'items').at(-1).data.filters);
    assert.equal(filter.$or[0].name.$regex, 'Product\\+\\(0\\)');
    assert.equal(filter.$or[1].barcode_id.$regex, 'Product\\+\\(0\\)');
    dom.window.close();
});

test('design controls work without legacy direct event bindings and restore the chosen style', async () => {
    const { dom, w, $, next } = setup();
    w.PosnicShelfLabels.open(); await tick();
    $('#sl-products input[type=checkbox]').first().prop('checked', true).trigger('change'); next();
    $('#font').val('Arial').trigger('change'); $('#line-color').val('#123456').trigger('change');
    $('#view_print_lable .text-align[value=right]').trigger('click'); $('#view_print_lable .font-option[value=bold]').trigger('click');
    assert.match($('#sl-sample style').text(), /text-align:right/); assert.match($('#sl-sample style').text(), /font-weight:700/);
    assert.match($('#sl-sample style').text(), /color:#123456/);
    w.PosnicShelfLabels.open(); await tick();
    assert.equal($('#font').val(), 'Arial'); assert.equal($('#line-color').val(), '#123456');
    assert.equal($('#view_print_lable .text-align[value=right]').hasClass('btn-primary'), true);
    assert.equal($('#view_print_lable .font-option[value=bold]').hasClass('btn-primary'), true);
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    dom.window.close();
});
