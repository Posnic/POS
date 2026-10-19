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
    w.PosnicPro = { escapeHtml: v => w.$('<i>').text(v).html(), local: { get: key => key === 'currencySign' ? '$' : '', set: () => {} }, i18n: { t: (_key, text) => text }, BRAND_URL: 'https://www.posnic.com' };
    w.eval(read('api/src/helpers/sale-payment-summary.js'));
    w.eval(read('api/src/helpers/receipt-design.js'));
    w.eval(read('src/receipt-page-layout.js'));
    w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
    w.eval(read('frontend/static/script/js/modules/js/receipt-designer-editor.js'));
    const branch = { customer_print: false, branch_name: 'My Shop', logo: pixel, print_logoimg: true, footer_print: 'Thanks <b>again</b>', footer_qr_url: 'https://example.com/shop', footer_image: pixel, table_options: false };
    const design = w.PosnicPro.receiptDesigner.defaults(branch);
    // Existing saved designs keep their legacy layout; default templates are tested separately.
    for (const l of Object.values(design.layouts)) for (const b of l.blocks) {
        if (b.type === 'items') { b.itemLayout = 'detailed'; delete b.fontSize; }
        if (b.type === 'store') b.fssaiInHeader = false;
        if (b.type === 'transaction') b.showTitle = true;
    }
    const sale = { ...branch, receipt_designs: design, sales_id: 'S128', created_date: '19/09/2026', customer_name: '<script>bad()</script>', customer_gst_number: 'GST123',
        items: [{ item_name: 'Cup <em>large</em>', item_price: 12, item_quantity: 2, item_unit: 'ea', total_amount: 24 }], items_subtotal: 24, items_total: 26, tax: 2 };
    return { dom, w, $: w.$, branch, design, sale, engine: w.PosnicPro.receiptDesigner };
}

test('optional units, short row labels and heading render escaped across paper sizes', () => {
    const { dom, engine, sale, $ } = setup();
    sale.receipt_line_rows = [{ name: 'Pipe', qty: 2.5, unit: 'ft', rate: 32, amount: 80 }];
    sale.receipt_designs.customHeading = '<Invoice>';
    for (const format of Object.keys(contract.formats)) {
        const items = sale.receipt_designs.layouts[format].blocks.find(b => b.type === 'items');
        Object.assign(items, { showUnit: true, showRowNumbers: true, rowNumberLabel: 'No.' });
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('th.rd-unit').text(), 'Unit');
        assert.equal(output.find('td.rd-unit').text(), 'ft');
        assert.equal(output.find('th.rd-row-number').text(), 'No.');
        assert.equal(output.find('.rd-custom-heading').text(), '<Invoice>');
        assert.equal(output.find('Invoice').length, 0);
        assert.equal(output.find('thead th').length, output.find('tbody tr').first().find('td').length);
    }
    const normalized = contract.normalize(sale.receipt_designs);
    assert.equal(normalized.customHeading, '<Invoice>');
    assert.equal(normalized.layouts['80'].blocks.find(b => b.type === 'items').rowNumberLabel, 'No.');
    sale.receipt_designs.customHeading = '';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-custom-heading').length, 0);
    dom.window.close();
});

test('Thirukkural QR sits beside its saved verse and stacks on narrow paper', () => {
    const { dom, engine, sale, $ } = setup();
    sale.receipt_quote = require('../api/src/helpers/receipt-quote').select({ source: 'thirukkural', order: 'sequential', showQr: true }, 'S222');
    for (const format of Object.keys(contract.formats)) {
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('.rd-quote-qr').attr('src'), sale.receipt_quote.qr);
        assert.equal(output.find('.rd-quote-qr')[0].style.width, '22mm');
        assert.equal(output.find('.rd-quote')[0].style.flexDirection, format === '58' ? 'column' : '');
    }
    sale.receipt_quote.qr = 'https://untrusted.test/tracker.png';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-quote-qr').length, 0);
    dom.window.close();
});

test('receipt editor explicitly opts into the Thirukkural QR and saves the option', () => {
    const { dom, w, $, branch } = setup();
    let sent, target;
    w.PosnicPro.post = (request, done) => { target = JSON.parse(request.data).text; done({ type: 'success', data: { src: require('../api/src/data/thirukkural/qr.json')[0] } }); };
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: sent }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('#rd-quote-qr').prop('checked'), false);
    $('#rd-quote-source').val('thirukkural').trigger('change');
    assert.equal(target, undefined);
    $('#rd-quote-qr').prop('checked', true).trigger('change');
    assert.equal(target, 'https://www.posnic.com/tools/thirukural/1');
    $('#rd-quote-qr-size').val('18').trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.quoteFooter.qrSizeMm, 18);
    assert.equal(sent.receipt_designs.quoteFooter.showQr, true);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: sent.receipt_designs });
    assert.equal($('#rd-quote-qr').prop('checked'), true);
    dom.window.close();
});

test('saved quotes render safely on every paper size even after the library is disabled', () => {
    const { dom, engine, sale, $ } = setup();
    sale.receipt_quote = { source: 'custom', text: 'First line\n<script>second</script>' };
    sale.receipt_designs.quoteFooter = { source: 'none', order: 'sequential', quotes: [] };
    for (const format of Object.keys(contract.formats)) {
        const html = engine.render(sale, format, false);
        const output = $('<div>').html(html);
        assert.equal(output.find('.rd-quote').text(), sale.receipt_quote.text);
        assert.equal(output.find('.rd-quote script').length, 0);
        assert.equal(engine.render(sale, format, false), html);
    }
    dom.window.close();
});

test('paid receipts use settlement time on every paper format and keep it on reprint', () => {
    const { dom, engine, sale, $ } = setup();
    Object.assign(sale, { payment_status: 'Paid', created_date: '14/10/2026 8:50 AM',
        receipt_date: '14/10/2026 9:05 AM', updated_date: '14/10/2026 10:30 AM' });
    for (const format of Object.keys(contract.formats)) {
        const first = engine.render(sale, format, false);
        const text = $('<div>').html(first).text();
        assert.match(text, /9:05 AM/);
        assert.doesNotMatch(text, /8:50 AM|10:30 AM/);
        assert.equal(engine.render(sale, format, false), first);
    }
    assert.equal(sale.created_date, '14/10/2026 8:50 AM');
    dom.window.close();
});

test('canonical receipt lines supply both displayed quantities and total quantity', () => {
    const { dom, engine, sale, $ } = setup();
    sale.receipt_designs.layouts['80'].blocks = [{ type: 'items', itemLayout: 'columns' }, { type: 'field', field: 'total_quantity' }];
    sale.receipt_line_rows = [{ name: 'Veg Biryani', qty: 1, rate: 200, amount: 200 }];
    // The print payload may omit legacy lines or carry a different legacy shape.
    for (const items of [[], [{ item_name: 'Old line', item_quantity: 9 }]]) {
        sale.items = items;
        const output = $('<div>').html(engine.render(sale, '80', false));
        assert.equal(output.find('.rd-total-quantity .rd-number').text(), '1');
        assert.match(output.text(), /Veg Biryani/);
        assert.doesNotMatch(output.text(), /Old line/);
    }
    dom.window.close();
});

test('pending goods use the normal layout with a truthful status even without totals', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const layout of Object.values(design.layouts)) layout.blocks = layout.blocks.filter(b => b.type !== 'totals');
    const document = { ...sale, pending_goods_receipt: true, sales_id: '', payment_mode: 'Cash' };
    for (const format of Object.keys(contract.formats)) {
        const output = $('<div>').html(engine.render(document, format, false));
        assert.match(output.text(), /My Shop/);
        assert.match(output.text(), /Cup <em>large<\/em>/);
        assert.equal(output.find('.rd-payment-status').text(), 'Payment pending');
        assert.doesNotMatch(output.text(), /Tax invoice|Donation|Adjust Stock|PaymentCash/);
    }
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-payment-status').length, 0);
    dom.window.close();
});

