'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const contract = require('../api/src/helpers/receipt-design');
const { resolveReceiptDesign } = require('../api/src/helpers/resolve-receipt-design');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1AAAAAASUVORK5CYII=';
function setup() {
    const dom = new JSDOM('<div id="receipt-designer"></div><div class="form-group"><input id="printall" type="checkbox"></div><div class="form-group"><select id="bill_print_copies"><option>1</option></select></div><div class="form-group"><input id="branch_fssai_number"></div>', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window; w.$ = w.jQuery = require('jquery')(w);
    w.PosnicPro = { escapeHtml: v => w.$('<i>').text(v).html(), local: { get: () => '$', set: () => {} }, i18n: { t: (_key, text) => text }, BRAND_URL: 'https://www.posnic.com' };
    w.eval(read('api/src/helpers/receipt-design.js'));
    w.eval(read('src/receipt-page-layout.js'));
    w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
    w.eval(read('frontend/static/script/js/modules/js/receipt-designer-editor.js'));
    const branch = { branch_name: 'My Shop', logo: pixel, print_logoimg: true, footer_print: 'Thanks <b>again</b>', footer_qr_url: 'https://example.com/shop', footer_image: pixel, table_options: false };
    const design = w.PosnicPro.receiptDesigner.defaults(branch);
    const sale = { ...branch, receipt_designs: design, sales_id: 'S128', created_date: '19/09/2026', customer_name: '<script>bad()</script>', customer_gst_number: 'GST123',
        items: [{ item_name: 'Cup <em>large</em>', item_price: 12, item_quantity: 2, item_unit: 'ea', total_amount: 24 }], items_subtotal: 24, items_total: 26, tax: 2 };
    return { dom, w, $: w.$, branch, design, sale, engine: w.PosnicPro.receiptDesigner };
}
test('five independent layouts migrate existing content and use different paper geometry', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) {
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('[data-receipt-design]').attr('data-receipt-design'), format);
        assert.equal(output.find('img[alt="Store logo"]').length, 1);
        assert.equal(output.find('img[alt="QR code"]').length, 1);
        assert.match(output.text(), /Thanks again/);
        assert.equal(output.find('em').length, 0);
        assert.match(output.find('.rd-grand-total').text(), /26\.00/);
        assert.equal(output.find('th').length, contract.formats[format].height ? 4 : 2);
        assert.match(output.find('style').text(), new RegExp(contract.formats[format].content + 'mm'));
    }
    design.layouts['58'].blocks[0].align = 'right';
    assert.equal(design.layouts['80'].blocks[0].align, 'center');
    assert.doesNotThrow(() => contract.normalize(JSON.parse(JSON.stringify(design))));
    dom.window.close();
});
test('custom text is escaped, unknown or restaurant-only data stays out of a retail receipt', () => {
    const { dom, engine, design, sale, $ } = setup();
    design.layouts['80'].blocks.push(engine.block('text', { text: '<img src=x onerror=bad()>', align: 'left' }), engine.block('field', { field: 'customer_name' }), engine.block('field', { field: 'steward' }));
    sale.steward_name = 'Restaurant steward';
    let output = $('<div>').html(engine.render(sale, '80', false));
    assert.equal(output.find('script,[onerror]').length, 0);
    assert.match(output.text(), /<script>bad\(\)<\/script>/);
    assert.doesNotMatch(output.text(), /Restaurant steward/);
    sale.table_options = true;
    output = $('<div>').html(engine.render(sale, '80', false));
    assert.match(output.text(), /Restaurant steward/);
    dom.window.close();
});
test('saving generates every QR from its content and rejects invalid designs before writing', async () => {
    const { dom, design } = setup();
    const first = await resolveReceiptDesign(JSON.parse(JSON.stringify(design)));
    const qr = first.layouts['80'].blocks.find(b => b.type === 'qr');
    assert.match(qr.src, /^data:image\/png;base64,/);
    assert.notEqual(qr.src, pixel);
    const second = await resolveReceiptDesign(first);
    assert.equal(second.layouts['80'].blocks.find(b => b.type === 'qr').src, qr.src);
    first.layouts['80'].blocks.find(b => b.type === 'qr').text = 'Payment reference: café 你好';
    const third = await resolveReceiptDesign(first);
    assert.notEqual(third.layouts['80'].blocks.find(b => b.type === 'qr').src, qr.src);
    const invalid = JSON.parse(JSON.stringify(design));
    invalid.layouts.a4.blocks = invalid.layouts.a4.blocks.filter(b => b.type !== 'totals');
    await assert.rejects(resolveReceiptDesign(invalid), /Keep one/);
    invalid.layouts.a4 = { fontSize: 12, blocks: design.layouts.a4.blocks.concat({ id: 'bad', type: 'image', src: 'data:image/svg+xml,<svg onload=bad()>' }) };
    await assert.rejects(resolveReceiptDesign(invalid), /Upload a PNG/);
    dom.window.close();
});
test('editor adds and reorders blocks, keeps formats independent, and sends a partial save', () => {
    const { dom, w, $, branch } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('[data-field="steward"]').length, 0);
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('Scan below for our website').trigger('input');
    $('.rd-block-card.is-selected [data-action="up"]').trigger('click');
    $('[data-format="a4"]').trigger('click');
    assert.doesNotMatch($('.rd-block-list').text(), /Scan below/);
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.defaultFormat, '80');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.filter(b => b.text === 'Scan below for our website').length, 1);
    assert.equal(sent.receipt_designs.layouts.a4.blocks.filter(b => b.text === 'Scan below for our website').length, 0);
    assert.equal(sent.store_name, undefined);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: sent.receipt_designs });
    assert.equal($('#printall').length, 1, 'Reloading settings keeps the moved controls');
    dom.window.close();
});

