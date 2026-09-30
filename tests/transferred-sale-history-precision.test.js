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
