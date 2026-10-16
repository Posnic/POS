const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
function setup(){
 const dom=new JSDOM(fs.readFileSync('frontend/modules/sales_write.html','utf8'),{runScripts:'outside-only'});
 const w=dom.window,$=jquery(w);w.$=$;
 const calls=[];
 w.PosnicPro={i18n:{t(key,fallback){return fallback;}},sales:{renderRecentCustomers(){},updateCustomerChip(){},applyCustomerPick(d){calls.push(d);}},request(p,ok,fail){calls.push({p,ok,fail});}};
 const a=source.indexOf('PosnicPro.sales.setCustomerPopup =');
 w.eval(source.slice(a,source.indexOf('// Customer popover:',a)));
 return {dom,w,$,calls};
}
test('customer icon shares the search row and opens one popup with focus and Escape dismissal',()=>{
 const {dom,w,$}=setup();try{
 assert.equal($('#sales_customer_btn').closest('.sales-search-toolbar').find('#sales_new_item_name').length,1);
 assert.equal($('#sales_customer_popup #sales_new_customer_name').length,1);
 $('#sales_customer_btn').trigger('click');assert.equal($('#sales_customer_btn').attr('aria-expanded'),'true');
 assert.equal(w.document.activeElement.id,'sales_new_customer_name');
 $('#sales_new_customer_name').trigger($.Event('keydown',{key:'Escape'}));
 assert.equal($('#sales_customer_btn').attr('aria-expanded'),'false');assert.equal(w.document.activeElement.id,'sales_customer_btn');
 }finally{dom.window.close();}
});
test('inline customer creation prevents double submission, reports failures, and selects successful record',()=>{
 const {dom,$,calls}=setup();try{
 $('#sales_new_customer_name').val('New customer');$('#sales_new_customer_phone').val('9876543210');
 $('#sales_customer_add_new').trigger('click').trigger('click');assert.equal(calls.length,1);
 assert.equal(calls[0].p.url,'customers');assert.equal(JSON.parse(calls[0].p.data).name,'New customer');
 calls[0].fail({responseJSON:{message:'Phone already exists'}});assert.match($('#sales_customer_status').text(),/Phone already exists/);
 assert.equal($('#sales_customer_add_new').prop('disabled'),false);
 $('#sales_customer_add_new').trigger('click');calls[1].ok({type:'success',data:{customer_id:'abc',name:'New customer'}});
 assert.equal(calls[2].id,'abc');assert.equal($('#sales_customer_btn').attr('aria-expanded'),'false');
 }finally{dom.window.close();}
});
test('saving an already linked customer cannot create a duplicate',()=>{
 const {dom,$,calls}=setup();try{
 $('#sales_new_customer_name').val('Existing');$('#sales_new_customer_id').val('abc');$('#sales_customer_add_new').trigger('click');assert.equal(calls.length,0);
 }finally{dom.window.close();}
});