test('desktop printing refreshes the selected printer and never guesses the kitchen printer', async () => {
    const { dom, w, engine } = setup();
    let name = 'Old printer', sent, error;
    w.PosnicPro.syncPrinterPreferences = async () => { name = 'Counter'; };
    w.PosnicPro.resolveReceiptPrinter = () => name;
    w.PosnicPro.afterPrint = () => {};
    w.PosnicPro.alert = (_type, message) => { error = message; };
    w.electronAPI = { printer: { print: async (_doc, options) => { sent = options; return { success: true }; }, getDefault: async () => ({ name: 'Kitchen' }) } };
    await engine.print('<article>Receipt</article>', '58');
    assert.equal(sent.printerName, 'Counter');
    assert.equal(sent.pageSize, '58mm');
    assert.equal(sent.fitReceipt, true);
    await engine.print('<article>Invoice</article>', 'a5');
    assert.equal(sent.pageSize, 'a5');
    assert.equal(sent.fitReceipt, false, 'A5 keeps its sheet height');
    sent = null;
    w.PosnicPro.syncPrinterPreferences = async () => { name = null; };
    w.PosnicPro._kitchenPrinters = ['kitchen'];
    await engine.print('<article>Receipt</article>', '80');
    assert.equal(sent, null);
    assert.match(error, /Choose a receipt printer/);
    dom.window.close();
});

test('four-format saved designs gain an independent A5 layout without losing their settings', async () => {
    const { dom, w, $, branch, design, engine } = setup();
    delete design.layouts.a5;
    design.layouts.a4.blocks.push(engine.block('text', { text: 'Existing invoice terms' }));
    const original = JSON.stringify(design);
    const expanded = await resolveReceiptDesign(JSON.parse(original));
    assert.equal(JSON.stringify(design), original, 'Reading never mutates the saved design');
    assert.equal(expanded.defaultFormat, '80');
    assert.equal(expanded.layouts.a5.fontSize, 11);
    assert.equal(expanded.layouts.a5.blocks.at(-1).text, 'Existing invoice terms');
    assert.notEqual(expanded.layouts.a5.blocks, expanded.layouts.a4.blocks);
    let saved;
    w.PosnicPro.put = (req, done) => { saved = JSON.parse(req.data).receipt_designs; done({ type: 'success', data: { receipt_designs: saved } }); };
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: JSON.parse(original) });
    $('[data-format="a5"]').trigger('click');
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('A5 only').trigger('input');
    $('[data-default-format="a5"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(saved.defaultFormat, 'a5');
    assert.equal(saved.layouts.a5.blocks.at(-1).text, 'A5 only');
    assert.equal(saved.layouts.a4.blocks.at(-1).text, 'Existing invoice terms');
    const reloaded = await resolveReceiptDesign(saved);
    assert.equal(reloaded.layouts.a5.blocks.at(-1).text, 'A5 only');
    assert.deepEqual(await resolveReceiptDesign(reloaded), reloaded);
    dom.window.close();
});

