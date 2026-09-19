'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const core = read('frontend/static/script/js/core/PosnicPro.js');
const thermal = read('api/src/json/print_standard_html.txt');
const a4 = read('api/src/json/print_a4html.txt');
const logo = 'data:image/png;base64,logo';
const qr = 'data:image/png;base64,qr';

function till() {
    const dom = new JSDOM('<!doctype html><div id="tender_receipt_preview"></div><ul id="tender_amount_list"></ul>' +
        '<div class="print-modal-body"><span class="print-title">Existing receipt</span></div>' +
        '<div id="tax">30.00</div><span class="tendered_total">1,240.00</span>',
    { url: 'http://localhost/', runScripts: 'outside-only' });
    const win = dom.window;
    const $ = require('jquery')(win);
    win.$ = win.jQuery = $;
    win.eval(read('frontend/static/script/js/jquery.number.min.js'));
    const settings = { currencySign: 'Rs.', printing_size: 'receipt_medium', printing_max_char: '40',
        gst_action: 'disable', print_width: '80', print_type: 'standard' };
    win.PosnicPro = {
        sales: { SaleAction: 'add', charges: [] }, measuredUnits: ['kg', 'g'], baseUrl: 'http://localhost/',
        BRAND_URL: 'https://www.posnic.com',
        local: { get: (key) => settings[key] || '' }, i18n: { t: (_key, fallback) => fallback },
        escapeHtml: (value) => $('<i>').text(value).html(),
        printBarcode: () => assert.fail('Preview generated a sale barcode'),
        printView: () => assert.fail('Preview sent a print job')
    };
    for (const key of ['isMeasuredUnit', 'formatQuantity', 'removeDuplicates', 'textOverflowPrintEllipsis', 'nestedTaxCalculation', 'toggleVisibility']) {
        const start = core.indexOf('    ' + key + ': function');
        const end = core.indexOf('\n    },', start);
        win.eval('PosnicPro.' + key + ' = ' + core.slice(core.indexOf('function', start), end + 6) + ';');
    }
    const view = read('frontend/static/script/js/modules/js/sales_view.js');
    win.eval(view.slice(0, view.indexOf('\n};') + 3));
    win.eval(read('frontend/static/script/js/core/tender-receipt.js'));
    win.eval(read('frontend/static/script/js/core/receipt-data.js'));
    win.eval(read('frontend/static/script/js/moment.js'));
    const branch = {
        thermal_body_print: thermal, regular_body_print: a4, branch_name: 'My Shop',
        printing_address: 'High Street', branch_gstin_number: '', print_logoimg: true, logo,
        customer_print: true, print_sale_notes: true, header_print: 'Welcome to our shop',
        footer_print: 'Exchanges within seven days.\nBring your bill.', footer_image: qr,
        footer_image_caption: 'Scan to visit our store', print_url: true,
        invoice_terms: 'Payment due today', quote_default_signature: logo,
        print_controls: { a4: { lineitem_qty: 'on', lineitem_total: 'on', lineitem_price: 'off' } }
    };
    const data = { ...branch, sales_id: '', created_date: '19/09/2026 12:30 AM',
        customer_name: 'Walk-in Customer', sales_description: 'Handle with care',
        items: [{ item_name: 'Gift Wrap Roll', item_price: 1000, item_quantity: 1.5,
            item_unit: 'kg', item_discount: 0, item_discount_percentage: 0,
            total_amount: 1530, tax: 2, tax_type: 'exclusive', tax_fields: [], igst_tax: 0, cgst_tax: 15 }],
        items_return: [], items_subtotal: 1500, items_total: 1520, discount: 0,
        tax: 30, sale_extra_discount: 20, round_off: 0,
        charges: [{ name: 'Delivery', amount: 10, tax_amount: 0 }]
    };
    return { dom, win, $, branch, data, preview: win.PosnicPro.tenderReceipt, settings };
}

for (const layout of ['80', '58', 'a4']) {
    test(layout + ': saved branding, QR, content and live totals use the print template', () => {
        const { dom, $, branch, data, preview } = till();
        const before = $('.print-modal-body').html();
        const result = $('<div>').html(preview.documentFor(branch, data, layout));
        assert.equal(result.find('.print_store_name').text(), 'My Shop');
        assert.equal(result.find('.printlogoimage img, #printlogoimage img').attr('src'), logo);
        assert.equal(result.find('.receipt-footer-image img').attr('src'), qr);
        assert.equal(result.find('.receipt-footer-image').length, 1);
        assert.equal(result.find('.footer-image-caption').text(), branch.footer_image_caption);
        assert.equal(result.find('.footer-content').text(), branch.footer_print);
        assert.match(result.text(), /Gift Wrap Roll/);
        assert.match(result.find('.print-total').text(), /1,520\.00/);
        assert.match(result.text(), /Delivery/);
        assert.match(result.text(), /Handle with care/);
        assert.equal(result.find('.receipt-brand-url').text(), 'https://www.posnic.com');
        assert.equal(result.find('.print-title').text(), 'BILL');
        assert.equal(result.find('.print_view_id')[0].style.display, 'none');
        assert.equal($('.print-modal-body').html(), before, 'Print modal was mutated');
        assert.equal($('#tax').text(), '30.00', 'Cart was mutated');
        if (layout === 'a4') {
            assert.match(result.text(), /Payment due today/);
            assert.equal(result.find('.a4-invoice-extras img').attr('src'), logo);
            assert.equal(result.find('.lineitem_price')[0].style.display, 'none');
        }
        dom.window.close();
    });
}

