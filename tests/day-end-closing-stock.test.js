const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('day-end table and CSV retain closing stock and mark unknown balances',()=>{
 const dom=new JSDOM(read('frontend/modules/dailyReport.html'),{runScripts:'outside-only'}),w=dom.window;w.eval(read('frontend/static/script/js/jquery.min.js'));w.$.fn.number=function(){return this};
 const src=read('frontend/static/script/js/modules/js/report_dailysales.js');
 const render=w.Function('response','currency','safeNum','esc',src.slice(src.indexOf('        // ---- Products ----'),src.indexOf('        // ---- Payments ----'))+'return {productHeaderRow,productAllDataRow};');
 const rows=render({data:{product_details:[{product_name:'Tomato',product_sku:'T',product_qty:0.305,product_subtotal:10,product_total:10,closing_stock:12.345},{product_name:'Onion',product_qty:1,product_subtotal:5,closing_stock:null}]}},'INR',v=>Number(v)||0,String);
 assert.equal(rows.productAllDataRow[0][7],12.345);assert.equal(rows.productAllDataRow[1][7],'Unavailable');
 assert.equal(w.$('#daily_report_product_details thead td').length,9);assert.equal(w.$('#daily_report_product_details tbody tr').first().children().length,9);assert.equal(w.$('#daily_report_product_details tfoot tr').children().length,9);
 assert.match(w.$('#daily_report_product_details tbody').text(),/12.345/);assert.match(w.$('#daily_report_product_details tbody').text(),/0.305/);
 const precise=render({data:{product_details:[{product_name:'Green chillies',product_qty:1.7690000000000001,product_subtotal:72.73,product_total:72.73,closing_stock:0}]}},'INR',v=>Number(v)||0,String);
 assert.equal(precise.productAllDataRow[0][2],1.769);
 assert.equal(w.$('#daily_report_product_details tbody tr').first().children().eq(3).text(),'1.769');
 dom.window.close();
});