test('A5 tender and print dispatch use sheet geometry and the chosen A5 design', () => {
    const { dom, w, $, engine, sale } = setup();
    w.eval(read('frontend/static/script/js/core/tender-receipt.js'));
    const preview = w.PosnicPro.tenderReceipt;
    const html = preview.documentFor(sale, sale, 'a5');
    assert.match(html, /size:148mm 210mm/);
    assert.match(html, /width:124mm/);
    const box = $('<div>').css('width', '800px').appendTo('body');
    preview.mount(box, html, '', 'a5');
    const srcdoc = box.find('iframe').attr('srcdoc');
    assert.match(srcdoc, /width:559px;padding:12mm/);
    assert.match(srcdoc, /data-receipt-design="a5"/);
    assert.equal($('<div>').html(html).find('th').length, 4);
    const core = read('frontend/static/script/js/core/PosnicPro.js').replace(/\r\n/g, '\n');
    const start = core.indexOf('    printView: function');
    const end = core.indexOf('\n    },', start);
    w.eval('PosnicPro.printView = ' + core.slice(core.indexOf('function', start), end + 6) + ';');
    let sent;
    engine.print = (document, format) => { sent = { document, format }; };
    w.PosnicPro.printView(html, '');
    assert.equal(sent.format, 'a5');
    assert.equal(sent.document, html);
    dom.window.close();
});