test('custom template order and styles survive; disabled logo and customer stay hidden', () => {
    const { dom, $, branch, data, preview } = till();
    branch.thermal_body_print = '<div class="custom" style="border:2px solid blue">Shop design</div>' + thermal;
    data.print_logoimg = false;
    data.customer_print = false;
    const result = $('<div>').html(preview.documentFor(branch, data, '80'));
    assert.equal(result.find('#receipt_wrapper').children().first().attr('class'), 'custom');
    assert.equal(result.find('.custom').attr('style'), 'border:2px solid blue');
    assert.equal(result.find('.branch_image')[0].style.display, 'none');
    assert.equal(result.find('.hide_customer_details')[0].style.display, 'none');
    dom.window.close();
});

test('a saved QR removal wins over the image still held in the browser cache', () => {
    const { dom, win, $, branch, data, preview } = till();
    const get = win.PosnicPro.local.get;
    win.PosnicPro.local.get = (key) => key === 'footer_image' ? qr : get(key);
    data.footer_image = '';
    const result = $('<div>').html(preview.documentFor(branch, data, '80'));
    assert.equal(result.find('.receipt-footer-image').length, 0);
    assert.equal(preview.rawData(result.html()).footerImage, undefined);
    dom.window.close();
});

for (const layout of ['80', 'a4']) {
    test(layout + ' receipt treats customer details, item names and notes as literal text', () => {
        const { dom, $, branch, data, preview } = till();
        const text = '<b>Customer & shop</b>';
        Object.assign(data, { customer_name: text, customer_phone: text, customer_email: text,
            customer_address: text, sales_description: text + '\nSecond line' });
        data.items[0].item_name = '<b>Gift & Wrap</b>';
        const result = $('<div>').html(preview.documentFor(branch, data, layout));
        for (const field of ['name', 'phone', 'email', 'address']) {
            assert.equal(result.find('.print-' + field).text(), text);
            assert.equal(result.find('.print-' + field + ' b').length, 0);
        }
        assert.equal(result.find('.print-sale-notes').text(), text + '\nSecond line');
        assert.equal(result.find('.print-sale-notes b').length, 0);
        const item = result.find(layout === 'a4' ? '.article' : '.invoice-content-heading').first();
        assert.equal(item.text(), '<b>Gift & Wrap</b>');
        assert.equal(item.find('b').length, 0);
        dom.window.close();
    });
}

test('cart reads numeric amounts, fractional quantities and product names without edit controls', () => {
    const { dom, win, $, branch, preview } = till();
    win.PosnicPro.sales.SaleTableLineItems = { A: { tax: 2, tax_name: '4811' } };
    $('body').append('<input id="sales_new_customer_name" value="Sam"><input id="grand_total" value="1500">' +
        '<span id="sales_new_subtotal">1,500.00</span><span id="extraDisc">10</span><span id="percentIcon"></span>' +
        '<span id="RoundOff">-0.45</span><span id="discount_sale_amount">20.00</span>' +
        '<table id="sales_new_items_table"><tbody><tr><td id="addSalesLineItemName_A" data-id="Gift &amp; Wrap">Gift &amp; Wrap<button>Edit</button></td>' +
        '<td><input id="touchsale_item_qtyA" value="1.5"></td><td id="addSalesLineItemUnit_A">kg</td>' +
        '<td id="addSalesLineItemPrice_A">1,000.00</td><td></td><td id="addSalesLineItemTax_A">2%</td>' +
        '<td id="addSalesLineTotal_A">1,530.00</td><td></td><td>A</td>' +
        '<td id="addSalesLineItemSellingPrice_A">1020</td><td id="addSalesLineItemTaxType_A">Inc</td></tr></tbody></table>');
    const result = preview.cartData(branch);
    assert.equal(result.items_total, 1240);
    assert.equal(result.items_subtotal, 1500);
    assert.equal(result.sale_extra_discount, 150);
    assert.equal(result.round_off, -0.45);
    assert.equal(result.items[0].item_name, 'Gift & Wrap');
    assert.equal(result.items[0].item_price, 1020, 'Inclusive price was stripped of tax twice');
    assert.equal(result.items[0].tax_name, '4811');
    assert.equal(result.items[0].item_quantity, 1.5);
    assert.equal(result.items[0].total_amount, 1530);
    assert.equal(result.sales_id, '');
    dom.window.close();
});

