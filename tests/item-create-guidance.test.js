const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');
const {preview} = require('../api/src/services/item-price-preview');

for (const [input, expected] of [
  [{price:250,tax:5,tax_type:'exclusive'},262.5],
  [{price:262.5,tax:5,tax_type:'inclusive'},262.5],
  [{price:100,tax:10,tax_type:'exclusive',discount_percentage:10},99],
  [{price:110,tax:10,tax_type:'inclusive',discount_amount:10},99],
  [{price:100,tax:0,tax_type:'exclusive',discount_amount:10},90],
  [{price:0,tax:0,tax_type:'inclusive'},0],
]) test('preview uses sale tax semantics: '+JSON.stringify(input),()=>assert.equal(preview(input).total,expected));
test('invalid prices and excessive discounts do not produce a misleading preview',()=>{
  for(const input of [{price:''},{price:'bad'},{price:-1},{price:5,discount_amount:8},{price:10,discount_percentage:101}])
    assert.throws(()=>preview({tax:0,tax_type:'exclusive',...input}));
});

test('save lock rejects repeated submission and unlocks for retry without clearing fields',()=>{
  const dom=new JSDOM(fs.readFileSync('frontend/modules/items_write.html','utf8'));
  const $=jquery(dom.window);
  const src=fs.readFileSync('frontend/static/script/js/modules/js/items.js','utf8');
  const block=src.slice(src.indexOf('    _saving:'),src.indexOf('    stockMessage:'));
  const app={items:null};app.items=new Function('$','PosnicPro','return ({'+block+'});')($,app);
  $('#items_name').val('Tea');
  assert.equal(app.items.beginSave(),true);assert.equal(app.items.beginSave(),false);
  assert.equal($('#item_save_bar button[type="submit"]').prop('disabled'),true);
  app.items.finishSave();
  assert.equal($('#items_name').val(),'Tea');assert.equal(app.items.beginSave(),true);
  app.items.finishSave();dom.window.close();
});

test('upload failures release the save lock and retain the draft',()=>{
  const dom=new JSDOM(fs.readFileSync('frontend/modules/items_write.html','utf8'));
  const $=jquery(dom.window);let ok,fail,finished=0,saved=0;
  const app={i18n:{t:(_k,v)=>v},alert(){},post(_p,a,b){ok=a;fail=b;},items:{imageParams:[],finishSave(){finished++;},item(){saved++;}}};
  const src=fs.readFileSync('frontend/static/script/js/modules/js/items.js','utf8');
  const block=src.slice(src.indexOf('    itemImageFormSubmit:'),src.indexOf('    updateItemAvailability:'));
  const upload=new Function('$','PosnicPro','return ({'+block+'}).itemImageFormSubmit;')($,app);
  $('#items_name').val('Tea');upload();fail({responseText:'not JSON'});
  assert.equal(finished,1);assert.equal(saved,0);assert.equal($('#items_name').val(),'Tea');
  upload();ok({type:'error',message:'Upload failed'});assert.equal(finished,2);assert.equal(saved,0);
  upload();ok({type:'success',data:[]});assert.equal(saved,1);assert.equal($('#item_upload_image_status').val(),'no');
  dom.window.close();
});

test('stale price previews cannot replace newer prices or open-price mode',async()=>{
  const dom=new JSDOM(fs.readFileSync('frontend/modules/items_write.html','utf8'));
  const $=jquery(dom.window);const calls=[];
  const app={i18n:{t:(_k,v)=>v},local:{get:()=>''},post(p,ok){calls.push({p,ok});},items:{}};
  const src=fs.readFileSync('frontend/static/script/js/modules/js/items.js','utf8');
  const block=src.slice(src.indexOf('    _saving:'),src.indexOf('    // Ask before upload/save;'));
  app.items=new Function('$','PosnicPro','return ({'+block+'});')($,app);
  app.items.selectAttr=()=>0;
  $('#items_selling_price').val('100');app.items.refreshCreateSummary();
  await new Promise(r=>setTimeout(r,330));
  $('#items_selling_price').val('200');app.items.refreshCreateSummary();
  await new Promise(r=>setTimeout(r,330));
  calls[1].ok({type:'success',data:{base:200,discount:0,tax:0,total:200}});
  calls[0].ok({type:'success',data:{base:100,discount:0,tax:0,total:100}});
  assert.match($('#item_price_preview').text(),/200\.00/);
  $('#item_open_price').prop('checked',true);app.items.refreshCreateSummary();
  calls[1].ok({type:'success',data:{base:200,discount:0,tax:0,total:200}});
  assert.match($('#item_price_preview').text(),/entered at the sale/);
  dom.window.close();
});
