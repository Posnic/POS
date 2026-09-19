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
    w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
    w.eval(read('frontend/static/script/js/modules/js/receipt-designer-editor.js'));
    const branch = { branch_name: 'My Shop', logo: pixel, print_logoimg: true, footer_print: 'Thanks <b>again</b>', footer_qr_url: 'https://example.com/shop', footer_image: pixel, table_options: false };
    const design = w.PosnicPro.receiptDesigner.defaults(branch);
    const sale = { ...branch, receipt_designs: design, sales_id: 'S128', created_date: '19/09/2026', customer_name: '<script>bad()</script>', customer_gst_number: 'GST123',
        items: [{ item_name: 'Cup <em>large</em>', item_price: 12, item_quantity: 2, item_unit: 'ea', total_amount: 24 }], items_subtotal: 24, items_total: 26, tax: 2 };
    return { dom, w, $: w.$, branch, design, sale, engine: w.PosnicPro.receiptDesigner };
}
test('four independent layouts migrate existing content and use different paper geometry', () => {
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
        assert.match(output.find('style').text(), new RegExp(contract.formats[format].width + 'mm'));
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
    sent = null;
    w.PosnicPro.syncPrinterPreferences = async () => { name = null; };
    w.PosnicPro._kitchenPrinters = ['kitchen'];
    await engine.print('<article>Receipt</article>', '80');
    assert.equal(sent, null);
    assert.match(error, /Choose a receipt printer/);
    dom.window.close();
});
