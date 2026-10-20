const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

for (const [label, fields, expected] of [
  ['SKU without barcode', {item_sku:'CANDLE-24'}, 'CANDLE-24'],
  ['different SKU and barcode', {item_sku:'PEN-10',barcode_id:'123456'}, 'PEN-10'],
  ['missing SKU', {barcode_id:'123456'}, ''],
  ['null SKU', {item_sku:null}, ''],
  ['empty SKU', {item_sku:''}, ''],
  ['leading zeros', {item_sku:'000123'}, '000123'],
  ['SKU containing markup', {item_sku:'<b>SKU</b>'}, '<b>SKU</b>'],
]) {
  test(`detailed sales display and CSV: ${label}`, () => {
    const w = new JSDOM('<input class="sale_branch_value" value="branch"><input class="view_sale_report_daterange" value="2026/10/17 - 2026/10/17"><table id="view_salereport"><tbody></tbody></table>', {runScripts:'outside-only'}).window;
    const $ = require('jquery')(w); w.$ = $;
    $.fn.number = function () { return this; };
    const requests = []; let exported;
    w.PosnicPro = {get:(params,cb)=>requests.push(cb), paging:()=>{}, convertDate:v=>v,local:{get:()=> '£'}, JSONToCSVConvertor:rows=>exported=rows};
    const src = fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/report_sales.js'),'utf8');
    w.eval(src.slice(0,src.indexOf('$(document).ready')));
    const response = {type:'success',data:{total:1,total_pages:1,current_page:1,per_page:5,list:[{_id:'sale1',sales_id:'S1',string_date:'2026/10/17',customer_name:'Walk-in',customer_phone:'',number_of_items:1,items_total:35,items:[{item_name:'Candles',item_price:35,item_quantity:1,total_amount:35,...fields}]}]}};
    w.PosnicPro.salereport.salereportTable(); requests.shift()(response);
    const cell = $('.export-item-barcode-id');
    assert.equal(cell.text(),expected);
    assert.equal(cell.children().length,0);
    w.PosnicPro.salereport.salereportTable('salereportexport');
    w.PosnicPro.salereport.salereportTable=()=>{};
    w.PosnicPro.instantreport.instantreportTable=()=>{};
    requests.shift()(response);
    assert.equal(exported[0].SKU,expected);
    w.close();
  });
}