test('a QR preview completing during save does not report an unsaved edit', async () => {
    const { dom, w, $, branch } = setup();
    let previewDone, saveDone, payload;
    w.PosnicPro.post = (_req, done) => { previewDone = done; };
    w.PosnicPro.put = (req, done) => { payload = JSON.parse(req.data); saveDone = done; };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('.rd-block-card').last().find('[data-action="select"]').trigger('click');
    $('#rd-block-text').val('Updated QR').trigger('input');
    $('[data-action="save"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 400));
    previewDone({ type: 'success', data: { src: pixel } });
    saveDone({ type: 'success', data: { receipt_designs: payload.receipt_designs } });
    assert.equal($('.rd-status').text(), 'All designs saved');
    dom.window.close();
});

test('block typography and divider settings survive save and render on every paper format', async () => {
    const { dom, w, $, engine, design, sale } = setup();
    w.eval(read('frontend/static/script/js/core/tender-receipt.js'));
    for (const format of Object.keys(contract.formats)) {
        const blocks = design.layouts[format].blocks;
        blocks.push(engine.block('text', { text: 'Scan below', fontSize: 20, bold: true }));
        blocks.push(engine.block('field', { field: 'customer_name', fontSize: 14, bold: true }));
        for (const lineStyle of ['solid', 'dashed', 'dotted']) {
            blocks.push(engine.block('divider', { lineStyle, width: 65, thickness: 3, align: 'center' }));
        }
        blocks.push(engine.block('divider'));
    }
    sale.receipt_designs = await resolveReceiptDesign(JSON.parse(JSON.stringify(design)));
    assert.deepEqual(await resolveReceiptDesign(sale.receipt_designs), sale.receipt_designs);
    for (const format of Object.keys(contract.formats)) {
        for (const html of [engine.render(sale, format, false), w.PosnicPro.tenderReceipt.documentFor(sale, sale, format)]) {
            const output = $('<div>').html(html);
            assert.equal(output.find('.rd-block-text').last()[0].style.fontSize, '20px');
            assert.equal(output.find('.rd-block-text').last()[0].style.fontWeight, 'bold');
            assert.equal(output.find('.rd-block-field').last()[0].style.fontSize, '14px');
            assert.equal(output.find('.rd-block-field').last()[0].style.fontWeight, 'bold');
            assert.equal(output.find('.rd-block-items')[0].style.fontSize, '', 'Unedited blocks inherit the format default');
            const lines = output.find('.rd-divider').toArray();
            ['solid', 'dashed', 'dotted'].forEach((style, i) => {
                assert.equal(lines[i].style.borderTopStyle, style);
                assert.equal(lines[i].style.borderTopWidth, '3px');
                assert.equal(lines[i].style.width, '65%');
                assert.equal(lines[i].style.marginLeft, 'auto');
                assert.equal(lines[i].style.marginRight, 'auto');
            });
            assert.equal(lines[3].style.borderTopStyle, 'dashed', 'Old dividers keep their appearance');
            assert.equal(lines[3].style.width, '100%');
            assert.equal(lines[3].style.borderTopWidth, '1px');
        }
    }
    dom.window.close();
});

test('editor scopes text styling to a block and format, and can return to the default size', () => {
    const { dom, w, $, branch } = setup();
    let saved;
    w.PosnicPro.put = (request, done) => {
        saved = JSON.parse(request.data).receipt_designs;
        done({ type: 'success', data: { receipt_designs: saved } });
    };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('Scan below').trigger('input');
    $('#rd-block-size').val('20').trigger('change');
    $('[data-prop="bold"]').prop('checked', true).trigger('change');
    $('#rd-text-size').val('14').trigger('change');
    $('[data-add="divider"]').trigger('click');
    $('#rd-line-style').val('dotted').trigger('change');
    $('#rd-line-thickness').val('2').trigger('change');
    $('#rd-line-width').val('50').trigger('input');
    $('#rd-align').val('right').trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.equal(saved.layouts['80'].fontSize, 14);
    assert.equal(saved.layouts['80'].blocks.at(-2).fontSize, 20);
    assert.equal(saved.layouts['80'].blocks.at(-2).bold, true);
    assert.equal(saved.layouts['80'].blocks.at(-1).width, 50);
    assert.equal(saved.layouts.a4.fontSize, 12);
    assert.equal(saved.layouts.a4.blocks.some(b => b.type === 'divider'), false);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: saved });
    $('.rd-block-card').last().find('[data-action="select"]').trigger('click');
    assert.equal($('#rd-line-style').val(), 'dotted');
    assert.equal($('#rd-line-thickness').val(), '2');
    assert.equal($('#rd-line-width').val(), '50');
    assert.equal($('#rd-align').val(), 'right');
    $('.rd-block-card').eq(-2).find('[data-action="select"]').trigger('click');
    assert.equal($('#rd-block-size').val(), '20');
    assert.equal($('[data-prop="bold"]').prop('checked'), true);
    $('#rd-block-size').val('').trigger('change');
    $('[data-prop="bold"]').prop('checked', false).trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.equal(saved.layouts['80'].blocks.at(-2).fontSize, undefined);
    assert.equal(saved.layouts['80'].blocks.at(-2).bold, false);
    assert.equal(saved.layouts['80'].fontSize, 14);
    dom.window.close();
});

test('invalid block styles are rejected before storage', () => {
    const { dom, engine, design } = setup();
    const b = engine.block('divider');
    design.layouts['80'].blocks.push(b);
    for (const props of [{ width: 101 }, { width: 'bad' }, { thickness: 0 }, { thickness: Infinity }, { lineStyle: 'solid;display:none' }]) {
        Object.assign(b, { width: 100, thickness: 1, lineStyle: 'dashed' }, props);
        assert.throws(() => contract.normalize(design), /divider|Divider/);
    }
    design.layouts['80'].blocks.pop();
    for (const type of contract.textTypes) {
        const text = engine.block(type, { text: 'Hello', field: 'customer_name', fontSize: '12px;display:none' });
        design.layouts['80'].blocks.push(text);
        assert.throws(() => contract.normalize(design), /Block text size/);
        text.fontSize = 33;
        assert.throws(() => contract.normalize(design), /Block text size/);
        design.layouts['80'].blocks.pop();
    }
    dom.window.close();
});

