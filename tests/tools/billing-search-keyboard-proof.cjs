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
  window.PosnicPro.get=(params,done)=>{const query=params.data.query;done({suggestions:query==='Tea'?[{item_id:'tea',item_name:'Tea'}]:query==='CB'?[{item_id:'cb',item_name:'Chicken Biryani'}]:query==='21'?[{item_id:'beans',item_name:'Beans',itemid:'21'}]:query==='22'?[{item_id:'a',item_name:'First duplicate',itemid:'22'},{item_id:'b',item_name:'Second duplicate',itemid:'22'}]:[]});};
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
 await page.keyboard.type('21');await page.waitForSelector('.autocomplete-suggestion',{visible:true});await page.keyboard.press('Tab');
 await page.waitForSelector('.swal2-input',{visible:true});await page.waitForFunction(()=>document.activeElement.classList.contains('swal2-input'));await page.keyboard.type('2');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.added.length===2);assert.equal(await page.evaluate(()=>window.added[1].item_quantity),2);await page.waitForFunction(()=>document.activeElement.id==='sales_new_item_name');
 await page.waitForFunction(()=>!$('.swal2-input').is(':visible'));await page.keyboard.type('22');await page.waitForFunction(()=>$('.autocomplete-suggestion').length===2);
 assert.equal(await page.evaluate(()=>$('#sales_new_item_name').data('autocomplete').selectedIndex),-1);await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>$('.swal2-input').is(':visible')),false);assert.equal(await page.evaluate(()=>window.added.length),2);
 assert.deepEqual(errors,[]);console.log('PASS: real autocomplete arrows/Enter, Tab/quantity/Enter, restored focus, no duplicate add, ambiguous codes require selection, Escape cancels');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
