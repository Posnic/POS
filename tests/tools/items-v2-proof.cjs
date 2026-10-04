const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(root, 'api'), process.env.POSNIC_TEST_DEPENDENCIES].filter(Boolean) }));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const built = process.argv.includes('--built');
const dashboard = built ? read('frontend/public/dashboard.html') : '';
const stylesheet = built
 ? read('frontend/public/' + dashboard.match(/href="(style\/dashboard\.[a-f0-9]+\.css)"/)[1])
 : read('frontend/static/style/css/modules/items-v2.css');
const output = path.join(root, 'output/item-create-v2'); fs.mkdirSync(output, { recursive: true });
const stub = `(function(){var nativeScrollIntoView=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(){nativeScrollIntoView.call(this,{behavior:'instant',block:'center'});};}());window.savedRequests=[];window.PosnicPro={
 local:{get:k=>({currencySign:'₹',tax_type:'inclusive',default_tax_id:'gst5'})[k]},
 i18n:{t:(_key,fallback)=>fallback},HideSideBarModal(){},aclLoaded:()=>true,checkAccess:()=>true,
 get(p,ok,fail,last){if(typeof p==='string'){ok=fail;fail=last;p={url:p};}if(p.url==='items/aiAvailability')return ok({data:{available:false}});if(p.url.includes('Unit'))return ok({suggestions:[{unit_id:'unit-kg',unit_name:'Kilogram',unit_value:'kg'}]});if(p.url.includes('Suppliers'))return ok({suggestions:[{id:'supplier-1',name:'Demo supplier'}]});if(p.url==='settings/group/channels')return ok({data:{values:{menu_dayparts:[{id:'lunch',name:'Lunch'}]}}});if(p.url==='setting/modifierGroups')return ok({data:[{id:'spice',name:'Spice level'}]});if(p.url.includes('Tax')){if(window.failTax)return fail();return ok({data:[{tax_id:'gst5',tax_name:'GST 5%',tax_value:5}]});}ok({suggestions:[{id:'food',name:'Food'}]});},
 post(p,ok,fail){const d=JSON.parse(p.data);if(p.url==='items/uploadItemMultiImage'){if(window.failUpload)return fail();return ok({type:'success',data:d.items_image.map(p=>({name:'/uploads/item_images/'+p.name,size:p.size,cover:p.cover}))});}const base=d.tax_type==='inclusive'?d.price/(1+d.tax/100):d.price;const discount=d.discount_amount||base*d.discount_percentage/100;const total=Math.max(0,base-discount)*(1+d.tax/100);ok({type:'success',data:{total}});},
 request(p,ok,fail){window.savedRequests.push(JSON.parse(p.data));setTimeout(()=>{if(window.failSave)return fail({responseText:JSON.stringify({message:'Connection unavailable. Your entries are still here.'})});ok({type:'success',data:{id:'sample-item'}});},80);}
};`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Posnic · Create item v2</title><style>body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f6f8fb} .demo-head{background:white;border-bottom:1px solid #e2e8f1;padding:20px 36px;display:flex;justify-content:space-between;align-items:center;gap:20px}.demo-head b{color:#0963e8;font-size:25px}.demo-head span{color:#61738e;font-size:12px} ${stylesheet} html,body{scroll-behavior:auto!important}</style></head><body><div class="demo-head"><b>Posnic</b><span>Preview only · no shop data changes</span><label style="font-size:12px;color:#61738e">Business <select id="preview-business" style="padding:8px;border:1px solid #d6dfec;border-radius:6px" onchange="PosnicPro.items_v2.setBusinessContext(this.value)"><option value="retail">Retail shop</option><option value="restaurant">Restaurant / café</option><option value="service">Services</option></select></label></div>${read('frontend/modules/items_v2.html')}<script>${read('frontend/static/script/js/jquery.min.js')}</script><script>${stub}</script><script>${read('api/src/utils/item-localization.js')}</script><script>${read('frontend/static/script/js/modules/js/item-translations-v2.js')}</script><script>${read('frontend/static/script/js/modules/js/items-v2-details.js')}</script><script>${read('frontend/static/script/js/modules/js/items-v2-workspace.js')}</script><script>${read('frontend/static/script/js/modules/js/items_v2.js')}</script><script>PosnicPro.items_v2.showAdd();</script></body></html>`;
fs.writeFileSync(path.join(output, 'preview.html'), html);
(async () => {
 const browser = await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage(), errors=[];const click=page.click.bind(page);page.click=async(selector,...args)=>{await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));return click(selector,...args);};page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1320,height:1060});await page.setContent(html);
  // Navigate the actual tabs before interacting with their fields.
  for(const method of ['click','type','select','focus']){const original=page[method].bind(page);page[method]=async(selector,...args)=>{
   const panel=await page.$eval(selector,e=>e.closest('.iv2-tab-panel')?.id).catch(()=>null);
   if(panel){const section=panel.replace('iv2-panel-','');if(await page.$eval('.iv2-tabs',e=>getComputedStyle(e).display==='none'))await page.select('#iv2-section-select',section);else await click('#iv2-tab-'+section);}
   return original(selector,...args);
  };}

  const saveStyle = await page.$eval('#iv2-save', el => {
   const style = getComputedStyle(el);
   return { background: style.backgroundColor, color: style.color, accent: style.getPropertyValue('--iv2-blue').trim() };
  });
  assert.equal(saveStyle.accent, '#0963e8', 'the bundled module root must define its colours');
  assert.equal(saveStyle.background, 'rgb(9, 99, 232)', 'Save must have an opaque blue background');
  assert.equal(saveStyle.color, 'rgb(255, 255, 255)', 'Save text must contrast with the background');
  assert.equal(await page.$eval('[name="iv2-kind"][value="dish"]', el => el.disabled && el.closest('label').hidden), true, 'retail shops must not offer Dish');
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
  await page.select('#preview-business','restaurant');await page.type('#iv2-name','Tea');await page.type('#iv2-price','25');
  assert.equal(await page.$eval('[name="iv2-kind"][value="dish"]', el => el.disabled || el.closest('label').hidden), false);
  assert.equal(await page.$eval('#iv2-zero-stock',el=>el.hidden),true);
  await page.screenshot({path:path.join(output,'ready-to-sell.png'),fullPage:true});
  await page.select('#iv2-tax-type','exclusive');await page.waitForFunction(()=>document.getElementById('iv2-price-hint').textContent.includes('26.25'));
  await page.select('#iv2-tax-type','inclusive');
  await page.evaluate(()=>window.failSave=true);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-error').hidden);
  assert.equal(await page.$eval('#iv2-name',el=>el.value),'Tea');
  await page.evaluate(()=>window.failSave=false);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  assert.equal(await page.evaluate(()=>savedRequests.at(-1).inventory),false);
  await page.select('#preview-business','retail');await page.type('#iv2-name','Water');await page.type('#iv2-price','30');
  await page.click('#iv2-save');await page.click('[name="iv2-zero-stock"][value="negative"]');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
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
  await page.click('#iv2-tab-restaurant');await page.click('#iv2-periods input');await page.click('#iv2-modifiers input');await page.select('#iv2-diet','non_veg');
  await page.type('#iv2-prep-minutes','12');await page.type('#iv2-prep-note','Serve hot');await page.type('#iv2-n-kcal','350');await page.click('#iv2-food-organic');await page.click('#iv2-mark-signature');await page.click('#iv2-spice');
  await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const dish=await page.evaluate(()=>savedRequests.at(-1));assert.deepEqual(dish.daypart_ids,['lunch']);assert.deepEqual(dish.modifier_group_ids,['spice']);assert.equal(dish.diet,'non_veg');assert.equal(dish.prep_minutes,12);assert.equal(dish.prep_note,'Serve hot');assert.equal(dish.nutrition.kcal,350);assert.deepEqual(dish.food_tags,['organic']);assert.deepEqual(dish.menu_marks,['signature']);assert.equal(dish.spice_choice,true);
  await page.setContent(html.replace("default_tax_id:'gst5'", "default_tax_id:'gst5',table_options:'enable',general_settings:JSON.stringify({module_tax_enable:false,module_online_ordering_enable:false})"));
  assert.equal(await page.$eval('#iv2-title',el=>el.textContent),'Create dish');
  assert.equal(await page.$eval('#iv2-tax-field',el=>el.hidden),true);assert.equal(await page.$eval('#iv2-online',el=>el.hidden),true);
  await page.type('#iv2-name','Tea');await page.type('#iv2-price','20');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  assert.equal(await page.evaluate(()=>savedRequests[0].tax),0);assert.equal(await page.evaluate(()=>savedRequests[0].ecommerce),false);
  // Fill the advanced form, then verify the actual request rather than just the labels.
  await page.setContent(html);
  await page.evaluate(()=>document.querySelectorAll('#items_v2 details').forEach(e=>e.open=true));
  const setFields=async values=>page.evaluate(values=>{for(const[id,value]of Object.entries(values)){const e=document.getElementById('iv2-'+id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}},values);
  await setFields({name:'Organic soap',price:'105',quantity:'12',cost:'50',mrp:'120',reorder:'4',unit:'unit-kg',supplier:'supplier-1',discount:'10','discount-type':'amount',plu:'42',sku:'SOAP-1',barcode:'SOAP-001',gtin:'4006381333931','alt-barcodes':'SOAP-A, SOAP-B','purchase-unit':'Box','pack-size':'12',category:'food',brand:'Test brand',tags:'soap, organic',position:'7',mfg:'2026-10-01',expiry:'2027-10-01',description:'Sample complete item for testing.',hsn:'3304','hsn-rate':'5','hsn-description':'Soap',icon:'🧼'});
  await page.click('#iv2-tab-languages');await page.select('#iv2-item_original_language','en');await page.select('#iv2-item_translation_language','ta');
  await page.type('#iv2-item_translation_name','சோப்பு');await page.type('#iv2-item_translation_description','சோதனை விளக்கம்');
  const photoPath=path.join(output,'fixture.png');fs.writeFileSync(photoPath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFfkAAAAASUVORK5CYII=','base64'));
  await (await page.$('#iv2-photos')).uploadFile(photoPath);await page.waitForSelector('#iv2-photo-list img');
  await page.waitForFunction(()=>document.getElementById('iv2-price-hint').textContent.includes('94.50'));
  await page.screenshot({path:path.join(output,'complete-item.png'),fullPage:true});
  const sample=await page.evaluate(()=>{
   const clone=document.documentElement.cloneNode(true);
   clone.querySelectorAll('script').forEach(e=>e.remove());
   document.querySelectorAll('input,textarea,select').forEach(source=>{if(!source.id)return;const target=clone.querySelector('[id="'+source.id+'"]');if(!target)return;
    if(source.tagName==='SELECT'){[...target.options].forEach((o,i)=>{if(source.options[i].selected)o.setAttribute('selected','');else o.removeAttribute('selected');});}
    else if(source.tagName==='TEXTAREA')target.textContent=source.value;
    else if(source.type!=='file'){target.setAttribute('value',source.value);if(source.checked)target.setAttribute('checked','');else target.removeAttribute('checked');}
   });
   clone.querySelector('form').setAttribute('onsubmit','return false');clone.querySelector('#iv2-save').textContent='Example only';clone.querySelector('#iv2-save').disabled=true;
   clone.querySelectorAll('[onchange]').forEach(e=>e.removeAttribute('onchange'));
   return '<!doctype html>'+clone.outerHTML;
  });fs.writeFileSync(path.join(output,'filled-example.html'),sample);
  await page.evaluate(()=>window.failUpload=true);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-error').hidden);assert.equal(await page.evaluate(()=>savedRequests.length),0);
  await page.evaluate(()=>window.failUpload=false);await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const full=await page.evaluate(()=>savedRequests.at(-1));
  assert.equal(full.mrp_price,120);assert.equal(full.supplier_id,'supplier-1');assert.equal(full.unit,'kg');assert.equal(full.reorder_point,4);
  assert.equal(full.discount_amount,10);assert.equal(full.discount_percentage,0);assert.equal(full.gtin,'4006381333931');assert.deepEqual(full.barcodes,['SOAP-A','SOAP-B']);
  assert.equal(full.conversion_factor,12);assert.equal(full.purchase_unit,'Box');assert.equal(full.items_expiry_date,'2027-10-01');assert.deepEqual(full.tags,['soap','organic']);
  assert.equal(full.translations[0].name,'சோப்பு');assert.equal(full.translations[0].locale,'ta');assert.equal(full.default_language,'en');assert.equal(full.image.length,1);assert.equal(full.image[0].cover,'yes');assert.equal(full.cover_image,'/uploads/item_images/fixture.png');assert.equal(full.image[0].data,undefined);
  assert.equal(full.tax_method,'hsn');assert.equal(full.hsn_code,'3304');assert.equal(full.tax,5);assert.equal(full.icon,'🧼');
  fs.writeFileSync(path.join(output,'full-payload.json'),JSON.stringify(full,null,2));
  await page.click('#iv2-success button');
  await setFields({name:'Cotton shirt',price:'200',quantity:'0',axis1:'Size',values1:'S, M',axis2:'Colour',values2:'Blue, White'});
  await page.click('#iv2-has-variants');await page.click('[data-iv2-advanced="generate"]');
  assert.equal(await page.$$eval('.iv2-variant',es=>es.length),4);
  await setFields({'variant-0-selling_price':'210','variant-0-available_quantity':'3','variant-1-available_quantity':'4','variant-2-available_quantity':'5','variant-3-available_quantity':'6','variant-0-barcode_id':'SHIRT-BLUE-S','variant-0-unit':'unit-kg'});
  // Regeneration preserves row edits for combinations that still exist.
  await page.click('[data-iv2-advanced="generate"]');assert.equal(await page.$eval('#iv2-variant-0-selling_price',e=>e.value),'210');
  await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const family=await page.evaluate(()=>savedRequests.at(-1));assert.equal(family.items.length,4);assert.equal(family.variant_axis,'Size / Colour');assert.equal(family.items[0].name,'Cotton shirt / S / Blue');assert.equal(Number(family.items[0].selling_price),210);assert.equal(family.items[0].available_quantity,3);assert.equal(family.items[0].barcode_id,'SHIRT-BLUE-S');assert.equal(family.items[1].barcode_id,'');assert.equal(family.items[0].unit,'kg');assert.equal(family.items[0].unit_id,'unit-kg');
  fs.writeFileSync(path.join(output,'family-payload.json'),JSON.stringify(family,null,2));
  await page.select('#preview-business','service');await setFields({name:'Consultation','service-unit':'hour'});await page.click('#iv2-open-price');await page.click('#iv2-save');await page.waitForFunction(()=>!document.getElementById('iv2-success').hidden);
  const service=await page.evaluate(()=>savedRequests.at(-1));assert.equal(service.open_price,true);assert.equal(service.service_unit,'hour');assert.equal(service.inventory,false);assert.equal(service.item_kind,'service');assert.equal(service.available_quantity,0);
  assert.equal(service.image.length,0);assert.equal(service.translations.length,0);
  assert.deepEqual(errors,[]);console.log('PASS: zero guidance, saved settings, keyboard, retry, tax preview, responsive widths and no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