test('sheets compose invoice sections while thermal keeps its compact receipt layout', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of ['a4', 'a5', 'letter', '80']) {
        const blocks = design.layouts[format].blocks;
        const at = blocks.findIndex(b => b.type === 'items');
        blocks.splice(at, 0, engine.block('field', { field: 'customer_name' }), engine.block('field', { field: 'customer_phone' }));
    }
    sale.customer_phone = '+44 117 555 0123';
    sale.invoice_terms = 'Keep this invoice.';
    const original = JSON.stringify(design);
    for (const format of ['a4', 'a5', 'letter']) {
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('.rd-invoice-header .rd-block-logo').length, 1);
        assert.equal(output.find('.rd-invoice-header .rd-block-store').length, 1);
        assert.equal(output.find('.rd-invoice-meta').text(), 'INVOICEInvoice #S128Date19/09/2026');
        assert.match(output.find('.rd-invoice-customer').text(), /Bill to.*bad\(\).*555 0123/);
        assert.deepEqual(output.find('thead th').toArray().map(e => $(e).text()), ['Item', 'Qty', 'Unit price', 'Amount']);
        assert.equal(output.find('tbody td').eq(1).text(), '2 ea');
        assert.equal(output.find('tbody td').eq(2).text(), '$ 12.00');
        assert.equal(output.find('.rd-invoice-summary > .rd-block-totals').length, 1);
        assert.equal(output.find('.rd-invoice-supporting img[alt="QR code"]').length, 1);
        assert.match(output.find('.rd-invoice-end').text(), /Keep this invoice/);
        assert.equal(output.find('.rd-signature').length, 0);
        assert.deepEqual(output.find('[data-block-id]').toArray().map(e => e.dataset.blockId), Array.from(design.layouts[format].blocks, b => b.id));
        const preview = $('<div>').html(engine.render({ ...sale, sales_id: '' }, format, true));
        assert.equal(preview.find('.rd-invoice-title').text(), 'Bill');
        assert.doesNotMatch(preview.find('.rd-invoice-meta').text(), /Invoice #/);
    }
    const thermal = $('<div>').html(engine.render(sale, '80', false));
    assert.equal(thermal.find('.rd-invoice-header,.rd-invoice-summary,.rd-invoice-customer').length, 0);
    assert.equal(thermal.find('thead th').length, 2);
    assert.match(thermal.find('.rd-transaction').text(), /Receipt S128/);
    assert.equal(JSON.stringify(design), original, 'Rendering does not migrate or overwrite saved designs');
    dom.window.close();
});

