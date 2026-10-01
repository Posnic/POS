'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
const start = source.indexOf('    loadHistory: function (page) {');
const end = source.indexOf('    renderHistoryPager:', start);
const method = source.slice(start, end).trim().replace(/,$/, '');

for (const [digits, amount, expected] of [[0, 95, '95'], [2, 31.67, '31.67'], [3, 31.669, '31.669'], [undefined, 31.67, '31.67'], [99, 31.67, '31.67']]) {
    test('desktop history preserves bill precision ' + digits, () => {
        const dom = new JSDOM('<div id="sales_list_rows"></div><div id="sales_list_paging"></div>', { runScripts: 'outside-only' });
        const win = dom.window;
        win.$ = require('jquery')(win);
        win.PosnicPro = {
            local: { get: () => 'Currency' },
            listSort: { value: () => '' },
            listFilter: {
                legacyFilters: () => ({}),
                request: (_name, _options, success) => success({ data: { list: [{
                    _id: 'order', sales_id: 'B1', sales_total: amount, currencyDigits: digits,
                    payment_status: 'Paid', number_of_items: 1
                }] } })
            }
        };
        win.eval('PosnicPro.sales = {' + method + '};');
        Object.assign(win.PosnicPro.sales, { mountHistoryFilters() {}, renderHistoryPager() {}, HIST_PAGE_SIZE: 25 });
        win.PosnicPro.sales.loadHistory(1);
        const cells = win.document.querySelectorAll('#sales_list_rows tbody td');
        assert.equal(cells[4].textContent, 'Currency\u00a0' + expected);
        dom.window.close();
    });
}

for (const digits of [2, 3, 4, undefined, 99]) {
    test('payment report renders supplied precision ' + digits + ' without reformatting other screens', () => {
        const dom = new JSDOM('<input class="payment_branch_value" value="branch"><input class="view_payment_report_daterange" value="from-to"><table id="salePaymentType"><tbody></tbody></table><span id="other" class="number">1.234</span>', { runScripts: 'outside-only' });
        const win = dom.window;
        win.$ = win.jQuery = require('jquery')(win);
        win.eval(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/jquery.number.min.js'), 'utf8'));
        win.PosnicPro = {
            local: { get: () => 'KWD' },
            get: (_params, success) => success({ type: 'success', data: { currencyDigits: digits,
                payment: [{ sales_payment_mode: 'Cash', sales_payment: 95.005, sales_count: 2 }] } })
        };
        const script = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/report_payment.js'), 'utf8');
        const first = script.indexOf('    paymentSaleReportView: function');
        const last = script.indexOf('    paymentTableTabClick:', first);
        win.eval('PosnicPro.paymentreport = {' + script.slice(first, last).trim().replace(/,$/, '') + '};');
        win.PosnicPro.paymentreport.paymentSaleReportView();
        const expected = digits === 3 ? '95.005' : digits === 4 ? '95.0050' : '95.01';
        assert.equal(win.document.querySelector('#salePaymentType .number').textContent, expected);
        assert.equal(win.document.querySelector('#other').textContent, '1.234');
        dom.window.close();
    });
}
