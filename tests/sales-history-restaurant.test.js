const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const sales = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/sales.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/settings.js'), 'utf8');
function setup(enabled = true, rows = null) {
 const dom = new JSDOM(fs.readFileSync(path.join(root, 'frontend/modules/sales_read.html'), 'utf8') + '<div class="loader-view-dayparts"><div id="menu_daypart_rows"></div><button id="save_dayparts">Save</button></div>', { runScripts: 'outside-only' });
 const w = dom.window; const $ = require('jquery')(w); w.$ = $;
 let saved = [{ id: 'lunch', name: 'Lunch', hours: { mon: [{ open: 720, close: 930 }] } }];
 const requests = [], alerts = [];
 w.PosnicPro = { i18n: { t: (k,v) => v }, local: { get: k => k === 'table_options' ? (enabled ? 'enable' : 'disable') : '$' },
 alert: (...v) => alerts.push(v), convertDate: v => v, listSort: { value: () => '' },
 get: (p, cb) => cb({ type: 'success', data: p.url === 'setting/getTableOrderAll' ? [{ tableorder_value: '4' }] : (p.url === 'sales/servingPeriods' ? { restaurant_enabled: true, serving_periods: saved } : { values: { menu_dayparts: saved } }) }),
 put: (p, cb) => { saved = JSON.parse(p.data).menu_dayparts; cb({ type: 'success' }); },
 listFilter: { legacyFilters: () => ({}), activeCount: () => 0, request: (key,p,cb) => { requests.push(p.data); cb({ data: { list: rows || [{ _id: 'bill', table_number: '4', sales_id: 'B-1', sales_total: 210, payment_status: 'Paid' }], total: 1 } }); } } };
 w.PosnicSalePayments = require('../api/src/helpers/sale-payment-summary');
 w.eval('PosnicPro.sales = {' + sales.slice(sales.indexOf('    mountRestaurantHistory: function'), sales.indexOf('    renderHistoryPager: function')) + '};');
 w.PosnicPro.sales.mountHistoryFilters = () => {}; w.PosnicPro.sales.renderHistoryPager = () => {};
 const dayStart = settings.indexOf('PosnicPro.dayparts = {');
 w.eval(settings.slice(dayStart, settings.indexOf("$(document).on('click', '#add_daypart'", dayStart)));
 const saveStart = settings.indexOf('PosnicPro.servingPeriods = {');
 w.eval(settings.slice(saveStart, settings.indexOf("$(document).on('click', '#v-pills-tableorder-tab, #manage_sec_tableorder'", saveStart)));
 return { w, $, requests, alerts, close: () => w.close() };
}
test('restaurant table column and combined filters drive the paginated request; clear resets both', () => {
 const x = setup(); const s = x.w.PosnicPro.sales; s.mountRestaurantHistory(); s.loadHistory(1);
 assert.match(x.$('#sales_list_rows thead').text(), /Table/);
 x.$('#sales_history_table').val('4'); x.$('#sales_history_period').val('lunch'); x.$('#sales_provenance_form').trigger('submit');
 assert.equal(x.requests.at(-1).table_number, '4'); assert.equal(x.requests.at(-1).serving_period, 'lunch');
 x.$('#sales_provenance_reset').trigger('click'); assert.equal(x.requests.at(-1).table_number, undefined); assert.equal(x.requests.at(-1).serving_period, undefined); x.close();
});
test('retail hides restaurant controls and table column', () => {
 const x = setup(false); x.w.PosnicPro.sales.mountRestaurantHistory(); x.w.PosnicPro.sales.loadHistory(1);
 assert.equal(x.$('#sales_restaurant_filters').css('display'), 'none'); assert.doesNotMatch(x.$('#sales_list_rows thead').text(), /Table/); x.close();
});