test('sheet grouping preserves custom boundaries, wide artwork and long item lists', () => {
    const { dom, engine, design, sale, $ } = setup();
    const blocks = design.layouts.a5.blocks;
    blocks.splice(1, 0, engine.block('text', { text: 'Custom opening message' }));
    blocks.push(engine.block('divider'), engine.block('image', { src: pixel, width: 85 }), engine.block('logo'), engine.block('logo'));
    sale.items = Array.from({ length: 70 }, (_, i) => ({ item_name: 'Item ' + i + ' with a long descriptive name', item_price: 12, item_quantity: 2, total_amount: 24 }));
    const output = $('<div>').html(engine.render(sale, 'a5', false));
    assert.equal(output.find('tbody tr').length, 70);
    assert.deepEqual(output.find('[data-block-id]').toArray().map(e => e.dataset.blockId), Array.from(blocks, b => b.id));
    assert.equal(output.find('.rd-invoice-supporting .rd-block-image').length, 0, 'Wide artwork retains the full printable width');
    assert.equal(output.find('.rd-invoice-header .rd-block-logo').length, 0, 'Standalone and repeated logos do not overlap in a header grid');
    assert.equal(output.find('.rd-block-image img')[0].style.width, '105.4mm');
    assert.match(output.find('style').text(), /\.rd-block-items\{break-inside:auto/);
    assert.match(output.find('style').text(), /thead\{display:table-header-group/);
    dom.window.close();
});

test('format cards separate editing from default selection and preserve the choice after save', () => {
    const { dom, w, $, branch } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('#rd-default-format').length, 0, 'There is no separate default dropdown');
    assert.equal($('.rd-format-card').length, 5);
    assert.equal($('button button').length, 0, 'Each card has two independent native buttons');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), '80');
    $('[data-format="a5"]').trigger('click');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), '80');
    $('[data-default-format="a4"]').trigger('click');
    assert.equal($('.rd-format-card.is-active [data-format]').attr('data-format'), 'a5', 'Choosing a default does not switch the editing context');
    assert.equal($('.rd-format-card.is-default').length, 1);
    assert.equal($('[data-default-format="a4"]').attr('aria-disabled'), 'true');
    assert.equal($('[data-default-format="a4"]').text(), 'Default');
    assert.equal($('[data-default-format="80"]').text(), 'Set as default');
    assert.match($('[data-default-format="58"]').attr('aria-label'), /Set as default: 58 mm thermal/);
    assert.equal($('.rd-status').text(), 'Unsaved changes');
    $('[data-default-format="a4"]').trigger('click');
    $('[data-action="undo"]').trigger('click');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), '80', 'Clicking the existing default does not add an undo step');
    $('[data-default-format="a4"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.defaultFormat, 'a4');
    assert.equal($('[data-format="a5"]').attr('aria-pressed'), 'true');
    assert.equal($('.rd-status').text(), 'All designs saved');
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: sent.receipt_designs });
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), 'a4');
    assert.equal($('.rd-format-card.is-active [data-format]').attr('data-format'), 'a4');
    $('[data-format="58"]').trigger('click');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), 'a4');
    dom.window.close();
});