test('extension print uses configured receipt rendering without clearing the sales workspace and propagates failure', async () => {
    const { dom, w, engine, sale } = setup();
    let afterPrint = 0, document;
    w.PosnicPro.afterPrint = () => { afterPrint++; };
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.electronAPI = { printer: { print: async html => { document = html; return { success: true }; } } };
    const options = { preserveWorkspace: true, propagateFailure: true };
    assert.equal((await engine.printSale({ ...sale, pending_goods_receipt: true, sales_id: '' }, '80', false, options)).success, true);
    assert.match(document, /Payment pending/);
    assert.equal(afterPrint, 0);
    w.electronAPI.printer.print = async () => ({ success: false, error: 'Printer unavailable' });
    await assert.rejects(engine.printSale(sale, '80', false, options), /Printer unavailable/);
    assert.equal(afterPrint, 0);
    dom.window.close();
});
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

test('saving printing behaviour does not submit or discard unsaved receipt designs', async () => {
    const { dom, w, $, branch } = setup();
    $('body').append('<div id="receipt-print-behaviour"></div><button id="save-print-behaviour"></button><span id="print-behaviour-status"></span>');
    const sent = [];
    let printerSaves = 0;
    w.PosnicPro.printSettings = { save: async () => { printerSaves++; return true; } };
    w.PosnicPro.put = (request, done) => {
        const data = JSON.parse(request.data); sent.push(data);
        done({ type: 'success', data: data });
    };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('[data-add="text"]').trigger('click');
    $('#rd-block-text').val('New layout text').trigger('input');
    $('#printall').prop('checked', true).trigger('change');
    $('#save-print-behaviour').trigger('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(printerSaves, 1);
    assert.deepEqual(sent[0], { printall: 'true', bill_print_copies: '1' });
    assert.match($('#print-behaviour-status').text(), /saved/);
    assert.match($('.rd-status').text(), /Unsaved/);
    $('[data-action="save"]').trigger('click');
    assert.ok(sent[1].receipt_designs.layouts['80'].blocks.some(b => b.text === 'New layout text'));
    assert.equal($('#printall').closest('#receipt-print-behaviour').length, 1);
    dom.window.close();
});

test('a failed device printer save prevents a misleading printing-options success', async () => {
    const { dom, w, $, branch } = setup();
    $('body').append('<button id="save-print-behaviour"></button><span id="print-behaviour-status"></span>');
    let writes = 0;
    w.PosnicPro.printSettings = { save: async () => false };
    w.PosnicPro.put = () => { writes++; };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('#save-print-behaviour').trigger('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 0);
    assert.equal($('#save-print-behaviour').prop('disabled'), false);
    dom.window.close();
});

test('FSSAI prints from current branch details on all formats and an explicit field controls its position', () => {
    const { dom, engine, design, sale, $ } = setup();
    sale.table_options = 'enable'; sale.country = 'India'; sale.branch_fssai_number = ' 12345678901234 ';
    for (const format of Object.keys(contract.formats)) {
        const render = () => $('<div>').html(engine.render(sale, format, false));
        assert.match(render().find('.rd-store').text(), /FSSAI: 12345678901234/);
        const field = engine.block('field', { field: 'fssai' });
        design.layouts[format].blocks.push(field);
        const output = render();
        assert.doesNotMatch(output.find('.rd-store').text(), /12345678901234/);
        assert.equal(output.find('.rd-field-fssai').text(), 'FSSAI: 12345678901234');
        assert.equal(output.find('[data-block-id]').last().attr('data-block-id'), field.id);
        sale.branch_fssai_number = '   ';
        assert.equal(render().find('.rd-field-fssai').length, 0);
        sale.branch_fssai_number = '12345678901234'; sale.table_options = false;
        assert.match(render().text(), /12345678901234/, 'Indian food retailers retain their configured licence without restaurant mode');
        sale.table_options = true;
    }
    dom.window.close();
});

test('FSSAI follows the restaurant outlet country on every format, including saved blocks', () => {
    const { dom, engine, design, sale, $ } = setup();
    sale.table_options = true; sale.branch_fssai_number = '12345678901234';
    sale.currency = 'INR'; sale.customer_country = 'India';
    for (const country of ['India', ' india ', 'IN', 'IND', 'United States', 'United Arab Emirates', 'Singapore', '', undefined]) {
        sale.country = country;
        const allowed = ['India', ' india ', 'IN', 'IND'].includes(country);
        for (const format of Object.keys(contract.formats)) {
            const render = () => $('<div>').html(engine.render(sale, format, false));
            assert.equal(render().text().includes('FSSAI: 12345678901234'), allowed, String(country));
            design.layouts[format].blocks.push(engine.block('field', { field: 'fssai', width: 50 }));
            assert.equal(render().text().includes('FSSAI: 12345678901234'), allowed, 'Saved field: ' + country);
            assert.equal(render().find('.rd-field-fssai').length, allowed ? 1 : 0);
            design.layouts[format].blocks.pop();
        }
    }
    dom.window.close();
});

test('country changes hide FSSAI controls and blocks without deleting saved licence details', () => {
    const { dom, w, $, branch, design, engine } = setup();
    branch.table_options = true; branch.country = 'India'; branch.branch_fssai_number = '12345678901234';
    design.layouts['80'].blocks.push(engine.block('field', { field: 'fssai' }));
    branch.receipt_designs = design;
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    for (const country of ['India', 'United States', '', 'India']) {
        branch.country = country;
        w.PosnicPro.receiptDesignerEditor.load(branch);
        const allowed = country === 'India';
        assert.equal($('[data-field="fssai"]').length, allowed ? 1 : 0);
        assert.equal($('.rd-block-list').text().includes('FSSAI'), allowed);
        assert.equal($('#branch_fssai_number').closest('.form-group').css('display') !== 'none', allowed);
        assert.equal($('[data-field="session"]').length, 1, 'Other restaurant fields remain available');
        $('[data-action="save"]').trigger('click');
        assert.equal(sent.branch_fssai_number, '12345678901234');
        assert.equal(sent.receipt_designs.layouts['80'].blocks.filter(b => b.field === 'fssai').length, 1);
    }
    branch.table_options = false;
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('[data-field="fssai"]').length, 1, 'Configured Indian food licence remains available');
    branch.branch_fssai_number = '';
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('[data-field="fssai"]').length, 0);
    assert.equal($('#branch_fssai_number').closest('.form-group').css('display'), 'none');
    dom.window.close();
});

test('adjacent half-width fields share a row, preserve styling and omit empty fields without blank cells', () => {
    const { dom, engine, design, sale, $ } = setup();
    sale.table_options = true; sale.serving_session = 'Lunch'; sale.covers = 2;
    for (const format of Object.keys(contract.formats)) {
        design.layouts[format].blocks.push(engine.block('field', { field: 'session', width: 50, bold: true, fontSize: 13 }), engine.block('field', { field: 'covers', width: 50 }));
    }
    sale.receipt_designs = contract.normalize(JSON.parse(JSON.stringify(design)));
    for (const format of Object.keys(contract.formats)) {
        const output = $('<div>').html(engine.render(sale, format, false));
        const row = output.find('.rd-field-row');
        assert.equal(row.length, 1); assert.equal(row.children().length, 2);
        assert.equal(row.text(), 'Session: LunchCovers: 2');
        assert.equal(row.find('.rd-field-session').css('font-size'), '13px');
        assert.ok(['bold', '700'].includes(row.find('.rd-field-session').css('font-weight')));
        const empty = $('<div>').html(engine.render({ ...sale, serving_session: ' \n ' }, format, false));
        assert.equal(empty.find('.rd-field-session,.rd-field-row').length, 0);
        assert.equal(empty.find('.rd-field-covers').text(), 'Covers: 2');
    }
    const b = design.layouts['80'].blocks;
    b.splice(b.length - 1, 0, engine.block('divider'));
    sale.receipt_designs = design;
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-field-row').length, 0, 'A divider remains a boundary');
    dom.window.close();
});

