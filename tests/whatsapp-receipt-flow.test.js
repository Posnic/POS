const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
function setup(){
 const dom=new JSDOM('<form id="sms_form"><button type="submit">Send</button></form><div id="smsModal"></div><input id="customer_sms_fullphone"><textarea id="customer_sms_message"></textarea><select id="whatsapp_receipt_template"><option value=""></option></select>',{runScripts:'outside-only'});
 const w=dom.window;w.eval(fs.readFileSync('frontend/static/script/js/jquery.min.js','utf8'));
 const $=w.$,requests=[],alerts=[];$.fn.modal=function(){return this;};
 w.PosnicPro={sales:{currentSaleId:'sale-1'},i18n:{t:(key,text)=>text},alert:(...x)=>alerts.push(x),post:(...args)=>requests.push(args)};
 const start=source.indexOf('    sendWhatsAppReceipt: function () {');
 const end=source.indexOf('    sendSalesReceipt:',start);
 w.eval('window.sendReceipt = ({'+source.slice(start,end)+'}).sendWhatsAppReceipt;');
 $('#customer_sms_fullphone').val('+919008427482');$('#customer_sms_message').val('TEST receipt');
 return {dom,w,$,requests,alerts};
}
test('receipt retains sale context, blocks repeated clicks and allows another send after completion',()=>{
 const {dom,w,$,requests}=setup();w.sendReceipt();w.sendReceipt();
 assert.equal(requests.length,1);assert.equal(requests[0][0].data.sale_id,'sale-1');assert.equal(requests[0][0].data.phone_number,'919008427482');
 assert.equal($('#sms_form :submit').prop('disabled'),true);
 requests[0][1]({type:'success',message:'Accepted'});
 assert.equal($('#sms_form :submit').prop('disabled'),false);assert.equal(w.PosnicPro.sales.receiptSending,false);
 dom.window.close();
});
test('network failures release controls without automatic resend or throwing on HTML errors',()=>{
 const {dom,w,$,requests,alerts}=setup();w.sendReceipt();requests[0][2]({responseText:'<html>Unavailable</html>'});
 assert.equal(requests.length,1);assert.equal($('#sms_form :submit').prop('disabled'),false);assert.match(alerts[0][1],/history before trying again/);dom.window.close();
});
test('empty receipt cannot be sent',()=>{
 const {dom,w,$,requests}=setup();$('#customer_sms_message').val('');w.sendReceipt();assert.equal(requests.length,0);dom.window.close();
});
test('real sales modal gets a visible WhatsApp message field and SMS switch removes it',()=>{
 const {dom,w,$}=setup();
 const html=fs.readFileSync('frontend/modules/sales_write.html','utf8');
 const start=html.indexOf('<div class="modal fade" id="smsModal"');
 const end=html.indexOf('<!-- Register Selection Modal -->',start);
 $('body').html(html.slice(start,end));
 w.PosnicPro.sales.addTemplateSelectionToModal=()=>{};
 for(const [name,next] of [['showWhatsAppReceipt','    /**'],['showSMS','    showWhatsAppReceipt:']]){
  const a=source.indexOf('    '+name+': function');const b=source.indexOf(next,a+1);
  w.eval('PosnicPro.sales.'+name+' = ({'+source.slice(a,b)+'}).'+name+';');
 }
 w.PosnicPro.sales.showWhatsAppReceipt('sale-1','9008427482','Test');
 assert.equal($('#customer_sms_message').length,1);assert.equal($('#customer_sms_message').attr('rows'),'7');
 assert.equal($('#sms_form').data('message-channel'),'whatsapp');
 w.PosnicPro.sales.showSMS('sale-1','9008427482','Test');
 assert.equal($('#customer_sms_message').length,0);assert.equal($('#sms_form').data('message-channel'),'sms');
 dom.window.close();
});
