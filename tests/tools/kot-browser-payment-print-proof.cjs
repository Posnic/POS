'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const puppeteer=require('../../api/node_modules/puppeteer');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.addScriptTag({path:require.resolve('jquery')});
 await page.evaluate(()=>{
  window.proof={records:0,prints:0,after:0,errors:[]};
  const plan={id:'p',currency:'₹',totalMinor:10500,paidMinor:0,dueMinor:10500,enabled:true,version:0,methods:['Cash'],guests:[{name:'Table T1',totalMinor:10500,paid:false}]};
  window.PosnicPro={escapeHtml:v=>$('<i>').text(v).html(),local:{get:()=>'',set:()=>{}},i18n:{t:(_k,text)=>text},BRAND_URL:'https://www.posnic.com',alert:(_kind,msg)=>proof.errors.push(msg),afterPrint:()=>proof.after++,waitForPrintAssets:async doc=>{
   doc.defaultView.print=()=>{proof.prints++;proof.text=doc.body.textContent;doc.defaultView.onafterprint();};
  },post:(o,ok)=>{
   const b=JSON.parse(o.data);if(!o.url.endsWith('/record'))return ok(plan);
   proof.records++;proof.delivery=b.receiptDelivery;
   ok({...plan,dueMinor:0,confirmed:b.request_id,payments:[{...b,id:b.request_id}],browserReceipt:{branch_name:'Test shop',sales_id:'TEST-PRINT-1',payment_mode:'Cash',receipt_settled:true,items_subtotal:100,items_total:105,tax:5,receipt_line_rows:[{name:'Soup',qty:2,rate:50,amount:100}],receipt_tax_rows:[{label:'Tax 5%',amount:5}],items:[]}});
  }};
 });
 for(const f of ['api/src/helpers/sale-payment-summary.js','api/src/helpers/receipt-design.js','src/receipt-page-layout.js','frontend/static/script/js/core/receipt-designer.js','frontend/static/script/js/core/captain-money.js','frontend/static/script/js/core/captain-payments.js'])await page.addScriptTag({path:path.join(root,f)});
 await page.evaluate(()=>{window.addEventListener('captain:payment-recorded',e=>e.preventDefault());return CaptainPayments.open('T1');});
 await page.click('[data-action=record]');await page.click('[data-action=record]');
 await page.waitForFunction(()=>proof.prints===1||proof.errors.length>0);
 const result=await page.evaluate(()=>proof);
 assert.equal(result.records,1);assert.equal(result.delivery,'browser');assert.equal(result.prints,1);assert.equal(result.after,0);assert.deepEqual(result.errors,[]);assert.match(result.text,/TEST-PRINT-1/);assert.match(result.text,/Soup/);assert.match(result.text,/105.00/);
 console.log('PASS: Chrome payment confirmation reaches receipt iframe print once with saved bill, total and items; workspace preserved. Native print is intercepted; no physical output.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