test('compact thermal items omit the unit-price line without losing amounts, discounts or HSN; sheets retain columns', async () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) Object.assign(design.layouts[format].blocks.find(b => b.type === 'items'), { itemLayout: 'compact', hsn: true });
    sale.receipt_designs = await resolveReceiptDesign(JSON.parse(JSON.stringify(design)));
    for (const format of ['58', '80']) {
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('tbody td').first().text(), 'Cup <em>large</em> × 2');
        assert.equal(output.find('tbody td').last().text(), '$ 24.00');
        assert.equal(output.find('.rd-line-detail,em').length, 0);
        assert.equal(output.find('th').first().text(), 'Item × Qty');
        const detail = $('<div>').html(engine.render({ ...sale, items: [{ ...sale.items[0], hsn_code: '1234', item_discount_percentage: 10 }] }, format, false));
        assert.match(detail.find('tbody').text(), /HSN\/SAC: 1234Discount: 10%/);
    }
    for (const format of ['a4', 'a5', 'letter']) {
        const output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('th').length, 4);
        assert.equal(output.find('tbody td').eq(1).text(), '2 ea');
        assert.equal(output.find('tbody td').eq(2).text(), '$ 12.00');
    }
    delete design.layouts['80'].blocks.find(b => b.type === 'items').itemLayout;
    sale.receipt_designs = contract.normalize(JSON.parse(JSON.stringify(design)));
    assert.match($('<div>').html(engine.render(sale, '80', false)).find('.rd-line-detail').text(), /2 ea × \$ 12.00/);
    dom.window.close();
});

test('customer fields omit missing and whitespace values, use short labels and print tax identity once', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) {
        design.layouts[format] = engine.standardLayout(format);
        const blank = { ...sale, customer_name: '\t', customer_phone: null, customer_email: false, customer_address: undefined, customer_gst_number: '  ' };
        let output = $('<div>').html(engine.render(blank, format, false));
        assert.equal(output.find('.rd-block-field,.rd-invoice-customer,.rd-customer-tax').length, 0);
        output = $('<div>').html(engine.render({ ...blank, customer_name: 'Alex', customer_phone: ' 012345 ', customer_tax_number: 'VAT-123' }, format, false));
        assert.equal(output.find('.rd-field-customer_name').text(), 'Name: Alex');
        assert.equal(output.find('.rd-field-customer_phone').text(), 'Phone: 012345');
        assert.equal(output.find('.rd-field-customer_tax_number').text(), 'Tax ID: VAT-123');
        assert.equal(output.find('.rd-customer-tax').length, 0);
        output = $('<div>').html(engine.render({ ...sale, customer_gstin: '  ', customer_phone: '012345' }, format, false));
        assert.equal(output.find('.rd-field-customer_tax_number').text(), 'GSTIN: GST123');
        assert.equal(output.find('.rd-customer-tax').length, 0);
        assert.doesNotMatch(output.find('.rd-block-field').text(), /Customer (name|phone|email|address)/);
        design.layouts[format].blocks = design.layouts[format].blocks.filter(b => b.field !== 'customer_tax_number');
        output = $('<div>').html(engine.render(sale, format, false));
        assert.equal(output.find('.rd-customer-tax').text(), 'GSTIN: GST123', 'Legacy layouts keep their tax identity');
    }
    dom.window.close();
});

test('document names follow the sale stage for every paper format including a saved restaurant bill', () => {
    const { dom, engine, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) {
        const title = (data, before) => $('<div>').html(engine.render(data, format, before)).find('.rd-invoice-title,.rd-transaction strong').text();
        assert.match(title(sale, false), /^Receipt/);
        assert.match(title(sale, true), /^Bill/);
        assert.match(title({ ...sale, branch_gstin_number: 'GST123' }, true), /^Tax invoice/);
        assert.match(title({ ...sale, branch_gstin_number: 'GST123' }, false), /^Receipt/);
        assert.doesNotMatch(title({ ...sale, sales_id: '' }, true), /Receipt|Invoice/i);
    }
    dom.window.close();
});

test('new field and item settings are validated and defaults keep existing saved templates compatible', () => {
    const { dom, engine, design } = setup();
    design.layouts['80'].blocks.push(engine.block('field', { field: 'customer_tax_number' }));
    const result = contract.normalize(JSON.parse(JSON.stringify(design)));
    assert.equal(result.layouts['80'].blocks.at(-1).width, 100);
    assert.equal(result.layouts['80'].blocks.find(b => b.type === 'items').itemLayout, 'detailed');
    design.layouts['80'].blocks.at(-1).width = 75;
    assert.throws(() => contract.normalize(design), /full or half width/);
    design.layouts['80'].blocks.at(-1).width = 50;
    design.layouts['80'].blocks.find(b => b.type === 'items').itemLayout = 'invalid';
    assert.throws(() => contract.normalize(design), /valid item layout/);
    dom.window.close();
});

test('thermal header preserves the full receipt number and localized clock with its day period', () => {
    const { dom, engine, sale, $ } = setup();
    for (const format of ['58', '80']) {
        for (const [date, clock] of [
            ['9/16/2026, 5:56:20 PM', '5:56:20 PM'],
            ['16/09/2026 5:56 PM', '5:56 PM'],
            ['16.09.2026, 17:56:20', '17:56:20'],
            ['16/09/2026 ٥:٥٦:٢٠ م', '٥:٥٦:٢٠ م'],
        ]) {
            const output = $('<div>').html(engine.render({ ...sale, sales_id: 'SAMPLE-001', created_date: date }, format, false));
            assert.equal(output.find('.rd-transaction strong').text(), 'Receipt SAMPLE-001');
            assert.equal(output.find('.rd-transaction strong .rd-header-value').text(), 'SAMPLE-001');
            assert.equal(output.find('.rd-transaction-date').text(), date);
            assert.equal(output.find('.rd-transaction-date .rd-header-value').last().text(), clock);
        }
        const plain = $('<div>').html(engine.render({ ...sale, sales_id: '<img src=x>', created_date: '19/09/2026' }, format, false));
        assert.equal(plain.find('.rd-transaction strong').text(), 'Receipt <img src=x>');
        assert.equal(plain.find('.rd-transaction-date').text(), '19/09/2026');
        assert.equal(plain.find('.rd-transaction img').length, 0);
    }
    dom.window.close();
});

