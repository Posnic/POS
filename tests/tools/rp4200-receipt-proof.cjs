const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(root, 'api')] }));
const { fitDocument } = require('../../src/receipt-page-layout');
const output = path.join(root, 'output/rp4200');
fs.mkdirSync(output, { recursive: true });
const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
const w = dom.window;
w.PosnicPro = { i18n: { t: (key, fallback) => fallback }, local: { get: () => '' }, escapeHtml: value => { const el=w.document.createElement('span'); el.textContent=value; return el.innerHTML; } };
for (const file of ['frontend/static/script/js/jquery.min.js', 'api/src/helpers/receipt-design.js', 'api/src/helpers/sale-payment-summary.js', 'frontend/static/script/js/core/receipt-designer.js']) w.eval(fs.readFileSync(path.join(root,file),'utf8'));
const data = { branch_name: 'Bharat Traders', store_name: 'Bharat Traders', store_address: 'ECR Main Road, Neermulai, Nagapattinam 614711', store_email: 'hidden@example.com', currency: 'INR', currency_symbol: '₹', sales_id: 'SAMPLE-001', created_date: '14/10/2026 10:30 AM', items_subtotal: 90, items_total: 95, tax: 4.5, round_off: 0.5, receipt_settled: false, items: [{item_name:'Sample item with a longer name',item_quantity:2,item_price:45,total_amount:94.5}] };
data.receipt_designs=w.PosnicPro.receiptDesigner.defaults(data);
for(const layout of Object.values(data.receipt_designs.layouts)) for(const b of layout.blocks) { if(b.type==='store')b.showEmail=false; if(b.type==='items')b.showRowNumbers=true; }
const html=w.PosnicPro.receiptDesigner.render(data,'112',true);
fs.writeFileSync(path.join(output,'receipt.html'), html);
(async()=>{const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage();await page.setViewport({width:500,height:850,deviceScaleFactor:2});await page.setContent(html);
 const info=await page.evaluate(fit=>{const size=(new Function('return ('+fit+')'))()(document);const receipt=document.querySelector('.rd-document');return{size,width:receipt.getBoundingClientRect().width,text:receipt.innerText,scrollWidth:receipt.scrollWidth,clientWidth:receipt.clientWidth};},fitDocument.toString());
 assert.equal(info.size.width,104000);assert.ok(Math.abs(info.width-104*96/25.4)<1);assert.ok(info.scrollWidth<=info.clientWidth+1);assert.match(info.text,/Round Off/);assert.match(info.text,/0.50/);assert.match(info.text,/1\./);assert.doesNotMatch(info.text,/hidden@example.com/);
 await (await page.$('.rd-document')).screenshot({path:path.join(output,'receipt.png')});await page.pdf({path:path.join(output,'receipt.pdf'),printBackground:true,preferCSSPageSize:true});
 console.log(JSON.stringify({passed:true,...info,output}));
}finally{await browser.close();dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
