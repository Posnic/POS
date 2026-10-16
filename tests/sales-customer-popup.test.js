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
test('customer name stays beside item search and details opens separately',()=>{
 const {dom,w,$}=setup();try{
 w.PosnicPro.sales.updateCustomerGst=()=>{};
 assert.equal($('#sales_new_customer_name').closest('.sales-search-toolbar').length,1);
 assert.equal($('#sales_customer_popup #sales_new_customer_name').length,0);
 $('#sales_new_customer_name').val('Prasad').trigger('input');
 assert.equal($('#sales_customer_search').prop('hidden'),false);
 $('#sales_customer_btn').trigger('click');
 assert.equal($('#sales_customer_btn').attr('aria-expanded'),'true');
 assert.equal($('#sales_customer_search').prop('hidden'),true);
 assert.equal(w.document.activeElement.id,'sales_new_customer_phone');
 $('#sales_new_customer_phone').trigger($.Event('keydown',{key:'Escape'}));
 assert.equal($('#sales_customer_btn').attr('aria-expanded'),'false');
 }finally{dom.window.close();}
});
test('entering optional new customer details performs no write before sale save',()=>{
 const {dom,w,$,calls}=setup();try{
 w.PosnicPro.sales.updateCustomerGst=()=>{};
 $('#sales_new_customer_name').val('New customer');$('#sales_customer_add_new').trigger('click');
 $('#sales_new_customer_phone').val('9876543210');$('#sales_customer_done').trigger('click');
 assert.equal(calls.length,0);assert.equal($('#sales_new_customer_name').val(),'New customer');
 assert.equal($('#sales_new_customer_phone').val(),'9876543210');
 assert.equal($('#sales_customer_btn').attr('aria-expanded'),'false');
 }finally{dom.window.close();}
});