test('editor saves half-width fields and compact items independently by format and reset can be cancelled or undone', () => {
    const { dom, w, $, branch, design } = setup();
    branch.table_options = true; branch.receipt_designs = contract.normalize(JSON.parse(JSON.stringify(design)));
    let sent;
    w.PosnicPro.put = (req, done) => { sent = JSON.parse(req.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    const original = JSON.stringify(branch.receipt_designs.layouts.a4);
    $('[data-add="field"][data-field="session"]').trigger('click');
    $('#rd-field-width').val('50').trigger('change');
    assert.match($('.rd-block-card.is-selected .rd-select').text(), /Half width/);
    $('[data-add="field"][data-field="covers"]').trigger('click');
    $('#rd-field-width').val('50').trigger('change');
    $('.rd-select').filter((_i, e) => $(e).text() === 'ItemsRequired').trigger('click');
    $('#rd-item-layout').val('compact').trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.find(b => b.type === 'items').itemLayout, 'compact');
    assert.deepEqual(sent.receipt_designs.layouts['80'].blocks.slice(-2).map(b => b.width), [50, 50]);
    assert.equal(JSON.stringify(sent.receipt_designs.layouts.a4), original);
    const compactDesign = JSON.stringify(sent.receipt_designs);
    $('[data-action="reset-template"]').trigger('click');
    assert.equal($('.rd-reset-confirm').prop('hidden'), false);
    $('[data-action="cancel-reset"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(JSON.stringify(sent.receipt_designs), compactDesign);
    $('[data-action="reset-template"]').trigger('click');
    $('[data-action="confirm-reset"]').trigger('click');
    assert.match($('.rd-status').text(), /Unsaved/);
    assert.equal(JSON.stringify(sent.receipt_designs), compactDesign, 'Reset does not save automatically');
    $('[data-action="undo"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(JSON.stringify(sent.receipt_designs), compactDesign);
    $('[data-action="reset-template"]').trigger('click');
    $('[data-action="confirm-reset"]').trigger('click');
    $('[data-action="save"]').trigger('click');
    assert.equal(JSON.stringify(sent.receipt_designs.layouts.a4), original);
    assert.equal(sent.receipt_designs.defaultFormat, '80');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.some(b => b.type === 'qr'), false, 'Standard templates do not restore obsolete legacy customizations');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.find(b => b.type === 'items').itemLayout, 'columns');
    assert.equal(sent.receipt_designs.layouts['80'].blocks.filter(b => b.field?.startsWith('customer_')).length, 4);
    assert.match($('iframe[title="Receipt design preview"]').attr('srcdoc'), /Tax ID:<\/strong> TAX-123456/, 'Adding a tax field has sample data to preview');
    $('[data-format="a4"]').trigger('click');
    $('.rd-select').filter((_i, e) => $(e).text() === 'ItemsRequired').trigger('click');
    assert.equal($('#rd-item-layout').length, 0, 'Sheet items retain a separate column design');
    dom.window.close();
});

test('FSSAI edits reach live preview and sample immediately, persist, and edits during a save remain unsaved', async () => {
    const { dom, w, $, branch, design } = setup();
    branch.table_options = true; branch.country = 'India'; branch.branch_fssai_number = '11111111111111';
    branch.receipt_designs = contract.normalize(JSON.parse(JSON.stringify(design)));
    let request, finish, sample;
    w.PosnicPro.put = (req, done) => { request = JSON.parse(req.data); finish = done; };
    w.PosnicPro.post = (req, done) => done({ type: 'success', data: { src: pixel } });
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.electronAPI = { printer: { print: async (html) => { sample = html; return { success: true }; } } };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('#branch_fssai_number').val(), '11111111111111');
    $('#branch_fssai_number').val('22222222222222').trigger('input');
    assert.equal($('.rd-status').text(), 'Unsaved changes');
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.match($('iframe[title="Receipt design preview"]').attr('srcdoc'), /22222222222222/);
    await w.PosnicPro.receiptDesignerEditor.printSample();
    assert.match(sample, /22222222222222/);
    $('[data-action="save"]').trigger('click');
    assert.equal(request.branch_fssai_number, '22222222222222');
    $('#branch_fssai_number').val('33333333333333').trigger('input');
    finish({ type: 'success', data: { receipt_designs: request.receipt_designs } });
    assert.equal(branch.branch_fssai_number, '22222222222222');
    assert.equal($('#branch_fssai_number').val(), '33333333333333');
    assert.match($('.rd-status').text(), /newer unsaved/);
    $('[data-action="save"]').trigger('click');
    finish({ type: 'success', data: { receipt_designs: request.receipt_designs } });
    assert.equal(branch.branch_fssai_number, '33333333333333');
    assert.equal($('.rd-status').text(), 'All designs saved');
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('#branch_fssai_number').val(), '33333333333333');
    $('#printall').prop('checked', true).trigger('change');
    assert.equal($('.rd-status').text(), 'Unsaved changes');
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

test('sheets compose page sections while thermal keeps its compact receipt layout', () => {
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
        assert.equal(output.find('.rd-invoice-meta').text(), 'ReceiptReceipt numberS128Date19/09/2026');
        assert.match(output.find('.rd-invoice-customer').text(), /Customer.*bad\(\).*555 0123/);
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
    assert.equal($('.rd-format-card').length, Object.keys(contract.formats).length);
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

 test('designer sample dates retain local date and minute precision without seconds', () => {
    const { dom, w, $, branch } = setup();
    let options;
    w.Date.prototype.toLocaleString = function (_locale, value) {
        options = value;
        return value && value.minute && !value.second ? '09/30/2026, 07:34 PM' : '09/30/2026, 07:34:47 PM';
    };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    const preview = $('.rd-preview-page iframe').attr('srcdoc');
    assert.match(preview, /07:34 PM/);
    assert.doesNotMatch(preview, /07:34:47/);
    assert.equal(options.year, 'numeric');
    assert.equal(options.minute, '2-digit');
    assert.equal(options.second, undefined);
    dom.window.close();
});


test('fixed thermal columns align quantity totals and shorten names; header omits title and puts FSSAI below GSTIN', () => {
    const { dom, engine, design, sale, $ } = setup();
    sale.table_options = true; sale.country = 'India';
    sale.branch_gstin_number = 'GST123'; sale.branch_fssai_number = '13521001000125';
    for (const format of ['58', '80']) {
        const blocks = design.layouts[format].blocks;
        Object.assign(blocks.find(b => b.type === 'items'), { itemLayout: 'columns', nameMaxChars: 16 });
        Object.assign(blocks.find(b => b.type === 'transaction'), { showTitle: false, fontSize: 10 });
        Object.assign(blocks.find(b => b.type === 'store'), { fssaiInHeader: true });
        blocks.push(engine.block('field', { field: 'total_quantity' }), engine.block('field', { field: 'fssai', width: 50 }));
        sale.items[0].item_name = 'Beach Style Full Fish Tawa Fry';
        sale.receipt_designs = contract.normalize(design);
        const output = $('<div>').html(engine.render(sale, format, true));
        assert.deepEqual(output.find('thead th').map((_, el) => $(el).text()).get(), ['Item name', 'Rate', 'Qty', 'Amount']);
        assert.equal(output.find('tbody tr:first td:first').text(), 'Beach Style Ful…');
        assert.equal(output.find('tbody tr:first td').eq(2).text(), '2');
        assert.equal(output.find('.rd-total-quantity td').eq(1).text(), '2');
        assert.equal(output.find('.rd-field-total_quantity,.rd-field-fssai').length, 0);
        assert.match(output.find('.rd-store').text(), /GSTIN: GST123FSSAI: 13521001000125/);
        assert.doesNotMatch(output.find('.rd-transaction').text(), /Tax invoice|Receipt/);
        assert.match(output.find('.rd-transaction').text(), /S128/);
    }
    assert.throws(() => { design.layouts['80'].blocks.find(b => b.type === 'items').nameMaxChars = 0; contract.normalize(design); }, /Item name length/);
    dom.window.close();
});


test('new thermal defaults and reset use dotted Item Rate Qty Amount with a quantity-aligned summary', () => {
    const { dom, engine, sale, $ } = setup();
    for (const format of ['58', '80']) {
        for (const design of [engine.defaults(sale), { ...engine.defaults(sale), layouts: { ...engine.defaults(sale).layouts, [format]: engine.standardLayout(format) } }]) {
            const data = { ...sale, receipt_designs: contract.normalize(design), items: [
                {item_name:'Chapathi', item_price:30, item_quantity:3, total_amount:90},
                {item_name:'Garlic naan', item_price:90, item_quantity:2, total_amount:180}
            ] };
            const out = $('<div>').html(engine.render(data, format, true));
            assert.deepEqual(out.find('thead th').map((_, el) => $(el).text()).get(), ['Item name','Rate','Qty','Amount']);
            assert.deepEqual(out.find('tbody tr:first td').map((_, el) => $(el).text()).get(), ['Chapathi','30.00','3','90.00']);
            assert.equal(out.find('.rd-total-quantity td').eq(0).attr('colspan'), '2');
            assert.equal(out.find('.rd-total-quantity td').eq(0).text(), 'Total Items: 2');
            assert.equal(out.find('.rd-total-quantity td').eq(1).text(), '5');
            assert.match(out.find('style').text(), /border-top:1px dotted/);
            design.layouts[format].blocks.find(b => b.type === 'items').lineStyle = 'dashed';
            const customized = $('<div>').html(engine.render({...data, receipt_designs:contract.normalize(design)},format,true));
            assert.match(customized.find('style').text(), /border-top:1px dashed/);
        }
    }
    dom.window.close();
});


test('short thermal headers label the bill only when space allows and never truncate its number', () => {
    const { dom, engine, sale, $ } = setup();
    sale.receipt_designs = engine.defaults(sale);
    sale.sales_id = 'SB1D28-27-000130'; sale.created_date = '01/10/2026 03:03 pm';
    const wide = $('<div>').html(engine.render(sale, '80', true));
    assert.equal(wide.find('.rd-transaction strong').text(), 'Bill no: SB1D28-27-000130');
    const narrow = $('<div>').html(engine.render(sale, '58', true));
    assert.equal(narrow.find('.rd-transaction strong').text(), sale.sales_id);
    sale.sales_id = 'A'.repeat(60);
    const long = $('<div>').html(engine.render(sale, '80', true));
    assert.equal(long.find('.rd-transaction strong').text(), sale.sales_id);
    assert.equal(long.find('.rd-transaction-date').text(), sale.created_date);
    dom.window.close();
});

test('thermal receipt custom label and date/time choices survive normalization', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of ['58', '80']) {
        const b = design.layouts[format].blocks.find(b => b.type === 'transaction');
        Object.assign(b, { labelText: 'Bill No:', dateFormat: 'dmy-short', timeFormat: '24h' });
        sale.receipt_designs = contract.normalize(design);
        sale.created_date = '01/10/2026 07:05:44 PM';
        let out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('.rd-transaction strong').text(), 'Bill No: S128');
        assert.equal(out.find('.rd-transaction-date').text(), '01/10/26 19:05');
        b.dateFormat = 'ymd'; b.timeFormat = '12h';
        sale.receipt_designs = contract.normalize(design);
        sale.created_date = '01/10/2026 00:05';
        out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('.rd-transaction-date').text(), '2026-10-01 12:05 AM');
        b.timeFormat = 'none'; b.labelText = '<img src=x onerror=alert(1)>';
        sale.receipt_designs = contract.normalize(design);
        out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('.rd-transaction-date').text(), '2026-10-01');
        assert.equal(out.find('.rd-transaction img').length, 0);
    }
    for (const value of [{ dateFormat: 'bad' }, { timeFormat: 'bad' }, { labelText: 'x'.repeat(41) }]) {
        Object.assign(design.layouts['80'].blocks.find(b => b.type === 'transaction'), value);
        assert.throws(() => contract.normalize(design));
    }
    dom.window.close();
});

