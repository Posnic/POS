const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(root, 'api'), process.env.POSNIC_TEST_DEPENDENCIES].filter(Boolean) }));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const output = path.join(root, 'output/item-create-v2'); fs.mkdirSync(output, { recursive: true });
const stub = `window.savedRequests=[];window.PosnicPro={
 local:{get:k=>({currencySign:'₹',tax_type:'inclusive',default_tax_id:'gst5'})[k]},
 i18n:{t:(_key,fallback)=>fallback},HideSideBarModal(){},aclLoaded:()=>true,checkAccess:()=>true,
 get(p,ok,fail){if(p.url==='settings/group/channels')return ok({data:{values:{menu_dayparts:[{id:'lunch',name:'Lunch'}]}}});if(p.url==='setting/modifierGroups')return ok({data:[{id:'spice',name:'Spice level'}]});if(p.url.includes('Tax')){if(window.failTax)return fail();return ok({data:[{tax_id:'gst5',tax_name:'GST 5%',tax_value:5}]});}ok({suggestions:[{id:'food',name:'Food'}]});},
 request(p,ok,fail){window.savedRequests.push(JSON.parse(p.data));setTimeout(()=>{if(window.failSave)return fail({responseText:JSON.stringify({message:'Connection unavailable. Your entries are still here.'})});ok({type:'success',data:{id:'sample-item'}});},80);}
};`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Posnic · Create item v2</title><style>body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f6f8fb} .demo-head{background:white;border-bottom:1px solid #e2e8f1;padding:20px 36px;display:flex;justify-content:space-between;align-items:center;gap:20px}.demo-head b{color:#0963e8;font-size:25px}.demo-head span{color:#61738e;font-size:12px} ${read('frontend/static/style/css/modules/items-v2.css')}</style></head><body><div class="demo-head"><b>Posnic</b><span>Preview only · no shop data changes</span><label style="font-size:12px;color:#61738e">Business <select id="preview-business" style="padding:8px;border:1px solid #d6dfec;border-radius:6px" onchange="PosnicPro.items_v2.setBusinessContext(this.value)"><option value="retail">Retail shop</option><option value="restaurant">Restaurant / café</option><option value="service">Services</option></select></label></div>${read('frontend/modules/items_v2.html')}<script>${read('frontend/static/script/js/jquery.min.js')}</script><script>${stub}</script><script>${read('frontend/static/script/js/modules/js/items_v2.js')}</script><script>PosnicPro.items_v2.showAdd();</script></body></html>`;
fs.writeFileSync(path.join(output, 'preview.html'), html);
(async () => {
 const browser = await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1320,height:1060});await page.setContent(html);
  await page.type('#iv2-name','Tea');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'iv2-price');
  await page.click('#iv2-save');assert.equal(await page.evaluate(()=>savedRequests.length),0);
  assert.equal(await page.$eval('#iv2-zero-price',el=>el.hidden),false);
  await page.screenshot({path:path.join(output,'zero-guidance.png'),fullPage:true});
  await page.click('#iv2-confirm-zero');await page.click('#iv2-save');assert.equal(await page.evaluate(()=>savedRequests.length),0);
  await page.click('[name="iv2-zero-stock"][value="later"]');await page.click('#iv2-save');
  await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const first=await page.evaluate(()=>savedRequests[0]);assert.equal(first.negative_stock,false);assert.equal(first.selling_price,0);assert.equal(first.inventory,true);
  await page.click('#iv2-success button');
  await page.click('[name="iv2-kind"][value="dish"]');await page.type('#iv2-name','Tea');await page.type('#iv2-price','25');
  assert.equal(await page.$eval('#iv2-zero-stock',el=>el.hidden),true);
  await page.screenshot({path:path.join(output,'ready-to-sell.png'),fullPage:true});
  await page.select('#iv2-tax-type','exclusive');assert.ok((await page.$eval('#iv2-price-hint',el=>el.textContent)).includes('26.25'));
  await page.select('#iv2-tax-type','inclusive');
  await page.evaluate(()=>window.failSave=true);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-error').hidden);
  assert.equal(await page.$eval('#iv2-name',el=>el.value),'Tea');
  await page.evaluate(()=>window.failSave=false);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  assert.equal(await page.evaluate(()=>savedRequests.at(-1).inventory),false);
  await page.click('#iv2-success button');await page.type('#iv2-name','Water');await page.type('#iv2-price','30');
  await page.click('[name="iv2-zero-stock"][value="negative"]');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  assert.equal(await page.evaluate(()=>savedRequests.at(-1).negative_stock),true);
  await page.click('#iv2-success button');await page.type('#iv2-name','Sample product');
  for(const width of [1040,760,390]){await page.setViewport({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'horizontal overflow '+width);}
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  await page.setContent(html.replace('window.savedRequests=[];','window.failTax=true;window.savedRequests=[];'));
  await page.type('#iv2-name','Tea');await page.type('#iv2-price','25');await page.click('[name="iv2-stock"][value="untracked"]');await page.click('#iv2-save');assert.equal(await page.evaluate(()=>savedRequests.length),0);
  await page.evaluate(()=>window.failTax=false);await page.click('[data-iv2-action="retry"]');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  await page.select('#preview-business','restaurant');
  assert.equal(await page.$eval('#iv2-title',el=>el.textContent),'Create dish');
  assert.equal(await page.$eval('[name="iv2-stock"][value="untracked"]',el=>el.checked),true);
  assert.equal(await page.$eval('#iv2-product-label',el=>el.textContent),'Packaged product');
  await page.setViewport({width:1320,height:1060});await page.type('#iv2-name','Chicken biryani');await page.type('#iv2-price','250');await page.focus('#iv2-price');
  assert.equal(await page.$eval('#iv2-price',el=>getComputedStyle(el).outlineStyle),'none');
  assert.equal(await page.$eval('.iv2-money',el=>getComputedStyle(el).outlineStyle),'solid');
  await page.screenshot({path:path.join(output,'restaurant.png'),fullPage:true});
  await page.click('#iv2-restaurant summary');await page.click('#iv2-periods input');await page.click('#iv2-modifiers input');await page.select('#iv2-diet','non_veg');
  await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const dish=await page.evaluate(()=>savedRequests.at(-1));assert.deepEqual(dish.daypart_ids,['lunch']);assert.deepEqual(dish.modifier_group_ids,['spice']);assert.equal(dish.diet,'non_veg');
  await page.setContent(html.replace("default_tax_id:'gst5'", "default_tax_id:'gst5',table_options:'enable',general_settings:JSON.stringify({module_tax_enable:false,module_online_ordering_enable:false})"));
  assert.equal(await page.$eval('#iv2-title',el=>el.textContent),'Create dish');
  assert.equal(await page.$eval('#iv2-tax-field',el=>el.hidden),true);assert.equal(await page.$eval('#iv2-online',el=>el.hidden),true);
  await page.type('#iv2-name','Tea');await page.type('#iv2-price','20');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  assert.equal(await page.evaluate(()=>savedRequests[0].tax),0);assert.equal(await page.evaluate(()=>savedRequests[0].ecommerce),false);
  assert.deepEqual(errors,[]);console.log('PASS: zero guidance, saved settings, keyboard, retry, tax preview, responsive widths and no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
