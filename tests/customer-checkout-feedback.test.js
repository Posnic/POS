const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const sales=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
const settings=fs.readFileSync('frontend/static/script/js/modules/js/settings.js','utf8');
function env(html='') {
 const dom=new JSDOM(html,{runScripts:'outside-only'});const w=dom.window;w.$=jquery(w);
 w.PosnicPro={sales:{},i18n:{t:(k,f)=>f},local:{get:()=> 'EGP'},get:()=>{},post:()=>{},alert:()=>{}};
 return {dom,w,$:w.$};
}
test('previous account balance shows signed ledger values, does not overwrite tender, and ignores stale customer replies',()=>{
 const {dom,w,$}=env('<input id="sales_new_customer_id"><input id="Partial_amount" value="175"><div class="sale-customer-account"></div><div class="sale-customer-account"></div>');
 try {
  const a=sales.indexOf('PosnicPro.sales.refreshCustomerAccount =');
  w.eval(sales.slice(a,sales.indexOf('PosnicPro.sales.applyCustomerPick =',a)));
  const calls=[];w.PosnicPro.get=(p,ok,fail)=>calls.push({p,ok,fail});
  const first='a'.repeat(24),second='b'.repeat(24);
  $('#sales_new_customer_id').val(first);w.PosnicPro.sales.refreshCustomerAccount();
  $('#sales_new_customer_id').val(second);w.PosnicPro.sales.refreshCustomerAccount();
  calls[0].ok({type:'success',data:{pending:100,wallet:0}});
  assert.doesNotMatch($('.sale-customer-account').text(),/100/);
  calls[1].ok({type:'success',data:{pending:-5,wallet:0}});
  assert.match($('.sale-customer-account').first().text(),/EGP -5.00/);
  assert.equal($('.sale-customer-account a').first().attr('href'),'#/customers/'+second);
  assert.equal($('#Partial_amount').val(),'175');
  w.PosnicPro.sales.refreshCustomerAccount();calls[2].fail();
  assert.match($('.sale-customer-account').text(),/unavailable/);
 } finally {dom.window.close();}
});
test('disabled customer credit skips the ledger request and rejects late replies after a toggle or branch change',()=>{
 const {dom,w,$}=env('<input id="sales_new_customer_id"><div class="sale-customer-account">old balance</div>');
 try {
  let enabled=false,branch='one';const calls=[];
  w.PosnicPro.local.get=k=>k==='general_settings'?JSON.stringify({module_credit_enable:enabled}):k==='branch_id_set'?branch:'GBP';
  w.PosnicPro.get=(p,ok,fail)=>calls.push({ok,fail});
  const a=sales.indexOf('PosnicPro.sales.refreshCustomerAccount =');
  w.eval(sales.slice(a,sales.indexOf('PosnicPro.sales.applyCustomerPick =',a)));
  $('#sales_new_customer_id').val('a'.repeat(24));
  w.PosnicPro.sales.refreshCustomerAccount();
  assert.equal(calls.length,0);assert.equal($('.sale-customer-account').css('display'),'none');
  enabled=true;w.PosnicPro.sales.refreshCustomerAccount();
  enabled=false;w.PosnicPro.sales.refreshCustomerAccount();
  calls[0].ok({type:'success',data:{pending:99,wallet:0}});calls[0].fail();
  assert.equal($('.sale-customer-account').css('display'),'none');assert.equal($('.sale-customer-account').text(),'');
  enabled=true;w.PosnicPro.sales.refreshCustomerAccount();branch='two';
  calls[1].ok({type:'success',data:{pending:88,wallet:0}});
  assert.doesNotMatch($('.sale-customer-account').text(),/88/);
 } finally {dom.window.close();}
});

test('missing product discounts render zero and valid percentage/amount discounts remain intact',()=>{
 const {dom,w}=env();
 try {
  const a=sales.indexOf('        // Imported/catalogue products');
  const b=sales.indexOf('        /*',a);
  for(const [fields,display,discount] of [[{},'0%',0],[{discount_percentage:'10'},'10%',2],[{discount_amount:'3'},'EGP3',3]]) {
   w.params={selling_price:20,...fields};w.eval(sales.slice(a,b));
   assert.equal(w.discountDisplay,display);assert.equal(w.Discount,discount);
  }
 } finally {dom.window.close();}
});

test('cart quantity counts units rather than lines and handles fractional quantities',()=>{
 const {dom,w,$}=env('<span class="sale-cart-quantity"></span><span class="sale-cart-lines"></span>');
 try {
  const a=sales.indexOf('        var cartQuantity =');const b=sales.indexOf('        var addSalesSubTotal',a);
  w.PosnicPro.sales.addLineTable=[{item_quantity:1},{item_quantity:1},{item_quantity:3}];w.eval(sales.slice(a,b));
  assert.equal($('.sale-cart-quantity').text(),'5');assert.equal($('.sale-cart-lines').text(),'3');
  w.PosnicPro.sales.addLineTable=[{item_quantity:0.1},{item_quantity:0.2}];w.eval(sales.slice(a,b));assert.equal($('.sale-cart-quantity').text(),'0.3');
  w.PosnicPro.sales.addLineTable=[];w.eval(sales.slice(a,b));assert.equal($('.sale-cart-quantity').text(),'0');
 } finally {dom.window.close();}
});
test('price list uses explicit item selection, clears stale IDs and refuses unresolved or duplicate rows',()=>{
 const {dom,w,$}=env();
 try {
  $.fn.modal=function(){return this;};let options;
  $.fn.autocomplete=function(o){options=o;return this;};
  const alerts=[],requests=[];w.PosnicPro.alert=(...a)=>alerts.push(a);w.PosnicPro.post=(p)=>requests.push(p);
  const a=settings.indexOf('PosnicPro.pricelists =');w.eval(settings.slice(a,settings.indexOf("$(document).on('click', '.pl-edit-btn'",a)));
  w.PosnicPro.pricelists.openEditor();$('#pl_ov_add').trigger('click');
  const input=$('.pl-ov-name');input.trigger('focus');input.val('Arabic item').trigger('input');$('.pl-ov-price').val('20');
  w.PosnicPro.pricelists.save();assert.equal(requests.length,0);assert.equal(alerts.length,1);
  let search;w.PosnicPro.get=(p,ok)=>{search=p;ok({suggestions:[{item_id:'real-id',item_name:'Arabic item'}]});};
  options.lookup('شاي & coffee',r=>assert.equal(r.suggestions.length,1));
  assert.match(search.url,/getOnlineItemsAjaxList/);assert.ok(search.data.includes(encodeURIComponent('شاي & coffee')));
  options.onSelect({value:'Arabic item',data:{item_id:'real-id'}});w.PosnicPro.pricelists.save();
  assert.equal(JSON.parse(requests[0].data).item_overrides[0].item_id,'real-id');
  input.val('Different item').trigger('input');w.PosnicPro.pricelists.save();assert.equal(requests.length,1);
  options.onSelect({value:'Arabic item',data:{item_id:'real-id'}});$('#pl_edit_overrides').append($('.pl-ov-row').clone(true));
  w.PosnicPro.pricelists.save();assert.equal(requests.length,1);
 } finally {dom.window.close();}
});