test('receipt detail controls update the preview and save only the selected paper format', () => {
    const { dom, w, $, branch } = setup();
    let saved;
    w.PosnicPro.put = (request, done) => {
        saved = JSON.parse(request.data).receipt_designs;
        done({ type: 'success', data: { receipt_designs: saved } });
    };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('[data-format="80"]').trigger('click');
    $('.rd-select').filter((_, e) => $(e).text().includes('Receipt details')).trigger('click');
    assert.equal($('[data-prop="labelText"]').length, 1);
    $('[data-prop="labelText"]').val('Bill No:').trigger('input');
    $('[data-prop="dateFormat"]').val('ymd').trigger('change');
    $('[data-prop="timeFormat"]').val('24h').trigger('change');
    $('[data-action="save"]').trigger('click');
    const block = saved.layouts['80'].blocks.find(b => b.type === 'transaction');
    assert.equal(block.labelText, 'Bill No:');
    assert.equal(block.dateFormat, 'ymd');
    assert.equal(block.timeFormat, '24h');
    assert.equal(saved.layouts['58'].blocks.find(b => b.type === 'transaction').labelText, undefined);
    dom.window.close();
});

test('custom receipt date respects month-first tender data and noon/midnight', () => {
    const { dom, engine, design, sale, $ } = setup();
    const b = design.layouts['80'].blocks.find(b => b.type === 'transaction');
    b.dateFormat = 'dmy'; b.timeFormat = '24h';
    sale.receipt_date_order = 'mdy';
    sale.created_date = '10/01/2026 12:05 AM';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-transaction-date').text(), '01/10/2026 00:05');
    sale.created_date = '10/01/2026 12:05 PM';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-transaction-date').text(), '01/10/2026 12:05');
    sale.created_date = 'unrecognized historical date';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-transaction-date').text(), sale.created_date);
    dom.window.close();
});


test('printing progress stays visible until submission resolves and clears on failure', async () => {
    const { dom, w, $, engine } = setup();
    let submit;
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.electronAPI = { printer: { print: () => new Promise(resolve => { submit = resolve; }) } };
    const job = engine.print('<article>Total 840.00</article>', '80', { sample: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal($('#receipt-print-progress[role="status"]').length, 1);
    submit({ success: false, error: 'Receipt preparation timed out' });
    await assert.rejects(job, /timed out/);
    assert.equal($('#receipt-print-progress').length, 0);
    dom.window.close();
});


test('repeated sale print clicks share one in-flight submission and allow a later reprint', async () => {
    const { dom, w, $, engine, sale } = setup();
    let release, sends = 0, after = 0;
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.PosnicPro.afterPrint = () => { after++; };
    w.electronAPI = { printer: { print: () => { sends++; return new Promise(resolve => { release = resolve; }); } } };
    const first = engine.printSale(sale, '80');
    await new Promise(resolve => setImmediate(resolve));
    await engine.printSale(sale, '80');
    assert.equal(sends, 1);
    assert.equal($('#receipt-print-progress').length, 1);
    release({ success: true }); await first;
    assert.equal(after, 1); assert.equal($('#receipt-print-progress').length, 0);
    const next = engine.printSale(sale, '80');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sends, 2); release({ success: true }); await next;
    dom.window.close();
});

test('UK receipts label the saved registration number as VAT, including legacy GST fields',()=>{
 const {dom,engine,sale,$}=setup();
 for(const format of ['58','80','a4']) {
  const output=$('<div>').html(engine.render({...sale,country:'United Kingdom',branch_gstin_number:'464448078'},format,false));
  assert.match(output.text(),/VAT No\.: 464448078/);
  assert.doesNotMatch(output.text(),/GSTIN/);
 }
 assert.equal(contract.taxRegistrationLabel({country:'India'}),'GSTIN');
 assert.equal(contract.taxRegistrationLabel({country:'US'}),'Tax ID');
 assert.equal(contract.taxRegistrationLabel({},'GB'),'VAT No.');
 dom.window.close();
});


test('RP 4200 migrates saved 80 mm content independently and keeps email and row options', () => {
    const { dom, engine, design, sale, $ } = setup();
    delete design.layouts['112'];
    const store = design.layouts['80'].blocks.find(b => b.type === 'store');
    const items = design.layouts['80'].blocks.find(b => b.type === 'items');
    store.showEmail = false;
    items.showRowNumbers = true;
    const saved = contract.normalize(JSON.parse(JSON.stringify(design)));
    assert.equal(saved.layouts['112'].blocks.find(b => b.type === 'store').showEmail, false);
    assert.equal(saved.layouts['112'].blocks.find(b => b.type === 'items').showRowNumbers, true);
    saved.layouts['112'].fontSize = 14;
    assert.notEqual(saved.layouts['80'].fontSize, 14);
    sale.receipt_designs = saved;
    sale.store_email = 'shop@example.com';
    sale.items.push({ item_name: 'Second item', item_price: 5, item_quantity: 1, total_amount: 5 });
    const output = $('<div>').html(engine.render(sale, '112', false));
    assert.equal(output.find('[data-receipt-design]').attr('data-receipt-design'), '112');
    assert.doesNotMatch(output.text(), /shop@example.com/);
    assert.deepEqual(output.find('tbody .rd-row-number').map((i, e) => $(e).text()).get(), ['1', '2']);
    saved.layouts['112'].blocks.find(b => b.type === 'store').showEmail = true;
    assert.match($('<div>').html(engine.render(sale, '112', false)).text(), /shop@example.com/);
    dom.window.close();
});


test('fast text preserves rendered payment allocations and rounding; graphics and Tamil fall back', () => {
    const { dom, engine } = setup();
    try {
        const html = '<section class="rd-document"><h1>Shop</h1><table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr><tr><td>Rice</td><td>2</td><td>499.50</td></tr></table><div>Round Off <span>₹0.50</span></div><div>Total ₹500.00</div><div>UPI ₹300.00</div><div>Cash ₹200.00</div><div style="display:none">secret@example.com</div></section>';
        const lines = engine.fastLines(html);
        assert.match(lines.join('\n'), /UPI Rs. 300.00/);
        assert.match(lines.join('\n'), /Cash Rs. 200.00/);
        assert.match(lines.join('\n'), /Round Off Rs. 0.50/);
        assert.match(lines.join('\n'), /Rice.*2.*499.50/);
        assert.doesNotMatch(lines.join('\n'), /secret/);
        assert.equal(engine.fastLines('<div class="rd-document">தமிழ்</div>'), null);
        assert.equal(engine.fastLines('<div class="rd-document"><img src="logo.png">Shop</div>'), null);
    } finally { dom.window.close(); }
});


test('custom product and bill labels survive normalization on every paper size, with removable branding', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) {
        design.layouts[format].blocks.find(b => b.type === 'items').heading = 'Product <name>';
        design.layouts[format].blocks.find(b => b.type === 'transaction').labelText = 'Invoice No.';
    }
    sale.receipt_designs = contract.normalize(design);
    for (const format of Object.keys(contract.formats)) {
        const out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('thead th').first().text(), 'Product <name>');
        assert.match(out.find('.rd-block-transaction').text(), /Invoice No.*S128/);
        assert.equal(out.find('.rd-branding').length, 1);
        assert.equal(out.find('name').length, 0);
    }
    sale.receipt_designs.showBranding = false;
    sale.receipt_designs = contract.normalize(sale.receipt_designs);
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-branding').length, 0);
    dom.window.close();
});

