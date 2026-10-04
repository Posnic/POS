// Run after items-v2-proof.cjs: exercise the real editor with isolated HTTP storage.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
const puppeteer=require(require.resolve('puppeteer',{paths:[path.join(root,'api')]}));
const html=fs.readFileSync(path.join(root,'output/item-create-v2/preview.html'),'utf8').replace("currencySign:'₹'","username:'test-user',branch_id_set:'test-branch',currencySign:'₹'");
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
  const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  assert.equal(await page.$eval('#iv2-tab-restaurant',e=>e.hidden),true);
  await page.focus('#iv2-tab-basics');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id),'iv2-tab-stock');
  await page.click('#iv2-tab-basics');await page.type('#iv2-name','Draft soap');await page.type('#iv2-price','100');await page.type('#iv2-quantity','8');
  await page.click('#iv2-tab-details');await page.type('#iv2-brand','Sample brand');
  await page.waitForFunction(()=>document.getElementById('iv2-draft-note').textContent.includes('Text draft saved'));
  await page.reload();await page.waitForSelector('#iv2-draft-notice:not([hidden])');await page.click('#iv2-draft-notice button');
  assert.equal(await page.$eval('#iv2-name',e=>e.value),'Draft soap');assert.equal(await page.$eval('#iv2-brand',e=>e.value),'Sample brand');
  await page.click('#iv2-tab-more');await page.type('#iv2-gtin','123');await page.click('#iv2-tab-basics');await page.click('#iv2-save');
  assert.equal(await page.$eval('#iv2-panel-more',e=>e.hidden),false,'invalid GTIN reveals its tab');assert.equal(await page.evaluate(()=>savedRequests.length),0);
  await page.$eval('#iv2-gtin',e=>{e.value='4006381333931';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.type('#iv2-sku','SOAP-1');
  await page.click('#iv2-save');await page.waitForSelector('#iv2-success:not([hidden])');
  assert.equal(await page.$eval('#iv2-layout',e=>e.hidden),true);assert.equal(await page.$eval('#iv2-success a',e=>e.getAttribute('href')),'#/items/sample-item');
  assert.equal(await page.$eval('#iv2-success a:nth-of-type(2)',e=>e.getAttribute('href')),'#/items/sample-item/edit');
  assert.equal(await page.evaluate(()=>localStorage.length),0,'successful save clears draft');
  await page.screenshot({path:path.join(root,'output/item-create-v2/actual-saved.png'),fullPage:true});
  await page.click('#iv2-success button:last-child');assert.equal(await page.$eval('#iv2-name',e=>e.value),'Draft soap');
  for(const id of ['sku','barcode','gtin','quantity'])assert.equal(await page.$eval('#iv2-'+id,e=>e.value),'');
  await page.click('#iv2-save');assert.equal(await page.evaluate(()=>savedRequests.length),1,'duplicate requires new stock decision');
  await page.click('[name="iv2-stock"][value="untracked"]');await page.click('#iv2-save');await page.waitForSelector('#iv2-success:not([hidden])');await page.click('#iv2-success button');
  assert.equal(await page.$eval('#iv2-name',e=>e.value),'');
  await page.click('#iv2-tab-more');await page.click('#iv2-has-variants');await page.type('#iv2-axis1','Size');await page.type('#iv2-values1','Small, Large');await page.click('[data-iv2-advanced="generate"]');
  await page.type('#iv2-variant-0-selling_price','40');await page.type('#iv2-variant-0-available_quantity','2');await page.type('#iv2-variant-0-sku_id','SIZE-S');
  await page.waitForFunction(()=>document.getElementById('iv2-draft-note').textContent.includes('Text draft saved'));await page.reload();await page.click('#iv2-draft-notice button');
  assert.equal(await page.$eval('#iv2-variant-0-sku_id',e=>e.value),'SIZE-S');assert.equal(await page.$eval('#iv2-variant-0-selling_price',e=>e.value),'40');
  await page.setViewport({width:390,height:844});await page.select('#iv2-section-select','details');assert.equal(await page.$eval('#iv2-panel-details',e=>e.hidden),false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'output/item-create-v2/actual-tabs-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: tab keyboard navigation, mobile selection, draft recovery, hidden-field errors, real saved links, duplicate safeguards and variant drafts');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
