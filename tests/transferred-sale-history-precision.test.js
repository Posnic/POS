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

for (const exporting of [false, true]) {
    test('payment transactions preserve collected amounts in ' + (exporting ? 'CSV data' : 'desktop rows'), () => {
        const dom = new JSDOM('<input class="payment_branch_value" value="branch"><input class="view_payment_report_daterange" value="from-to"><select id="view_paymentransaction_per_page"><option selected>25</option></select><table id="view_paymentransaction"><tbody></tbody></table><span id="other" class="number">1.234</span>', { runScripts: 'outside-only' });
        const win = dom.window;
        win.$ = win.jQuery = require('jquery')(win);
        win.eval(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/jquery.number.min.js'), 'utf8'));
        const base = { user_name: 'Staff', payment_mode: 'Cash', updated_date: { $date: { $numberLong: '1790769600000' } } };
        const rows = [
            { ...base, sales_id: 'KWD', items_total: 95.003, report_amount: 95.005, currencyDigits: 3 },
            { ...base, sales_id: 'INR', items_total: 25, report_amount: 25.01, currencyDigits: 2 },
            { ...base, sales_id: 'Legacy', items_total: 18.5 },
            { ...base, sales_id: 'Zero', items_total: 10, report_amount: 0, currencyDigits: 0 }
        ];
        let exported;
        win.moment = () => ({ tz: () => ({ format: () => '2026/09/30 12:00 PM' }) });
        win.PosnicPro = {
            appendReportTableBody() {}, paging() {}, timeZone: () => 'UTC', convertDate: value => value,
            local: { get: () => 'Currency' },
            JSONToCSVConvertor: values => { exported = values; },
            get: (_params, success) => success({ type: 'success', data: {
                total: rows.length, total_pages: 1, current_page: 1, per_page: 25, list: rows
            } })
        };
        const script = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/report_payment.js'), 'utf8');
        const first = script.indexOf('    paymentransactionTable: function');
        const last = script.indexOf('    paymentransactionexport:', first);
        win.eval('PosnicPro.paymentransaction = {' + script.slice(first, last).trim().replace(/,$/, '') + '};');
        const run = win.PosnicPro.paymentransaction.paymentransactionTable;
        // Export refreshes the table afterwards; isolate the exported rows.
        if (exporting) win.PosnicPro.paymentransaction.paymentransactionTable = () => {};
        run(exporting ? 'paymentransactionexport' : undefined);
        if (exporting) assert.deepEqual(Array.from(exported, row => row.Amount), [95.005, 25.01, 18.5, 0]);
        else assert.deepEqual(Array.from(win.document.querySelectorAll('#view_paymentransaction .number'), node => node.textContent), ['95.005', '25.01', '18.50', '0']);
        assert.equal(win.document.querySelector('#other').textContent, '1.234');
        dom.window.close();
    });
}


for(const file of ['items','categories','customers','customer_categories']) {
  test(file+' activity rows preserve per-bill precision with bounded legacy fallback',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/'+file+'.js'),'utf8');
    const line=source.split('\n').find(line=>line.includes("let trow =")&&line.includes('data-label="Return total"'));
    assert.ok(line);
    const render=new Function('row','rowSaleTotal','rowReturnTotal','row_no','updateDate','process_class','currency','returnQty','salesQty',line+'; return trow;');
    for(const [code,label] of [['KWD','KWD'],['JPY','JPY'],[undefined,'$'],['<img src=x onerror=alert(1)>','$']]) for(const digits of [0,2,3,4,undefined,99]) {
      const precision=Number.isInteger(digits)&&digits>=0&&digits<=4?digits:2;
      const dom=new JSDOM('<table><tbody>'+render({currencyCode:code,currencyDigits:digits,items_total:95.005,items_return_total:1.003,
        sales_id:'B1',sale_process:'KOT'},95.005,1.003,1,'Today','','$',1,2)+'</tbody></table>');
      assert.equal(dom.window.document.querySelector('[data-label="Total"]').textContent,label+'\u00a0'+(95.005).toFixed(precision));
      assert.equal(dom.window.document.querySelector('[data-label="Return total"]').textContent,label+'\u00a0'+(1.003).toFixed(precision));
      assert.equal(dom.window.document.querySelectorAll('img,script').length,0);
      dom.window.close();
    }
  });
}