test('a failed save leaves the chosen default editable and undo restores the saved choice', () => {
    const { dom, w, $, branch } = setup();
    w.PosnicPro.put = (_request, _done, fail) => fail({ responseJSON: { message: 'Connection lost' } });
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('[data-default-format="letter"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal($('.rd-status').text(), 'Connection lost');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), 'letter');
    assert.equal($('[data-action="save"]').prop('disabled'), false);
    $('[data-action="undo"]').trigger('click');
    assert.equal($('.rd-format-card.is-default [data-default-format]').attr('data-default-format'), '80');
    dom.window.close();
});

test('expanded workspace preserves draft, form controls and focus, and cleans up on navigation or reload', () => {
    const { dom, w, $, branch } = setup();
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const editor = w.PosnicPro.receiptDesignerEditor;
    editor.load(branch);
    $('[data-format="a5"]').trigger('click');
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('Draft stays here').trigger('input');
    const card = $('.rd-block-card.is-selected')[0];
    const parent = $('#receipt-designer')[0].parentNode;
    $('[data-action="expand"]').trigger('click');
    assert.equal($('dialog')[0].open, true);
    assert.equal($('.rd-workspace-open').length, 1);
    assert.equal($('[data-action="expand"]').attr('aria-expanded'), 'true');
    assert.equal($('#printall').length, 1);
    $('dialog')[0].dispatchEvent(new w.Event('close')); // Native Escape closes the dialog.
    assert.equal($('dialog').length, 0);
    assert.equal($('#receipt-designer')[0].parentNode, parent);
    assert.equal($('.rd-block-card.is-selected')[0], card);
    assert.equal($('#rd-block-text').val(), 'Draft stays here');
    assert.equal(w.document.activeElement, $('[data-action="expand"]')[0]);
    assert.equal($('[data-format="a5"]').attr('aria-pressed'), 'true');
    assert.equal($('.rd-status').text(), 'Unsaved changes');
    $('[data-action="expand"]').trigger('click');
    $(w).trigger('hashchange');
    assert.equal($('dialog,.rd-workspace-open').length, 0);
    $('[data-action="expand"]').trigger('click');
    editor.load(branch);
    assert.equal($('dialog,.rd-workspace-open').length, 0);
    assert.equal($('#receipt-designer').length, 1);
    dom.window.close();
});

test('sample prints a snapshot of the selected unsaved format, resolves QR and never saves or changes defaults', async () => {
    const { dom, w, $, branch, engine } = setup();
    let sent, qrDone, qrText, saves = 0, calls = 0;
    w.PosnicPro.put = () => { saves++; };
    w.PosnicPro.post = (req, done) => { qrText = JSON.parse(req.data).text; qrDone = done; };
    engine.print = async (html, format, options) => { calls++; sent = { html, format, options }; return { success: true }; };
    const editor = w.PosnicPro.receiptDesignerEditor;
    editor.load(branch);
    $('[data-add="image"]').trigger('click'); // Unfinished 80 mm block must not block A5.
    $('[data-format="a5"]').trigger('click');
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('A5 unsaved offer').trigger('input');
    $('[data-add="qr"]').trigger('click');
    $('#rd-block-text').val('https://example.com/offer').trigger('input');
    const pending = editor.printSample();
    editor.printSample();
    assert.equal(calls, 0, 'Do not silently omit an unfinished QR code');
    assert.equal($('[data-action="print-sample"]').prop('disabled'), true);
    assert.equal(qrText, 'https://example.com/offer');
    $('[data-format="58"]').trigger('click'); // Printed draft is stable during async generation.
    qrDone({ type: 'success', data: { src: pixel } });
    await pending;
    assert.equal(calls, 1);
    assert.equal(sent.format, 'a5');
    assert.equal(sent.options.sample, true);
    const printed = $('<div>').html(sent.html);
    assert.match(printed.find('article').text(), /SAMPLE.*Not a sale.*SAMPLE-001/s);
    assert.match(printed.text(), /A5 unsaved offer/);
    assert.equal(printed.find('img[alt="QR code"]').length, 2);
    assert.equal(saves, 0);
    assert.equal($('[data-default-format="80"]').attr('aria-disabled'), 'true');
    assert.equal($('.rd-status').text(), 'Unsaved changes');
    assert.equal($('[data-action="print-sample"]').prop('disabled'), false);
    assert.equal($('.rd-print-status').text(), 'Sample sent to printer');
    dom.window.close();
});

test('sample QR and printer failures keep the draft editable and allow retry', async () => {
    const { dom, w, $, branch, engine } = setup();
    const editor = w.PosnicPro.receiptDesignerEditor;
    editor.load(branch);
    $('[data-add="qr"]').trigger('click');
    $('#rd-block-text').val('https://example.com/new').trigger('input');
    let printed = false;
    engine.print = async () => { printed = true; throw new Error('Printer is offline'); };
    w.PosnicPro.post = (_req, _done, fail) => fail();
    await editor.printSample();
    assert.equal(printed, false);
    assert.match($('.rd-print-status').text(), /Could not generate QR/);
    assert.equal($('[data-action="print-sample"]').prop('disabled'), false);
    w.PosnicPro.post = (_req, done) => done({ type: 'success', data: { src: pixel } });
    await editor.printSample();
    assert.equal(printed, true);
    assert.equal($('.rd-print-status').text(), 'Printer is offline');
    assert.equal($('#rd-block-text').val(), 'https://example.com/new');
    assert.equal($('.rd-status').text(), 'Unsaved changes');
    dom.window.close();
});

test('Electron samples use the normal print route without completing or leaving a sale', async () => {
    const { dom, w, engine } = setup();
    let after = 0, options;
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.PosnicPro.afterPrint = () => { after++; };
    w.electronAPI = { printer: { print: async (_html, opts) => { options = opts; return { success: true }; } } };
    assert.equal((await engine.print('<article>Sample</article>', '80', { sample: true })).success, true);
    assert.equal(options.forceHtml, true);
    assert.equal(options.fitReceipt, true);
    assert.equal(options.printerName, 'Counter');
    assert.equal(after, 0);
    w.electronAPI.printer.print = async () => ({ success: false, error: 'Out of paper' });
    await assert.rejects(engine.print('<article>Sample</article>', '80', { sample: true }), /Out of paper/);
    assert.equal(after, 0);
    dom.window.close();
});

test('browser sample waits for assets, uses printer paper, and restores the editor after the print dialog', async () => {
    const { dom, w, $, engine } = setup();
    let ready, fitted = 0, printed = 0, after = 0;
    w.PosnicPro.waitForPrintAssets = () => new Promise(resolve => { ready = resolve; });
    w.PosnicReceiptPage.fitDocument = (doc, options) => {
        assert.equal(doc, $('iframe[title="Receipt print"]')[0].contentDocument);
        assert.equal(options.usePrinterPaper, true);
        fitted++;
    };
    w.PosnicPro.afterPrint = () => { after++; };
    const job = engine.print('<article>Sample</article>', '80', { sample: true });
    const frame = $('iframe[title="Receipt print"]');
    frame[0].contentWindow.focus = () => {};
    frame[0].contentWindow.print = () => { printed++; };
    frame.trigger('load');
    await Promise.resolve();
    assert.equal(printed, 0);
    ready();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fitted, 1);
    assert.equal(printed, 1);
    assert.equal(after, 0);
    frame[0].contentWindow.onafterprint();
    assert.equal((await job).dialog, true);
    assert.equal($('iframe[title="Receipt print"]').length, 0);
    dom.window.close();
});