test('first-time designs include customer details and greeting but preserve explicit customer opt-out', () => {
    const { dom, engine } = setup();
    const fresh = engine.defaults({});
    for (const layout of Object.values(fresh.layouts)) {
        assert.ok(layout.blocks.some(b => b.field === 'customer_name'));
        assert.ok(layout.blocks.some(b => b.field === 'customer_phone'));
        assert.ok(!layout.blocks.some(b => b.field === 'customer_email'));
        assert.ok(layout.blocks.some(b => b.text === 'Thank you! Visit again.'));
    }
    assert.ok(!engine.defaults({customer_print:'false'}).layouts['80'].blocks.some(b => b.field === 'customer_name'));
    dom.window.close();
});

test('four-inch fixed columns give HSN its own column and keep quantity totals aligned', () => {
    const { dom, engine, sale, design, $ } = setup();
    for (const format of ['58', '80', '112']) {
        design.layouts[format].blocks = [{ type: 'items', itemLayout: 'columns', hsn: true }, { type: 'field', field: 'total_quantity' }];
    }
    sale.items[0].hsncode = '12345678';
    sale.items.push({ item_name: 'Without HSN', item_price: 2, item_quantity: 1, total_amount: 2 });
    const output = $('<div>').html(engine.render(sale, '112', false));
    assert.deepEqual(output.find('thead th').map((_i, el) => $(el).text()).get(), ['Item name', 'HSN', 'Rate', 'Qty', 'Amount']);
    assert.equal(output.find('tbody tr').first().children().length, 5);
    assert.equal(output.find('.rd-hsn').first().text(), '12345678');
    assert.equal(output.find('.rd-hsn').last().text(), '');
    assert.equal(output.find('.rd-total-quantity td').first().attr('colspan'), '3');
    assert.equal(output.find('.rd-total-quantity .rd-number').text(), '3');
    assert.equal(output.find('col').toArray().reduce((sum, el) => sum + parseFloat(el.style.width), 0), 100);
    for (const format of ['58', '80']) {
        const narrow = $('<div>').html(engine.render(sale, format, false));
        assert.equal(narrow.find('thead th').length, 4);
        assert.match(narrow.find('.rd-line-detail').text(), /HSN\/SAC: 12345678/);
    }
    design.layouts['112'].blocks[0].hsn = false;
    const hidden = $('<div>').html(engine.render(sale, '112', false));
    assert.equal(hidden.find('thead th').length, 4);
    assert.doesNotMatch(hidden.text(), /12345678|HSN\/SAC/);
    dom.window.close();
});

test('sale printing sends receipt identity to desktop logging while sample printing does not', async () => {
    const { dom, w, engine, sale } = setup();
    const sent = [];
    w.PosnicPro.resolveReceiptPrinter = () => 'Counter';
    w.PosnicPro.afterPrint = () => {};
    w.electronAPI = { printer: { print: async (_html, options) => { sent.push(options); return { success: true }; } } };
    await engine.printSale(sale, '80');
    assert.equal(sent[0].receiptLog.saleId, sale.sales_id);
    assert.equal(sent[0].receiptLog.total, sale.items_total);
    await engine.print('<article>Sample</article>', '80', { sample: true });
    assert.equal(sent[1].receiptLog, null);
    dom.window.close();
});

test('custom footer text saves, reloads and renders safely on every paper size', () => {
    const { dom, w, $, branch, sale, engine } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    const custom = 'Printed by <Shop> · example.com';
    $('#rd-branding-text').val(custom).trigger('input');
    $('[data-action="save"]').trigger('click');
    const saved = contract.normalize(sent.receipt_designs);
    assert.equal(saved.brandingText, custom);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: saved });
    assert.equal($('#rd-branding-text').val(), custom);
    sale.receipt_designs = saved;
    for (const format of Object.keys(contract.formats)) {
        const footer = $('<div>').html(engine.render(sale, format, false)).find('.rd-branding');
        assert.equal(footer.text(), custom);
        assert.equal(footer.children().length, 0);
    }
    saved.showBranding = false;
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-branding').length, 0);
    saved.showBranding = true;
    saved.brandingText = '   ';
    assert.equal($('<div>').html(engine.render(sale, '80', false)).find('.rd-branding').text(), 'Made with Posnic · posnic.com');
    assert.throws(() => contract.normalize({ ...saved, brandingText: 'x'.repeat(201) }), /200 characters/);
    assert.throws(() => contract.normalize({ ...saved, brandingText: {} }), /200 characters/);
    dom.window.close();
});

test('store print overrides persist per format without changing branch contact data', () => {
    const { dom, w, $, branch, sale, engine } = setup();
    branch.store_telephone = '+919876543210';
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('.rd-block-card').filter((i, e) => $(e).find('.rd-select').text().startsWith('Store details')).find('.rd-select').trigger('click');
    $('[data-prop="phoneText"]').val('98765 43210').trigger('input');
    $('[data-prop="nameText"]').val('Receipt shop').trigger('input');
    $('[data-prop="addressText"]').val('First line\nSecond line').trigger('input');
    $('[data-action="save"]').trigger('click');
    const saved = contract.normalize(sent.receipt_designs);
    assert.equal(saved.layouts['80'].blocks.find(b => b.type === 'store').phoneText, '98765 43210');
    assert.equal(saved.layouts['112'].blocks.find(b => b.type === 'store').phoneText, undefined);
    assert.equal(sent.store_telephone, undefined);
    assert.equal(branch.store_telephone, '+919876543210');
    Object.assign(sale, { receipt_designs: saved, store_telephone: branch.store_telephone });
    assert.match($('<div>').html(engine.render(sale, '80', false)).find('.rd-store').text(), /98765 43210/);
    assert.doesNotMatch($('<div>').html(engine.render(sale, '80', false)).find('.rd-store').text(), /\+91/);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: saved });
    $('.rd-block-card').filter((i, e) => $(e).find('.rd-select').text().startsWith('Store details')).find('.rd-select').trigger('click');
    assert.equal($('[data-prop="phoneText"]').val(), '98765 43210');
    dom.window.close();
});

test('missing branch addresses never print placeholder text in any receipt format', () => {
    const { dom, $, engine, sale, design } = setup();
    for (const format of Object.keys(contract.formats)) {
        const store = design.layouts[format].blocks.find(b => b.type === 'store');
        Object.assign(sale, { printing_address: ' Not provided ', store_address: '' });
        sale.receipt_designs = design;
        const address = () => $('<div>').html(engine.render(sale, format, false)).find('.rd-store-contact').text();
        assert.equal(address(), '');
        sale.store_address = '12 Market Road';
        assert.equal(address(), '12 Market Road');
        store.addressText = 'Receipt address';
        assert.equal(address(), 'Receipt address');
        store.addressText = 'Not provided';
        assert.equal(address(), '12 Market Road');
    }
    dom.window.close();
});

test('store visibility, empty overrides, escaping and validation apply to every format', () => {
    const { dom, $, engine, sale, design } = setup();
    sale.store_telephone = '+919876543210';
    for (const format of Object.keys(contract.formats)) {
        const store = design.layouts[format].blocks.find(b => b.type === 'store');
        Object.assign(store, { nameText: '<b>Shop</b>', phoneText: '   ', addressText: 'New address', registrationText: 'CUSTOM123' });
        sale.receipt_designs = contract.normalize(design);
        let output = $('<div>').html(engine.render(sale, format, false)).find('.rd-store');
        assert.equal(output.find('h1').text(), '<b>Shop</b>');
        assert.equal(output.find('h1 b').length, 0);
        assert.match(output.text(), /\+919876543210/);
        assert.match(output.text(), /CUSTOM123/);
        Object.assign(store, { showName: false, showAddress: false, showPhone: false, showEmail: false, showRegistration: false });
        sale.receipt_designs = contract.normalize(design);
        output = $('<div>').html(engine.render(sale, format, false)).find('.rd-store');
        assert.equal(output.text(), '');
    }
    design.layouts['80'].blocks.find(b => b.type === 'store').phoneText = '1'.repeat(101);
    assert.throws(() => contract.normalize(design), /too long/);
    dom.window.close();
});