test('staff activity preserves bill precision and keeps different currencies separate',()=>{
  const dom=new JSDOM('<div id="u_doc_sales"></div><div id="u_doc_stats"></div>',{runScripts:'outside-only'});
  const win=dom.window;win.$=require('jquery')(win);
  const rows=[{currencyCode:'KWD',currencyDigits:3,items_total:31.669},
    {currencyCode:'KWD',currencyDigits:3,items_total:63.336},
    {currencyCode:'JPY',currencyDigits:0,items_total:95},
    {items_total:7.5}, {currencyCode:'<script>',currencyDigits:99,items_total:2.25}];
  win.PosnicPro={local:{get:()=>'$'},i18n:{t:(_key,text)=>text},convertDate:date=>date,
    get:(_options,success)=>success({data:{table:{data:{list:rows,total:8}}}})};
  const script=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/users.js'),'utf8');
  const first=script.indexOf('    loadRecentSales:');const last=script.indexOf('    /* The name',first);
  win.eval('PosnicPro.users={'+script.slice(first,last).trim().replace(/,$/,'')+'};');
  win.PosnicPro.users.loadRecentSales('staff');
  const amounts=[...win.document.querySelectorAll('#u_doc_sales tbody td:last-child')].map(cell=>cell.textContent);
  assert.deepEqual(amounts,['KWD\u00a031.669','KWD\u00a063.336','JPY\u00a095','$\u00a07.50','$\u00a02.25']);
  const totals=[...win.document.querySelectorAll('#u_doc_stats .s-stat-value > div')].map(el=>el.textContent);
  assert.deepEqual(totals,['KWD\u00a095.005','JPY\u00a095','$\u00a09.75']);
  assert.ok(win.document.querySelector('#u_doc_stats').textContent.includes('last 5'));
  assert.equal(win.document.querySelectorAll('script').length,0);
  dom.window.close();
});


for (const file of ['items', 'categories', 'customers', 'customer_categories']) {
  test(file + ' activity CSV preserves numeric amounts and their currency', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/' + file + '.js'), 'utf8');
    const line = source.split('\n').find(line => line.includes('salesreport.push('));
    assert.ok(line);
    const variable = /([a-z]+salesreport)\.push/.exec(line)[1];
    const exportRow = new Function('val', 'PosnicPro', `const ${variable}=[];
      const saleId='B1',date='Today',process='KOT',returnQty=1,returnTotal=1.003,salesQty=2,saleTotal=95.005;
      ${line}
      return ${variable}[0];`);
    for (const [code, expected] of [['KWD', 'KWD'], ['JPY', 'JPY'], [undefined, '$'], ['=HYPERLINK("bad")', '$']]) {
      const row = exportRow({ currencyCode: code }, { local: { get: () => '$' } });
      assert.equal(row.Currency, expected);
      assert.equal(row.SaleAmount, 95.005);
      assert.equal(row.ReturnAmount, 1.003);
    }
  });
}


for (const [file, prefix] of [['customers.js','customer'],['customer_categories.js','customercategory']]) {
    test(file + ' shows complete currency groups safely and restores legacy labels', () => {
        const script = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js', file), 'utf8');
        const start = script.indexOf('                    // Complete totals grouped by saved bill currency.');
        const end = script.indexOf(".siblings('.display-currency').toggle(!Array.isArray(response.data.currency_totals));", start) + ".siblings('.display-currency').toggle(!Array.isArray(response.data.currency_totals));".length;
        const dom = new JSDOM('<div><span class="display-currency">Shop</span><span class="'+prefix+'_details_saletotalvalue"></span></div><div><span class="display-currency">Shop</span><span class="'+prefix+'_details_returntotalvalue"></span></div>');
        const $ = require('jquery')(dom.window);
        const run = new Function('$','response','currency',script.slice(start,end));
        run($,{data:{currency_totals:[{currencyCode:'KWD',currencyDigits:3,total:95.005,return_total:1.003},{currencyCode:'JPY',currencyDigits:0,total:95,return_total:0},{currencyCode:'<img src=x>',currencyDigits:99,total:7.5,return_total:1.25}]}},'Shop');
        assert.equal($('.'+prefix+'_details_saletotalvalue').text(),'KWD 95.005 · JPY 95 · Shop 7.50');
        assert.equal($('.'+prefix+'_details_returntotalvalue').text(),'KWD 1.003 · JPY 0 · Shop 1.25');
        assert.equal(dom.window.document.querySelectorAll('img').length,0);
        assert.equal($('.display-currency')[0].style.display,'none');
        run($,{data:{}},'Shop');
        assert.notEqual($('.display-currency')[0].style.display,'none');
        run($,{data:{currency_totals:[]}},'Shop');
        assert.equal($('.'+prefix+'_details_saletotalvalue').text(),'Shop 0.00');
        dom.window.close();
    });
}