test('staff/device/source filters combine and source choices follow enabled features', () => {
 const x=setup();const s=x.w.PosnicPro.sales;
 const get=x.w.PosnicPro.local.get;
 x.w.PosnicPro.local.get=k=>k==='general_settings'?JSON.stringify({module_captain_enable:true,module_kiosk_enable:false}):get(k);
 s.loadHistory(1);
 assert.equal(x.$('#sales_history_source option[value=tableside]').length,1);
 assert.equal(x.$('#sales_history_source option[value=kiosk]').length,0);
 x.$('#sales_history_staff').val('Asha');x.$('#sales_history_device').val('Samsung');x.$('#sales_history_source').val('tableside');
 x.$('#sales_provenance_form').trigger('submit');
 assert.equal(x.requests.at(-1).ordered_by,'Asha');assert.equal(x.requests.at(-1).order_device,'Samsung');assert.equal(x.requests.at(-1).order_source,'tableside');
 x.$('#sales_provenance_reset').trigger('click');assert.equal(x.requests.at(-1).ordered_by,undefined);
 x.close();
});

test('sort selection sends the requested ordering and labels the time being shown', () => {
 const x=setup(true,[{_id:'1',string_date:'sale time',created_date:'order time',updated_date:'edit time'}]);
 for(const [sort,label,value] of [['date_asc','Sale date & time','sale time'],['recent','Order created','order time'],['updated_desc','Last updated','edit time']]) {
 x.w.PosnicPro.listSort.value=()=>sort;x.w.PosnicPro.sales.loadHistory(1);
 assert.equal(x.requests.at(-1).sort,sort);assert.equal(x.$('th.sl-col-date').text(),label);assert.equal(x.$('td.sl-col-date').text(),value);
 }
 x.close();
});

test('searchable staff and device dropdowns open with choices and filter by the selected value', () => {
 const x=setup();x.w.jQuery=x.$;
 x.w.eval(fs.readFileSync(path.join(root,'frontend/static/script/js/jQuery-Autocomplete.min.js'),'utf8'));
 const lookups=[];
 x.w.PosnicPro.get=(p,cb)=>{ lookups.push(p.data);cb({type:'success',data:[{label:'Kitchen tablet',value:'device-01'}]}); };
 x.w.PosnicPro.sales.mountProvenanceHistory();
 const input=x.$('#sales_history_device');
 input.trigger('focus');
 assert.equal(lookups.at(-1).query,'');assert.equal(lookups.at(-1).field,'device');
 const picker=input.autocomplete();assert.equal(picker.suggestions[0].value,'Kitchen tablet · device-01');
 picker.select(0);
 x.$('#sales_provenance_form').trigger('submit');
 assert.equal(x.requests.at(-1).order_device,'device-01');
 input.val('counter').trigger('input');
 x.$('#sales_provenance_form').trigger('submit');assert.equal(x.requests.at(-1).order_device,'counter');
 x.$('#sales_provenance_reset').trigger('click');assert.equal(x.requests.at(-1).order_device,undefined);
 x.close();
});
test('serving periods save and reload edited hours and names', () => {
 const x = setup(); x.w.PosnicPro.servingPeriods.load(); x.$('.daypart-name').val('Late lunch'); x.$('.daypart-from').val('13:00');
 x.w.PosnicPro.servingPeriods.save(); x.$('#menu_daypart_rows').empty(); x.w.PosnicPro.servingPeriods.load();
 assert.equal(x.$('.daypart-name').val(), 'Late lunch'); assert.equal(x.$('.daypart-from').val(), '13:00'); assert.equal(x.$('.daypart-row').data('id'), 'lunch'); x.close();
});
test('failed load keeps edits and prevents saving an empty replacement', () => {
 const x = setup(); x.w.PosnicPro.servingPeriods.load(); x.w.PosnicPro.get = (p,cb,fail) => fail(); x.w.PosnicPro.servingPeriods.load();
 assert.equal(x.$('.daypart-name').val(), 'Lunch'); assert.equal(x.$('#save_dayparts').prop('disabled'), true); x.close();
});

