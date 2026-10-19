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

test('product row and name toggle selection once without interfering with copies', async () => {
    const { dom, w, $ } = setup();
    w.PosnicShelfLabels.open(); await tick();
    const row = $('#sl-products .sl-product-row').first();
    const checkbox = row.find('input[type=checkbox]')[0];
    row[0].click(); assert.equal(checkbox.checked, true);
    row.find('label')[0].click(); assert.equal(checkbox.checked, false);
    row.find('label small')[0].click(); assert.equal(checkbox.checked, true);
    checkbox.click(); assert.equal(checkbox.checked, false);
    row.find('input[type=number]')[0].click();
    row.find('input[type=number]').val(4).trigger('change');
    assert.equal(checkbox.checked, false);
    row.find('.sl-product-price')[0].click(); assert.equal(checkbox.checked, true);
    assert.equal(row.find('input[type=number]').val(), '4');
    dom.window.close();
});

test('the real designer previews A4, prints the same sheets and restores its layout', async () => {
    const { dom, w, $, getPrint, next, selectAll } = setup();
    w.PosnicShelfLabels.open(); await tick();
    assert.equal($('#sl-products input[type=checkbox]:checked').length, 0);
    await selectAll(); $('#sl-batch').val(30); next();
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


test('desktop labels use a chosen printer and exact roll dimensions without a browser dialog', async () => {
    const { dom, w, $, next, getPrint } = setup();
    const sent = [];
    w.electronAPI = { printer: {
        list: async () => [{ name: 'POS-80C' }, { name: 'Brother A4' }],
        print: async (html, options) => { sent.push({ html, options }); return { success: true }; }
    } };
    w.PosnicShelfLabels.open('0'); await tick();
    assert.equal($('#sl-batch').val(), '5');
    assert.equal($('#sl-desktop-printer').prop('hidden'), false);
    next(); $('#sl-paper').val('roll').trigger('change'); await tick();
    $('#sl-width').val(63).trigger('change'); $('#sl-print-method').val('driver').trigger('change'); next(); next();
    await w.PosnicShelfLabels.print(true);
    assert.equal(sent.length, 0, 'must not borrow the receipt/default printer');
    $('#sl-printer').val('POS-80C');
    await w.PosnicShelfLabels.print(true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].options.printerName, 'POS-80C');
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0].options.pageSize)), { width: 63000, height: 33000 });
    assert.equal(sent[0].options.exactPageSize, true);
    assert.equal(sent[0].options.silent, true);
    assert.equal(sent[0].options.landscape, false);
    assert.equal(getPrint(), undefined);
    assert.equal(new JSDOM(sent[0].html).window.document.querySelectorAll('.sl-label').length, 1);
    assert.match($('#sl-status').text(), /Sent 1 label/);
    assert.equal(w.localStorage.getItem('posnic.shelf-label-printer.roll'), 'POS-80C');
    dom.window.close();
});

test('desktop A4 keeps sheet dimensions and does not retry a failed submission through browser printing', async () => {
    const { dom, w, $, next, selectAll, getPrint } = setup();
    const sent = [];
    w.electronAPI = { printer: { list: async () => [{ name: 'Brother A4' }], print: async (html, options) => {
        sent.push({html, options}); return { success: false, error: 'Printer offline' };
    } } };
    w.PosnicShelfLabels.open(); await tick(); await selectAll(); next();
    $('#sl-paper').val('a4').trigger('change'); await tick(); next(); next();
    $('#sl-printer').val('Brother A4');
    await w.PosnicShelfLabels.print(false);
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0].options.pageSize)), { width: 210000, height: 297000 });
    assert.equal(new JSDOM(sent[0].html).window.document.querySelectorAll('.sl-label').length, 5);
    assert.match($('#sl-status').text(), /Printer offline/);
    assert.equal(getPrint(), undefined);
    dom.window.close();
});


test('thermal labels explicitly opt into raw raster printing and stop at the first failed label', async () => {
    const { dom, w, $, next } = setup(); const sent = [];
    w.electronAPI = { printer: { list: async () => [{ name: 'POS-80C' }], print: async (html, options) => {
        sent.push({html,options}); return sent.length === 1 ? {success:true} : {success:false,error:'Disconnected'};
    } } };
    w.PosnicShelfLabels.open('0'); await tick(); next();
    $('#sl-paper').val('roll').trigger('change'); await tick();
    $('#sl-products input[type=number]').first().val(3).trigger('change');
    next(); next(); $('#sl-printer').val('POS-80C'); $('#sl-print-method').val('thermal');
    await w.PosnicShelfLabels.print(false);
    assert.equal(sent.length,2);
    assert.equal(sent[0].options.thermalRaster,true);
    assert.equal(sent[0].options.pageSize,'80mm');
    assert.match(sent[0].html,/data-receipt-design="80"/);
    assert.equal(new JSDOM(sent[0].html).window.document.querySelectorAll('.sl-label').length,1);
    assert.match($('#sl-status').text(),/1 earlier label/);
    dom.window.close();
});

