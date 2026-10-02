const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function setup() {
 const w = new JSDOM('<div id="host"><select id="period"></select><small id="hint"></small></div>', {runScripts:'outside-only'}).window;
 const $ = require('jquery')(w); w.$ = $;
 const calls = [];
 w.PosnicPro = {i18n:{t:(k,v)=>v},get:(p,cb)=>calls.push({p,cb})};
 const core = read('frontend/static/script/js/core/PosnicPro.js');
 w.eval(core.slice(core.indexOf('PosnicPro.mountServingPeriodFilter = function')));
 return {w,$,calls};
}
const options = {restaurant_enabled:true,serving_periods:[{id:'lunch',name:'Lunch',hours:{mon:[{open:720,close:900}]}}]};
test('saved periods reload on each visit, preserve selection and invoke change', () => {
 const {w,$,calls}=setup(); let selected;
 const config={host:'#host',select:'#period',hint:'#hint',branch:'branch-a',change:v=>selected=v};
 w.PosnicPro.mountServingPeriodFilter(config); calls[0].cb({type:'success',data:options});
 $('#period').val('lunch').trigger('change'); assert.equal(selected,'lunch');
 w.PosnicPro.mountServingPeriodFilter(config); calls[1].cb({type:'success',data:options});
 assert.equal($('#period').val(),'lunch'); assert.equal(calls[1].p.data.branch,'branch-a'); w.close();
});
test('late options from a previous branch cannot replace the current branch', () => {
 const {w,$,calls}=setup(); const config={host:'#host',select:'#period',hint:'#hint',change:()=>{}};
 w.PosnicPro.mountServingPeriodFilter({...config,branch:'branch-a'});
 w.PosnicPro.mountServingPeriodFilter({...config,branch:'branch-b'});
 calls[1].cb({type:'success',data:options}); calls[0].cb({type:'success',data:{restaurant_enabled:false}});
 assert.equal($('#host').css('display'),'flex'); assert.equal($('#period option').length,2); w.close();
});
test('multiple branches disable periods with an explanation', () => {
 const {w,$,calls}=setup(); w.PosnicPro.mountServingPeriodFilter({host:'#host',select:'#period',hint:'#hint',branch:['a','b'],change:()=>{}});
 assert.equal($('#period').prop('disabled'),true); assert.match($('#hint').text(),/one branch/); assert.equal(calls.length,0); w.close();
});
test('detailed, quick and summary reports and exports send the selected period', () => {
 const {w,$,calls}=setup(); $('body').append('<select class="sale_branch_value" multiple><option selected value="branch-a">A</option></select><input class="view_sale_report_daterange" value="10/01/2026 - 10/02/2026"><select id="sales-report-period"><option selected value="lunch">Lunch</option></select><table id="view_salereport"></table><table id="view_instantreport"></table>');
 w.PosnicPro.alert=()=>{};
 const src=read('frontend/static/script/js/modules/js/report_sales.js'); w.eval(src.slice(0,src.indexOf('$(document).ready')));
 w.PosnicPro.salereport.salereportTable(); w.PosnicPro.salereport.salereportTable('salereportexport');
 w.PosnicPro.instantreport.instantreportTable(); w.PosnicPro.instantreport.instantreportTable('instantreportexport');
 w.PosnicPro.salesummaryreport.summaryreportTable();
 assert.equal(calls.length,5); for(const {p} of calls) assert.equal(p.data.serving_period,'lunch'); w.close();
});
test('day end selection feeds the existing view and PDF period parameters', () => {
 const {w,$,calls}=setup(); $('body').append('<div id="daily-meal-filter"><select id="daily-serving-period"></select><small id="daily-period-hint"></small></div><input id="dailysale_branch_value" value="branch-a"><div id="daily-meal-custom"></div>');
 const src=read('frontend/static/script/js/modules/js/report_dailysales.js'); w.eval(src.slice(0,src.indexOf('  showDataTablePage: function'))+'};');
 w.PosnicPro.quickreport.salereportTable=()=>{}; w.PosnicPro.quickreport.loadPeriods(); calls[0].cb({type:'success',data:options});
 $('#daily-serving-period').val('lunch').trigger('change'); assert.equal(w.PosnicPro.quickreport.periodParams().serving_period,'lunch');
 $('#daily-serving-period').val('').trigger('change'); assert.equal(Object.keys(w.PosnicPro.quickreport.periodParams()).length,0); w.close();
});
