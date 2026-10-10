const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
const code=source.slice(source.indexOf('PosnicPro.sales.addScannedItem ='),source.indexOf("$('#sales_new_item_name').scannerDetection"));
function setup(rows){
 const dom=new JSDOM('<input id="sales_new_item_name">'); const $=require('jquery')(dom.window);
 $.fn.modal=function(action){if(action==='hide')this.trigger('hidden.bs.modal');return this;};
 const added=[],errors=[]; let request;
 const pos={sales:{itemsMenu:{addToLineItemsList:id=>added.push(id)}},local:{get:()=> '£'},i18n:{t:(k,f)=>f},alert:(t,m)=>errors.push(m),get:(p,cb)=>{request=p;cb({suggestions:rows});}};
 pos.resolveTile=()=>({});
 vm.runInNewContext(source.slice(source.indexOf('PosnicPro.sugRow ='),source.indexOf('PosnicPro.sugActionRow =')),{PosnicPro:pos,$});
 vm.runInNewContext(code,{PosnicPro:pos,$,document:dom.window.document,swal:()=>{}});
 return {pos,$,added,errors,get request(){return request}};
}
const item=(id,extra={})=>({item_id:id,item_name:'Same product',itemid:id,available_quantity:4,track_inventory:true,selling_price:1,...extra});

test('chooser distinguishes barcode from SKU and displays VAT-inclusive prices',()=>{const t=setup([item('A',{barcode_id:'7622202828270',selling_price:1.75,tax:20,tax_type:'inclusive'}),item('B',{barcode_id:'7622202828270',selling_price:1.2,tax:20,tax_type:'exclusive'})]);t.pos.sales.addByBarcode('7622202828270');const buttons=t.$('#sharedBarcodePicker .list-group button');assert.match(buttons.eq(0).text(),/Barcode: 7622202828270 \| SKU: A/);assert.match(buttons.eq(0).text(),/£1\.75/);assert.match(buttons.eq(1).text(),/£1\.44/);});
test('shared scan waits for explicit choice and adds only selected immutable ID',()=>{const t=setup([item('A'),item('B')]);t.pos.sales.addByBarcode('123');assert.deepEqual(t.added,[]);const buttons=t.$('#sharedBarcodePicker .list-group button');assert.equal(buttons.length,2);buttons.eq(1).trigger('click');assert.deepEqual(t.added,['B']);assert.equal(t.$('#sharedBarcodePicker').length,0);});
test('unique barcode uses normal add path and encodes scanner text',()=>{const t=setup([item('A')]);t.pos.sales.addByBarcode('A&B+1');assert.deepEqual(t.added,['A']);assert.equal(t.request.data,'query=A%26B%2B1&type=barcode');});
test('out-of-stock selection cannot silently switch to a different duplicate',()=>{const t=setup([item('A',{available_quantity:0}),item('B')]);t.pos.sales.addByBarcode('123');t.$('#sharedBarcodePicker .list-group button').eq(0).trigger('click');assert.deepEqual(t.added,[]);assert.equal(t.errors.length,1);});
test('product names render as text and cancellation does not add a product',()=>{const t=setup([item('A',{item_name:'<img src=x onerror=alert(1)>'}),item('B')]);t.pos.sales.addByBarcode('123');assert.equal(t.$('#sharedBarcodePicker img').length,0);t.$('#sharedBarcodePicker').modal('hide');assert.deepEqual(t.added,[]);});
test('Enter on a typed barcode opens choices without autocomplete selecting the first item',()=>{const t=setup([item('A'),item('B')]);const input=t.$('#sales_new_item_name')[0];input.value='5011397027414';input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.deepEqual(t.added,[]);assert.equal(t.$('#sharedBarcodePicker .list-group button').length,2);assert.equal(input.value,'');});

test('custom chooser display retains choice by ID while hiding deselected metadata',()=>{const t=setup([item('A',{barcode_id:'123',sales_search_display_fields:['barcode']}),item('B',{barcode_id:'123',sales_search_display_fields:['barcode']})]);t.pos.sales.addByBarcode('123');const buttons=t.$('#sharedBarcodePicker .list-group button');assert.match(buttons.eq(0).text(),/Barcode: 123/);assert.ok(!buttons.eq(0).text().includes('SKU:'));buttons.eq(1).trigger('click');assert.deepEqual(t.added,['B']);});