test('signature is opt-in per format and reads the shared branch image on every render', () => {
    const { dom, engine, design, sale, $ } = setup();
    sale.quote_default_signature = pixel;
    for (const format of Object.keys(contract.formats)) {
        assert.equal($('<div>').html(engine.render(sale, format, false)).find('.rd-signature').length, 0);
        design.layouts[format].blocks.push(engine.block('signature', { align: 'right', width: 30, fontSize: 14, bold: true, src: pixel }));
    }
    sale.receipt_designs = contract.normalize(JSON.parse(JSON.stringify(design)));
    for (const format of Object.keys(contract.formats)) {
        const block = sale.receipt_designs.layouts[format].blocks.at(-1);
        assert.equal(block.src, undefined, 'Images belong to the branch, not a layout snapshot');
        let output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('.rd-block-signature').css('text-align'), 'right');
        assert.equal(output.find('.rd-block-signature').css('font-size'), '14px');
        assert.equal(output.find('.rd-signature').attr('style'), 'width:30%');
        assert.equal(output.find('.rd-signature img').attr('src'), pixel);
        output = $('<div>').html(engine.render({ ...sale, quote_default_signature: '' }, format, false));
        assert.equal(output.find('.rd-signature img').length, 0);
        assert.equal(output.find('.rd-signature-blank').length, 1, 'An explicit empty block leaves room to sign by hand');
    }
    dom.window.close();
});

test('signature editor saves only the optional block and keeps each format independent', () => {
    const { dom, w, $, branch } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, quote_default_signature: pixel });
    $('[data-format="a4"]').trigger('click');
    $('[data-add="signature"]').trigger('click');
    assert.equal($('#rd-align').val(), 'right');
    $('#rd-align').val('left').trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.layouts.a4.blocks.at(-1).type, 'signature');
    assert.equal(sent.receipt_designs.layouts.a4.blocks.at(-1).align, 'left');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.some(b => b.type === 'signature'), false);
    assert.equal(sent.quote_default_signature, undefined);
    $('.rd-block-card.is-selected [data-action="remove"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.layouts.a4.blocks.some(b => b.type === 'signature'), false);
    dom.window.close();
});