for (const status of [
 { sale_process: 'cancelled', payment_status: 'Cancelled' },
 { sale_process: 'cancelled', payment_status: 'Paid' },
 { sale_process: 'cancel', payment_status: 'Unpaid' },
 { sale_process: 'Sales', payment_status: 'Canceled' },
 { sale_process: ' CANCELLED ', payment_status: 'Partially Paid' },
]) {
 test('cancelled bill stays cancelled across history and invoice: ' + JSON.stringify(status), () => {
  const bill = { _id: 'bill', sales_id: 'SB1D40-27-000276', sales_total: 861, items: [], ...status };
  const before = JSON.stringify(bill);
  const x = setup(true, [bill]);
  try {
   const s = x.w.PosnicPro.sales;
   x.w.eval('PosnicPro.sales.buildSaleSheet = ' + sales.slice(sales.indexOf('    buildSaleSheet: function') + '    buildSaleSheet: '.length, sales.indexOf('    /* Email the bill', sales.indexOf('    buildSaleSheet: function'))).trim().replace(/,$/, '') + ';');
   x.w.eval('PosnicPro.sales.renderSaleDoc = ' + sales.slice(sales.indexOf('    renderSaleDoc: function') + '    renderSaleDoc: '.length, sales.indexOf('    searchItem: function')).trim().replace(/,$/, '') + ';');
   x.w.PosnicPro.restaurantSaleDetails = { render: () => '' };
   s.loadHistory(1);
   assert.equal(x.$('#sales_list_rows .rs-pill').text(), 'Cancelled');
   s.renderSaleDoc(bill);
   assert.equal(x.$('#sales_doc .p-doc-toolbar .rs-pill').text(), 'Cancelled');
   assert.equal(x.$('#sales_doc .q-status').text(), 'CANCELLED');
   assert.equal(x.$('#sales_doc [onclick*="showPayment"]').length, 0);
   assert.equal(JSON.stringify(bill), before, 'rendering must preserve financial records');
  } finally { x.close(); }
 });
}

test('retail filters share one panel and selected choices wait for Apply', () => {
 const x=setup(false); x.w.jQuery=x.$;
 x.w.eval(fs.readFileSync(path.join(root,'frontend/static/script/js/jQuery-Autocomplete.min.js'),'utf8'));
 x.w.PosnicPro.get=(p,cb)=>cb({type:'success',data:[{label:'Till one',value:'till-1'}]});
 const s=x.w.PosnicPro.sales; s.mountProvenanceHistory();
 assert.equal(x.$('#sales_filter_panel #sales_filter_search').length,1);
 assert.equal(x.$('#sales_filter_panel #sales_provenance_form').length,1);
 assert.equal(x.$('#sales_history_staff_label').text(),'Staff');
 assert.equal(x.$('#sales_restaurant_reset').length,0);
 const input=x.$('#sales_history_device');
 input.autocomplete().options.onSelect({value:'Till one',data:'till-1'});
 assert.equal(x.requests.length,0);
 input.val('Till one');
 x.$('[data-picker=device]').trigger('click');
 assert.equal(input.data('filterValue'),'till-1');
 x.$('#sales_provenance_form').trigger('submit');
 assert.equal(x.requests.at(-1).order_device,'till-1');
 assert.ok(x.$('#sales_active_filters').text().includes('Till one'));
 x.close();
});

test('history totals use the full filtered response, show dynamic methods and safely render labels',()=>{
 const x=setup();const s=x.w.PosnicPro.sales;
 x.w.PosnicPro.listFilter.request=(key,p,cb)=>{x.requests.push(p.data);cb({data:{list:[],summary:{count:32,cancelled:1,currencies:[{currencyCode:'INR',currencyDigits:2,total:1250,payments:[{method:'Cash',amount:500},{method:'<img src=x>',amount:750}]}]}}});};
 s.loadHistory(2);assert.equal(x.requests.at(-1).include_summary,'true');
 const text=x.$('#sales_history_summary').text();assert.match(text,/Sales32/);assert.match(text,/1,250.00/);assert.match(text,/CashINR 500.00/);assert.match(text,/Cancelled1/);assert.equal(x.$('#sales_history_summary img').length,0);
 s.paintHistorySummary({count:0,cancelled:0,currencies:[]});assert.doesNotMatch(x.$('#sales_history_summary').text(),/1,250/);x.close();
});

test('a slow previous filter response cannot replace the newest history totals',()=>{
 const x=setup();const callbacks=[];
 x.w.PosnicPro.listFilter.request=(key,p,cb)=>callbacks.push(cb);
 x.w.PosnicPro.sales.loadHistory(1);x.w.PosnicPro.sales.loadHistory(1);
 callbacks[1]({data:{list:[],summary:{count:2,cancelled:0,currencies:[]}}});
 callbacks[0]({data:{list:[],summary:{count:99,cancelled:0,currencies:[]}}});
 assert.match(x.$('#sales_history_summary').text(),/Sales2/);assert.doesNotMatch(x.$('#sales_history_summary').text(),/99/);x.close();
});