test('size presets only set dimensions, preserve printer method and copies, and restore after reopening', async () => {
    const { dom, w, $, next } = setup();
    w.electronAPI = { printer: { list: async () => [{ name: 'POS-80C' }], print: async () => ({success:true}) } };
    w.PosnicShelfLabels.open('0'); await tick(); next();
    $('#sl-products input[type=number]').first().val(3).trigger('change');
    $('#sl-preset').val('thermal80').trigger('change'); await tick();
    assert.equal($('#sl-paper').val(), 'roll'); assert.equal($('#sl-width').val(), '72');
    assert.equal($('#sl-print-method').val(), 'driver');
    $('#sl-print-method').val('thermal').trigger('change');
    $('#sl-printer').val('POS-80C');
    assert.equal($('#sl-products input[type=number]').first().val(), '3');
    $('#sl-preset').val('thermal58').trigger('change'); await tick();
    assert.equal($('#sl-width').val(), '48'); assert.equal($('#sl-print-method').val(), 'thermal');
    assert.equal($('#sl-printer').val(), 'POS-80C');
    w.PosnicShelfLabels.open('0'); await tick();
    assert.equal($('#sl-preset').val(), 'thermal58'); assert.equal($('#sl-print-method').val(), 'thermal');
    $('#sl-width').val(47).trigger('change'); assert.equal($('#sl-preset').val(), 'custom');
    $('#sl-paper').val('a4').trigger('change'); await tick();
    assert.equal($('#sl-paper').val(), 'a4'); assert.equal($('#sl-width').val(), '63');
    assert.equal($('#sl-margin').val(), '5'); assert.equal($('#sl-gap').val(), '2');
    assert.equal($('#sl-print-method').val(), 'driver');
    dom.window.close();
});

test('thermal preview shows roll edges and keeps print content within the print head', async () => {
    const { dom, w, $, next } = setup(); const sent=[];
    w.electronAPI={printer:{list:async()=>[{name:'POS-80C'}],print:async(html,options)=>{sent.push({html,options});return {success:true};}}};
    w.PosnicShelfLabels.open('0'); await tick(); next();
    $('#sl-paper').val('roll').trigger('change'); await tick(); $('#sl-width').val(72);
    next(); next(); $('#sl-printer').val('POS-80C'); $('#sl-print-method').val('thermal').trigger('change');
    assert.match($('#sl-print-sample').attr('aria-label'),/80 mm roll, 72 mm printable/);
    assert.match($('#sl-print-sample style').text(),/justify-content:flex-start/);
    await w.PosnicShelfLabels.print(true);
    assert.match(sent[0].html,/justify-content:flex-start/);
    assert.match(sent[0].html,/width:72mm/);
    dom.window.close();
});

test('paper cards default to roll, filter sizes, and retain saved A4 layouts', async () => {
 const {dom,w,$,next}=setup();
 w.PosnicShelfLabels.open('0');await tick();next();
 assert.equal($('#sl-paper').val(),'roll');assert.equal($('#sl-width').val(),'72');
 assert.equal($('#sl-paper').prop('hidden'),true);
 assert.equal($('#sl-size-cards [data-value=a4]').prop('hidden'),true);
 $('#sl-paper-cards [data-value=a4]')[0].click();await tick();
 assert.equal($('#sl-size-cards [data-value=thermal80]').prop('hidden'),true);
 assert.match($('#sl-capacity').text(),/3 columns × 8 rows · 24/);
 $('#sl-size-cards [data-value=a4small]')[0].click();await tick();
 assert.match($('#sl-capacity').text(),/4 columns × 10 rows · 40/);
 $('#sl-size-cards [data-value=custom]')[0].click();$('#sl-width').val(55).trigger('change');
 assert.equal($('#sl-preset').val(),'custom');
 w.PosnicShelfLabels.open('0');await tick();assert.equal($('#sl-paper').val(),'a4');assert.equal($('#sl-width').val(),'55');
 dom.window.close();
});

test('print plan explains mixed quantities and batch limits without multiplying sheet copies', async () => {
 const {dom,w,$,next}=setup();w.PosnicShelfLabels.open();await tick();
 const rows=$('#sl-products .sl-product-row');rows[0].click();rows[1].click();
 rows.eq(0).find('input[type=number]').val(3).trigger('change');
 rows.eq(1).find('input[type=number]').val(4).trigger('change');
 next();$('#sl-paper-cards [data-value=a4]')[0].click();await tick();next();next();
 assert.match($('#sl-plan-mode').text(),/2 products.*Repeated labels/);
 assert.equal($('#sl-plan-products input').length,2);
 assert.match($('#sl-plan-batch').text(),/5 \/ 7 labels/);
 $('#sl-plan-products input').first().val(2).trigger('change');
 assert.equal($('#sl-job-total').text(),'6');
 $('#sl-one-each')[0].click();
 assert.equal($('#sl-job-total').text(),'2');assert.match($('#sl-plan-mode').text(),/One label per selected product/);
 assert.equal($('#sl-job-pages').text(),'1');
 dom.window.close();
});
