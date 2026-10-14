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
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{
  PosnicPro.local.get=()=>JSON.stringify({hardware_weight_machine_enable:true});
  PosnicPro.sales.isWeighedItem=item=>item.item_weight_machine_based===true;
  PosnicPro.sales.itemCache.get=(id,cb)=>cb({item_id:id,item_name:'Weighed item',item_weight_machine_based:true,track_inventory:false});
  window.scaleReads=0;
  window.WeightBridge={isAvailable:()=>true,getCurrentWeight:options=>{
   if(!options.stableOnly) throw new Error('Automatic add requires stable readings');
   window.scaleReads++;return new Promise(resolve=>{window.resolveScale=resolve;});
  }};
  PosnicPro.sales.askSearchQuantity({},'weighed');
 });
 await page.waitForSelector('.swal2-input',{visible:true});
 await page.evaluate(()=>window.resolveScale(0.375));
 await page.waitForFunction(()=>window.added.length===3);
 assert.equal(await page.evaluate(()=>window.added[2].item_quantity),0.375);
 assert.equal(await page.evaluate(()=>window.added[2]._quantityConfirmed),true);
 assert.equal(await page.evaluate(()=>window.scaleReads),1);
 await page.waitForFunction(()=>document.activeElement.id==='sales_new_item_name');
 // A cashier's manual entry wins over a late scale response.
 await page.evaluate(()=>PosnicPro.sales.askSearchQuantity({},'weighed'));
 await page.waitForFunction(()=>document.activeElement.classList.contains('swal2-input'));
 await page.keyboard.type('0.5');await page.evaluate(()=>window.resolveScale(0.9));
 assert.equal(await page.$eval('.swal2-input',el=>el.value),'0.5');
 assert.equal(await page.evaluate(()=>window.added.length),3);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.added.length===4);
 assert.equal(await page.evaluate(()=>window.added[3].item_quantity),0.5);
 // Cancellation discards a late reading, including when a new dialog exists.
 await page.evaluate(()=>PosnicPro.sales.askSearchQuantity({},'weighed'));
 await page.waitForSelector('.swal2-input',{visible:true});
 await page.evaluate(()=>{window.oldScale=window.resolveScale;});await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!$('.swal2-input').is(':visible'));
 await page.evaluate(()=>PosnicPro.sales.askSearchQuantity({},'weighed'));
 await page.waitForSelector('.swal2-input',{visible:true});
 await page.evaluate(()=>window.oldScale(0.8));
 assert.equal(await page.$eval('.swal2-input',el=>el.value),'');
 assert.equal(await page.evaluate(()=>window.added.length),4);
 await page.evaluate(()=>window.resolveScale(null));await page.keyboard.press('Escape');
 // Tab from quantity is the same validated action as Add to sale.
 await page.waitForFunction(()=>!$('.swal2-input').is(':visible'));
 await page.evaluate(()=>{PosnicPro.local.get=()=>null;PosnicPro.sales.askSearchQuantity({},'weighed');});
 await page.waitForFunction(()=>document.activeElement.classList.contains('swal2-input'));
 await page.keyboard.press('Tab');
 await page.waitForSelector('.swal2-validationerror',{visible:true});
 assert.equal(await page.evaluate(()=>window.added.length),4);
 await page.type('.swal2-input','0.625');await page.keyboard.press('Tab');
 await page.waitForFunction(()=>window.added.length===5);
 assert.equal(await page.evaluate(()=>window.added[4].item_quantity),0.625);
 await page.waitForFunction(()=>document.activeElement.id==='sales_new_item_name');
 await page.evaluate(()=>PosnicPro.sales.askSearchQuantity({},'weighed'));
 await page.waitForFunction(()=>document.activeElement.classList.contains('swal2-input'));
 await page.keyboard.type('1');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
 assert.equal(await page.evaluate(()=>window.added.length),5);await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS: quantity Tab/Enter adds once and restores search, invalid quantity stays open, Shift+Tab navigates, stable scale auto-add, manual override and late-reading cancellation');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