test('designer samples include GST, switch to IGST, and respect tax disabled', async () => {
    const { dom, w, $, engine, branch } = setup();
    Object.assign(branch, { indian_gst: 'gst_on', country: 'India', module_tax_enable: true });
    let document;
    engine.print = async html => { document = html; return { success: true }; };
    const editor = w.PosnicPro.receiptDesignerEditor;
    editor.load(branch);
    await editor.printSample();
    assert.match(document, /CGST 2.5%/); assert.match(document, /SGST 2.5%/);
    assert.match($('<div>').html(document).text(), /47.25/);
    $('#rd-sample-tax').val('inter').trigger('change');
    await editor.printSample();
    assert.match(document, /IGST 5%/); assert.doesNotMatch(document, /CGST|SGST/);
    branch.module_tax_enable = false; editor.load(branch);
    await editor.printSample();
    assert.doesNotMatch(document, /IGST|CGST|SGST/);
    assert.equal($('#rd-sample-tax').length, 0);
    dom.window.close();
});

test('zero tax rows are omitted while real small amounts and saved tax labels remain', () => {
    const { dom, engine, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) {
        sale.tax = 0;
        sale.receipt_tax_rows = [{ label: 'VAT', amount: 0 }, { label: 'CGST', amount: '0.00' }, { label: 'SGST', amount: 0.000001 }];
        const totals = () => $('<div>').html(engine.render(sale, format, false)).find('.rd-totals').text();
        assert.doesNotMatch(totals(), /VAT|CGST|SGST/);
        sale.receipt_tax_rows = [{ label: 'CGST', amount: 0.02 }, { label: 'SGST', amount: 0.01 }];
        assert.match(totals(), /CGST.*0.02.*SGST.*0.01/);
        sale.receipt_tax_rows = [{ label: 'Local sales levy', amount: 2 }];
        assert.match(totals(), /Local sales levy/);
    }
    dom.window.close();
});

test('sample tax follows country even without the old India GST flag and hides when disabled', async () => {
    const { dom, w, engine, branch } = setup();
    let document;
    engine.print = async html => { document = html; return { success: true }; };
    for (const [country, label] of [['India', 'CGST 2.5%'], ['South Africa', 'VAT 5%'], ['United Kingdom', 'VAT 5%'], ['Australia', 'GST 5%']]) {
        Object.assign(branch, { country, indian_gst: 'gst_off', module_tax_enable: true });
        w.PosnicPro.receiptDesignerEditor.load(branch);
        await w.PosnicPro.receiptDesignerEditor.printSample();
        assert.ok(document.includes(label), country);
        branch.module_tax_enable = false;
        w.PosnicPro.receiptDesignerEditor.load(branch);
        await w.PosnicPro.receiptDesignerEditor.printSample();
        assert.ok(!document.includes(label), country);
    }
    dom.window.close();
});

test('receipt fallback preserves independently saved CGST and SGST amounts', () => {
    const { dom, engine, sale, $ } = setup();
    sale.items[0].cgst_tax = 1.13; sale.items[0].sgst_tax = 1.12;
    const text = $('<div>').html(engine.render(sale, '112', false)).text();
    assert.match(text, /CGST.*1.13/); assert.match(text, /SGST.*1.12/);
    sale.receipt_tax_rows = [{ label: 'IGST 5%', amount: 2.25 }];
    const saved = $('<div>').html(engine.render(sale, '112', false)).text();
    assert.match(saved, /IGST 5%/); assert.doesNotMatch(saved, /CGST|SGST/);
    dom.window.close();
});

test('pre-save receipt states that the number is pending and final receipt removes that notice', () => {
    const { dom, engine, sale, $ } = setup();
    sale.sales_id = '';
    assert.match($('<div>').html(engine.render(sale, '112', true)).text(), /Receipt number is assigned after saving/);
    sale.sales_id = 'INV-123';
    const saved = $('<div>').html(engine.render(sale, '112', false));
    assert.equal(saved.find('.rd-pending-number').length, 0);
    assert.match(saved.text(), /INV-123/);
    dom.window.close();
});

test('store FSSAI control is limited to Indian restaurants and configured food businesses', () => {
    const { dom, w, $, branch } = setup();
    for (const [country, restaurant, licence, allowed] of [
        ['India', true, '', true], ['IN', false, '12345678901234', true],
        ['India', false, '', false], ['United Kingdom', true, '12345678901234', false],
        ['', true, '12345678901234', false], ['United States', false, '', false]
    ]) {
        Object.assign(branch, { country, table_options: restaurant, branch_fssai_number: licence });
        w.PosnicPro.receiptDesignerEditor.load(branch);
        $('.rd-block-card').filter((i, e) => $(e).find('.rd-select').text().startsWith('Store details')).find('.rd-select').trigger('click');
        assert.equal($('[data-prop="fssaiInHeader"]').length, allowed ? 1 : 0, country + '/' + restaurant + '/' + licence);
        assert.equal($('[data-field="fssai"]').length, allowed ? 1 : 0);
        assert.equal(contract.fieldAvailable('table', branch), restaurant, 'food licence does not enable restaurant fields');
    }
    dom.window.close();
});

test('serial numbers occupy a separate optional column on every format and layout', () => {
    const { dom, engine, design, sale, $ } = setup();
    for (const format of Object.keys(contract.formats)) for (const layout of ['columns', 'compact', 'detailed']) {
        const items = design.layouts[format].blocks.find(b => b.type === 'items');
        Object.assign(items, { showRowNumbers: true, itemLayout: layout, hsn: true });
        let out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('thead th').first().text(), 'S.No');
        assert.equal(out.find('tbody tr').first().children().first().text(), '1');
        assert.match(out.find('tbody tr').first().children().eq(1).text(), /^Cup/);
        assert.equal(out.find('col').length, out.find('thead th').length);
        items.showRowNumbers = false;
        out = $('<div>').html(engine.render(sale, format, false));
        assert.equal(out.find('.rd-row-number').length, 0);
    }
    dom.window.close();
});

test('payment method preference survives save and reload independently per format', () => {
    const { dom, w, $, branch } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: { receipt_designs: sent.receipt_designs } }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    const selectTotals = () => $('.rd-block-card').filter((i, e) => $(e).find('.rd-select').text().startsWith('Totals')).find('.rd-select').trigger('click');
    selectTotals();
    assert.equal($('[data-prop="showPaymentMethod"]').prop('checked'), true);
    $('[data-prop="showPaymentMethod"]').prop('checked', false).trigger('change');
    $('[data-action="save"]').trigger('click');
    const saved = contract.normalize(sent.receipt_designs);
    assert.equal(saved.layouts['80'].blocks.find(b => b.type === 'totals').showPaymentMethod, false);
    assert.equal(saved.layouts['112'].blocks.find(b => b.type === 'totals').showPaymentMethod, true);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: saved });
    selectTotals();
    assert.equal($('[data-prop="showPaymentMethod"]').prop('checked'), false);
    dom.window.close();
});

test('hiding payment method removes cash and card without hiding totals or balance due', () => {
    const { dom, engine, design, sale, $ } = setup();
    Object.assign(sale, { payment_mode: 'Card', partial_check: true, partial_balance: 10, payment_pending: 16 });
    for (const format of Object.keys(contract.formats)) {
        const totals = design.layouts[format].blocks.find(b => b.type === 'totals');
        assert.match($('<div>').html(engine.render(sale, format, false)).text(), /Card/);
        totals.showPaymentMethod = false;
        let output = $('<div>').html(engine.render(sale, format, false));
        assert.doesNotMatch(output.text(), /Card/);
        assert.match(output.text(), /Balance due/);
        assert.match(output.text(), /26\.00/);
        sale.payment_mode = 'Cash';
        output = $('<div>').html(engine.render(sale, format, false));
        assert.doesNotMatch(output.text(), /Cash/);
        sale.payment_mode = 'Card';
    }
    dom.window.close();
});