test('late loads cannot replace a return summary and a failed load keeps totals available', () => {
    const { dom, win, $, preview } = till();
    let success;
    win.PosnicPro.get = (_request, done) => { success = done; };
    preview.show();
    win.PosnicPro.sales.SaleAction = 'return';
    preview.show();
    success({ type: 'error' });
    assert.equal($('#tender_receipt_preview').text(), '');
    assert.notEqual($('#tender_amount_list')[0].style.display, 'none');
    win.PosnicPro.sales.SaleAction = 'add';
    preview.show();
    success({ type: 'error' });
    assert.match($('#tender_receipt_preview').text(), /Retry/);
    assert.notEqual($('#tender_amount_list')[0].style.display, 'none');
    dom.window.close();
});

test('browser preview loads its stylesheet and relative logo without a configured baseUrl', async () => {
    const { dom, win, $, branch, preview } = till();
    delete win.PosnicPro.baseUrl;
    branch.logo = '/uploads/shop.png';
    win.PosnicPro.paperCss = () => '';
    win.PosnicPro.get = (_request, done) => done({ type: 'success', data: branch });
    let cssUrl;
    $.ajax = (request) => {
        cssUrl = request.url;
        return $.Deferred().resolve('@media print { body { color: black; } }').promise();
    };
    preview.show();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(cssUrl, 'http://localhost/static/pages/print.css');
    const html = $('#tender_receipt_preview iframe').attr('srcdoc');
    assert.ok(html, $('#tender_receipt_preview').text());
    assert.match(html, /<base href="http:\/\/localhost\/">/);
    assert.match(html, /@media all/);
    assert.equal(preview.rawData(html).logo.src, 'http://localhost/uploads/shop.png');
    assert.equal(preview.rawData(html).footerImage.src, qr);
    dom.window.close();
});

test('desktop preview decodes actual receipt bytes, including logo, QR and euro glyph', () => {
    const { renderSale } = require('../src/escpos-receipt');
    const { parse, asLines } = require('../src/escpos-preview');
    const { dom, branch, data, preview } = till();
    const raw = preview.rawData(preview.documentFor(branch, data, '80'));
    assert.equal(raw.logo.src, logo);
    assert.equal(raw.footerImage.src, qr);
    assert.equal(raw.billNo, '', 'Unsaved sale has a fake receipt number');
    assert.equal(raw.total, 1520);
    assert.equal(raw.title, 'BILL', 'Customer section replaced the document title');
    assert.equal(raw.footer.split('\n').at(-1), 'https://www.posnic.com');
    // Already-rasterised one-byte images exercise the actual byte parser.
    raw.logo = { width: 8, height: 1, data: 'gA==' };
    raw.footerImage = { width: 8, height: 1, data: '/w==' };
    raw.currency = '€';
    const doc = parse(renderSale(raw, { paperWidth: '58' }), 32);
    assert.equal(doc.columns, 32);
    assert.equal(doc.rows.filter(row => row.kind === 'raster').length, 2);
    assert.match(asLines(doc).join('\n'), /€1520\.00/);
    assert.match(asLines(doc).join('\n'), /Exchanges within seven days/);
    assert.equal(doc.rows.filter(row => row.kind === 'text' && row.text.includes('Gift')).length, 1);
    dom.window.close();
});

test('print names keep short names once and truncate long names at the configured limit', () => {
    const { dom, win } = till();
    assert.equal(win.PosnicPro.textOverflowPrintEllipsis('Gift Wrap', 40, true), 'Gift Wrap');
    assert.equal(win.PosnicPro.textOverflowPrintEllipsis('Gift Wrap', 4, true), 'Gift...');
    assert.equal(win.PosnicPro.textOverflowPrintEllipsis('Gift Wrap', 0, true), 'Gift Wrap');
    dom.window.close();
});

test('the guarded desktop preview handler never contacts hardware or opens the drawer', async () => {
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    const load = createRequire(path.join(__dirname, '..', 'src', 'hardware-ipc.js'));
    const handlers = new Map();
    const mod = { exports: {} };
    vm.runInNewContext(read('src/hardware-ipc.js'), {
        module: mod, console: { log() {} }, global: {}, process, setTimeout() {},
        require(name) {
            if (name === 'electron') return {
                app: { getPath: () => path.join(__dirname, 'fixtures', 'no-user-data') },
                ipcMain: { handle: (key, handler) => handlers.set(key, handler) }
            };
            if (name === './essae-weight-reader') return {};
            if (name === './receipt-log') assert.fail('Preview logged a print');
            return load(name);
        }
    });
    const hardware = new Proxy({}, { get() { assert.fail('Preview touched hardware'); } });
    mod.exports.setupHardwareIPC(hardware);
    const preview = handlers.get('printer:preview-receipt');
    assert.equal(typeof preview, 'function');
    const doc = await preview({ senderFrame: { url: 'http://localhost:5555/dashboard.html' } },
        { storeName: 'Shop', total: 25, items: [] }, { paperWidth: '58', openDrawer: true });
    assert.equal(doc.columns, 32);
    assert.ok(doc.rows.some(row => row.text && row.text.includes('25.00')));
    await assert.rejects(async () => preview({ senderFrame: { url: 'https://example.com/' } }, {}, {}));
});
