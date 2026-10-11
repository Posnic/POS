const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const prefs=require('../api/src/helpers/sales-search-fields');

test('legacy typed search keeps name, SKU, both barcode fields and numeric quick codes',()=>{
 const regex=/12/i;
 assert.deepEqual(prefs.conditions(undefined,'12',regex),[{name:regex},{'translations.name':regex},{itemid:regex},{item_code:regex},{barcode_id:regex},{barcodes:regex},{short_code:regex},{plu_code:'12'}]);
});
test('selected supplier and category are the only typed match fields',()=>{
 const regex=/stock/i;
 assert.deepEqual(prefs.conditions(['supplier','category'],'stock',regex),[{supplier_name:regex},{category_name:regex}]);
 assert.deepEqual(prefs.conditions(['plu'],'letters',regex),[{short_code:regex}]);
});
test('settings reject empty typed fields, invalid fields and wrong payloads',()=>{
 for(const value of [[],['price'],['$where'],'name',{}])assert.throws(()=>prefs.validate('sales_search_fields',value));
 assert.deepEqual(prefs.validate('sales_search_display_fields',[]),[]);
 assert.equal(prefs.validate('sales_search_display_fields',null),null);
 assert.deepEqual(prefs.validate('sales_search_fields',['name','name']),['name']);
});
const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
function render(fields,sales=true){
 const dom=new JSDOM('');const $=require('jquery')(dom.window);
 const PosnicPro={local:{get:()=>5},resolveTile:()=>({}),tileShapeCss:()=>''};
 vm.runInNewContext(source.slice(source.indexOf('PosnicPro.sugRow ='),source.indexOf('PosnicPro.sugActionRow =')),{PosnicPro,$});
 return PosnicPro.sugRow({item_name:'Name',itemid:'SKU-1',barcode_id:'123456',supplier_name:'Vendor',category_name:'Category',available_quantity:8,sales_search_display_fields:fields},'Name',{sales,price:1.75,currency:'GBP'});
}
test('sales display can show barcode and supplier without SKU, price, stock or image',()=>{
 const html=render(['barcode','supplier']);assert.match(html,/Barcode: 123456/);assert.match(html,/Supplier: Vendor/);
 for(const absent of ['SKU-1','Category','1.75','In stock','sug-tile'])assert.ok(!html.includes(absent),absent);
});
test('purchase ignores sales display settings and preserves its default display',()=>{
 const html=render(['barcode','supplier'],false);assert.match(html,/SKU-1/);assert.match(html,/Category/);assert.match(html,/1.75/);assert.match(html,/In stock/);assert.ok(!html.includes('Vendor'));
});
test('empty custom display still shows the product name',()=>{const html=render([]);assert.match(html,/Name/);assert.ok(!html.includes('SKU-1'));});