test('GBP and EUR receipts stay on Fast receipt without raster fallback', () => {
    const {dom, engine} = setup();
    try {
      const lines = engine.fastLines('<section class="rd-document"><p>Total \u00a31.50</p><p>Cash \u00a32.00</p><p>Change \u00a30.50</p><p>Total \u20ac3.00</p></section>');
      assert.ok(lines);
      const bytes = require('../src/receipt-fast').renderFastReceipt(lines, '80').toString('ascii');
      assert.match(bytes, /Total GBP 1.50/); assert.match(bytes, /Cash GBP 2.00/);
      assert.match(bytes, /Change GBP 0.50/); assert.match(bytes, /Total EUR 3.00/);
    } finally { dom.window.close(); }
});

test('quote settings hide irrelevant controls and preserve explicit QR dimensions', () => {
    const { dom, w, $, branch, sale, engine } = setup();
    w.PosnicPro.receiptDesignerEditor.load(branch);
    assert.equal($('.rd-quote-qr-options').prop('hidden'), true);
    assert.equal($('.rd-custom-quotes').prop('hidden'), true);
    $('#rd-quote-source').val('custom').trigger('change');
    assert.equal($('.rd-custom-quotes').prop('hidden'), false);
    sale.receipt_quote = require('../api/src/helpers/receipt-quote').select({ source: 'thirukkural', order: 'sequential', showQr: true }, 'S1');
    for (const size of [18, 22, 26]) {
        sale.receipt_designs.quoteFooter = { source: 'thirukkural', order: 'sequential', quotes: [], qrSizeMm: size };
        assert.equal(contract.normalize(sale.receipt_designs).quoteFooter.qrSizeMm, size);
        const output = $('<div>').html(engine.render(sale, '80', false));
        assert.equal(output.find('.rd-quote-qr')[0].style.width, size + 'mm');
        assert.equal(output.find('.rd-quote').text(), sale.receipt_quote.text);
    }
    sale.receipt_designs.quoteFooter.qrSizeMm = 4;
    assert.throws(() => contract.normalize(sale.receipt_designs), /QR size/);
    dom.window.close();
});

test('unit follows quantity and quantity totals retain their column while amount stays last', () => {
    const {dom,engine,sale,$}=setup();
    for(const format of Object.keys(contract.formats)) for(const showUnit of [true,false]) for(const serial of [true,false]) {
        const layout=sale.receipt_designs.layouts[format];
        const items=layout.blocks.find(b=>b.type==='items');
        Object.assign(items,{itemLayout:'columns',showUnit,showRowNumbers:serial,hsn:true});
        if(!layout.blocks.some(b=>b.field==='total_quantity')) layout.blocks.push({id:'quantity-total',type:'field',field:'total_quantity'});
        const output=$('<div>').html(engine.render(sale,format,false));
        const headers=output.find('thead th');
        assert.equal(headers.last().text(),'Amount');
        const quantityIndex=headers.index(headers.filter('.rd-quantity'));
        if(showUnit) assert.equal(headers.index(headers.filter('.rd-unit')),quantityIndex+1);
        const row=output.find('tbody tr').first();
        assert.equal(row.find('td').last().hasClass('rd-amount'),true);
        const total=output.find('.rd-total-quantity');
        assert.equal(total.length,1);
        assert.equal(Number(total.find('td').first().attr('colspan')),quantityIndex);
        assert.equal(total.find('.rd-quantity').text(),'2');
        assert.equal(output.find('.rd-field-total_quantity').length,0);
    }
    dom.window.close();
});

test('quote manager applies numbered multiline rows, cancels edits and persists fixed selection', () => {
    const { dom, w, $, branch } = setup();
    let sent;
    w.PosnicPro.put = (request, done) => { sent = JSON.parse(request.data); done({ type: 'success', data: sent }); };
    w.PosnicPro.receiptDesignerEditor.load(branch);
    $('#rd-quote-source').val('custom').trigger('change');
    $('#rd-manage-quotes').trigger('click');
    const popup = () => $('.rd-quotes-dialog');
    popup().find('textarea').val('First\nsecond line').trigger('input');
    popup().find('[data-q="add"]').trigger('click');
    popup().find('textarea').last().val('Other quote').trigger('input');
    popup().find('[data-q="up"]').last().trigger('click');
    assert.equal(popup().find('textarea').first().val(), 'Other quote');
    popup().find('[data-q="apply"]').trigger('click');
    assert.equal(popup().length, 0);
    assert.equal($('#rd-quote-count').text(), '2 / 200 quotes');
    $('#rd-manage-quotes').trigger('click');
    popup().find('[data-q="remove"]').first().trigger('click');
    popup().find('[data-q="cancel"]').first().trigger('click');
    assert.equal($('#rd-quote-count').text(), '2 / 200 quotes');
    $('#rd-quote-order').val('fixed').trigger('change');
    $('#rd-quote-number').val('2').trigger('change');
    $('[data-action="save"]').trigger('click');
    assert.deepEqual(sent.receipt_designs.quoteFooter.quotes, ['Other quote', 'First\nsecond line']);
    assert.equal(sent.receipt_designs.quoteFooter.selectedNumber, 2);
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: sent.receipt_designs });
    assert.equal($('#rd-quote-number').val(), '2');
    assert.equal($('.rd-fixed-quote').prop('hidden'), false);
    $('#rd-manage-quotes').trigger('click');
    popup().find('[data-q="add"]').trigger('click');
    popup().find('[data-q="apply"]').trigger('click');
    assert.match(popup().find('[role="alert"]').text(), /Enter a quote/);
    popup().find('[data-q="remove"]').last().trigger('click');
    popup().find('[data-q="remove"]').first().trigger('click');
    popup().find('[data-q="apply"]').trigger('click');
    assert.equal($('#rd-quote-number').val(), '1');
    $('[data-action="undo"]').trigger('click');
    assert.equal($('#rd-quote-count').text(), '2 / 200 quotes');
    assert.equal($('#rd-quote-number').val(), '2');
    dom.window.close();
});

test('fixed quote contract rejects invalid numbers and keeps old policies unchanged', () => {
    const { dom, design } = setup();
    const old = { source: 'custom', order: 'sequential', quotes: ['One', 'Two'] };
    design.quoteFooter = old;
    assert.deepEqual(contract.normalize(design).quoteFooter, old);
    for (const selectedNumber of [0, 3, 1.2, '1', undefined]) {
        design.quoteFooter = { ...old, order: 'fixed', selectedNumber };
        assert.throws(() => contract.normalize(design), /quote number/);
    }
    design.quoteFooter = { ...old, order: 'fixed', selectedNumber: 2 };
    assert.equal(contract.normalize(design).quoteFooter.selectedNumber, 2);
    dom.window.close();
});

test('fixed Kural preview ignores stale responses and uses the selected verse and QR', async () => {
    const { dom, w, $, branch, design } = setup();
    const requests = [];
    w.PosnicPro.post = (req, done) => requests.push({ req, done });
    design.quoteFooter = { source: 'thirukkural', order: 'fixed', selectedNumber: 51, quotes: [], showQr: true };
    w.PosnicPro.receiptDesignerEditor.load({ ...branch, receipt_designs: design });
    assert.equal(requests[0].req.url, 'setting/receiptQuotePreview');
    assert.equal(JSON.parse(requests[0].req.data).number, 51);
    $('#rd-quote-number').val('52').trigger('change');
    const select = require('../api/src/helpers/receipt-quote').select;
    requests[1].done({ type: 'success', data: select({ ...design.quoteFooter, selectedNumber: 52 }, 'S1') });
    requests[0].done({ type: 'success', data: select(design.quoteFooter, 'S1') });
    await new Promise(resolve => setTimeout(resolve, 250));
    const verse = require('../api/src/data/thirukkural/verses.json')[51];
    const preview = $('<div>').html($('.rd-preview-page iframe').attr('srcdoc'));
    assert.equal(preview.find('.rd-quote').text(), verse.lines.join('\n'));
    assert.equal(preview.find('.rd-quote-qr').attr('src'), require('../api/src/data/thirukkural/qr.json')[51]);
    dom.window.close();
});
