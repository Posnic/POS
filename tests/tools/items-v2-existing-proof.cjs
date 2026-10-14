const fs=require('node:fs'),assert=require('node:assert/strict'),http=require('node:http');
const puppeteer=require('../../api/node_modules/puppeteer');
(async()=>{
 const html=fs.readFileSync('output/item-create-v2/preview.html','utf8');
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 try{
 const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>{
 const get=PosnicPro.get;
 window.originalItem={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',name:'Existing soap',selling_price:100,company_price:40,mrp_price:120,available_quantity:-3,track_inventory:true,negative_stock:true,itemid:'SOAP-22',barcode_id:'SOAP-B',unit:'kg',unit_id:'kg-id',category_id:'old-category',category_name:'Archived category',supplier_id:'old-supplier',supplier_name:'Existing supplier',tax:5,tax_id:'gst5',tax_name:'GST 5%',tax_type:'inclusive',description:'Original description',image:'/saved-photo.png',multi_image:[{name:'/saved-photo.png',size:234,cover:'yes'}],show_on_menu:false,daypart_ids:['evening'],modifier_group_ids:['extras'],channel_hours:{web:{from:'09:00'}},nutrition_source:'estimated',food_tags:['organic'],variant_parent_id:'family-1',variant_value:'Large',item_weight_machine_based:true,ecommerce:true};
 PosnicPro.get=(r,done,fail)=>r.url==='items/getItemDetails'?done({type:'success',data:originalItem}):get(r,done,fail);
 PosnicPro.items_v2.showEdit(originalItem._id);
 });
 await page.waitForFunction(()=>document.getElementById('iv2-name').value==='Existing soap');
 assert.equal(await page.$eval('#iv2-title',e=>e.textContent),'Edit item');
 assert.equal(await page.$eval('#iv2-sku',e=>e.value),'SOAP-22');
 assert.equal(await page.$eval('#iv2-category',e=>e.selectedOptions[0].textContent),'Archived category');
 assert.equal(await page.$eval('#iv2-photo-list img',e=>e.getAttribute('src')),'/saved-photo.png');
 await page.$eval('#iv2-name',e=>{e.value='Renamed soap';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.click('#iv2-save');await page.waitForSelector('#iv2-success:not([hidden])');
 const saved=await page.evaluate(()=>savedRequests.at(-1));
 assert.equal(saved.name,'Renamed soap');assert.equal(saved.available_quantity,undefined);
 assert.equal(saved.cover_image,'/saved-photo.png');assert.equal(saved.inventory,true);assert.equal(saved.negative_stock,true);
 assert.equal(saved.item_weight_machine_based,true);assert.equal(saved.show_on_menu,false);assert.deepEqual(saved.daypart_ids,['evening']);assert.equal(saved.nutrition_source,'estimated');assert.equal(saved.variant_parent_id,'family-1');
 assert.deepEqual(await page.evaluate(()=>savedCalls.at(-1)),{url:'items/aaaaaaaaaaaaaaaaaaaaaaaa/details',method:'PUT'});
 assert.deepEqual(errors,[]);
 await page.evaluate(()=>PosnicPro.items_v2.showAdd());
 assert.equal(await page.$eval('#iv2-name',e=>e.value),'');
 await page.evaluate(()=>PosnicPro.items_v2.showClone(originalItem._id));
 assert.equal(await page.$eval('#iv2-title',e=>e.textContent),'Create a copy');
 assert.equal(await page.$eval('#iv2-sku',e=>e.value),'');
 assert.equal(await page.$eval('#iv2-name',e=>e.value),'Existing soap (copy)');
 assert.equal(await page.evaluate(()=>savedCalls.length),1);
 await page.evaluate(()=>{const get=PosnicPro.get;PosnicPro.get=(r,done,fail)=>r.url==='items/getItemDetails'?fail():get(r,done,fail);PosnicPro.items_v2.showEdit('bad');});
 assert.equal(await page.$eval('#iv2-save',e=>e.disabled),true);
 assert.equal(await page.$eval('#iv2-fields',e=>e.disabled),true);
 assert.match(await page.$eval('#iv2-error',e=>e.textContent),/Could not load/);
 assert.deepEqual(errors,[]);
 console.log('PASS: existing item hydration, archived selections, images, hidden settings, variant identity, negative stock preservation, PUT save and create reset');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
