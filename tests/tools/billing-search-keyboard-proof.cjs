const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..');const puppeteer=require(path.join(ROOT,'api/node_modules/puppeteer'));
(async()=>{
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 await page.setContent('<input id="sales_new_item_name"><style>.autocomplete-suggestions{background:white;border:1px solid #ddd}.autocomplete-selected{background:#ddd}</style>');
 for(const file of ['frontend/static/script/js/jquery.min.js','frontend/static/script/js/jQuery-Autocomplete.min.js','frontend/static/style/plugins/sweet-alert2/sweetalert2.min.js','api/src/helpers/billing-search.js']) await page.addScriptTag({path:path.join(ROOT,file)});
 await page.addStyleTag({path:path.join(ROOT,'frontend/static/style/plugins/sweet-alert2/sweetalert2.min.css')});
 await page.evaluate(()=>{
  window.added=[];window.PosnicPro={i18n:{t:(k,f)=>f},local:{get:()=>null},alert:()=>{},sales:{_catalogueAt:Date.now(),_billingCatalogue:[{name:'Tea',item_name:'Tea',item_id:'tea',selling_price:50,tax:5,tax_type:'exclusive'},{name:'Chicken Biryani',item_name:'Chicken Biryani',item_id:'cb',selling_price:200}],itemCache:{get:(id,cb)=>cb({item_id:id,item_name:id,track_inventory:false,selling_price:50})},addSalesLineItems:item=>window.added.push(item)},sugActionRow:(i,c,t)=>t,sugRow:(item,html)=>html};
 });
 const raw=fs.readFileSync(path.join(ROOT,'frontend/static/script/js/modules/js/sales.js'),'utf8');const start=raw.indexOf('PosnicPro.sales.askSearchQuantity =');const end=raw.indexOf('$(document).ready',start);
 await page.addScriptTag({content:raw.slice(start,end)});
 await page.waitForFunction(()=>!!$('#sales_new_item_name').data('autocomplete'));
 await page.type('#sales_new_item_name','Tea');await page.waitForSelector('.autocomplete-suggestion',{visible:true});
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await page.waitForSelector('.swal2-input',{visible:true});await page.waitForFunction(()=>document.activeElement.classList.contains('swal2-input'));await page.keyboard.type('3');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.added.length===1);
 assert.equal(await page.evaluate(()=>window.added[0].item_quantity),3);
 await page.waitForFunction(()=>document.activeElement.id==='sales_new_item_name');
 await page.keyboard.type('CB');await page.waitForSelector('.autocomplete-suggestion',{visible:true});await page.keyboard.press('Enter');await page.waitForSelector('.swal2-input',{visible:true});await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.activeElement.id==='sales_new_item_name');assert.equal(await page.evaluate(()=>window.added.length),1);
 assert.deepEqual(errors,[]);console.log('PASS: real autocomplete arrows/Enter, quantity 3, search focus restored, CB initials, Escape cancels');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
