const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');const {JSDOM}=require('jsdom'),jquery=require('jquery');
test('state selection previews IGST, local split, delivery override and zero-tax exemption',()=>{
 const dom=new JSDOM(fs.readFileSync('frontend/modules/sales_write.html','utf8'),{runScripts:'outside-only'});const w=dom.window,$=jquery(w);w.$=$;w.PosnicPro={sales:{},local:{get:k=>({gst_action:'enable',state_setting:'Goa',currencySign:'₹'})[k]}};
 try {const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');const a=source.indexOf('PosnicPro.sales.customerGstStates =');const b=source.indexOf("$('#sales_customer_state_select, #sales_place_of_supply_select, #sales_new_customer_gst_number').on",a);w.eval(source.slice(a,b));w.PosnicPro.sales.customerGstStates=[{id:'30',value:'Goa'},{id:'29',value:'Karnataka'}];
 $('#sales_new_customer_state').val('Karnataka');w.PosnicPro.sales.updateCustomerGst(18);assert.match($('#sales_gst_breakdown').text(),/IGST ₹18.00/);
 $('#sales_place_of_supply').val('Goa');w.PosnicPro.sales.updateCustomerGst(18);assert.match($('#sales_gst_breakdown').text(),/CGST ₹9.00 \+ SGST ₹9.00/);
 w.PosnicPro.sales.updateCustomerGst(0);assert.equal($('#sales_gst_breakdown').text(),'');
 $('#sales_new_customer_gst_number').val('30ABCDE1234F1Z5');w.PosnicPro.sales.updateCustomerGst();assert.match(w.document.getElementById('sales_new_customer_gst_number').validationMessage,/do not match/);
 }finally{dom.window.close()}
});
