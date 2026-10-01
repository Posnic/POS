'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(status='cancelled') {
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[];w.PosnicPro={i18n:{t:(_k,v)=>v},request:p=>calls.push(p)};
 const source=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core/ajax.js'),'utf8');
 w.eval(source.slice(source.indexOf('PosnicPro.retryOrderApproval =')));
 w.PosnicPro.retryOrderApproval({url:'sales/order',data:JSON.stringify({order_id:'order-1',status,items:[]})},()=>{},()=>{},{message:'Enter a reason for this change.'});
 return {dom,w,calls};
}
test('cancellation reasons require an explicit submit and retain the original order payload',()=>{
 const {dom,w,calls}=setup();
 const buttons=[...w.document.querySelectorAll('button')];
 buttons.find(b=>b.textContent==='Duplicate order').click();assert.equal(calls.length,0);
 buttons.find(b=>b.textContent==='Cancel order').click();assert.equal(calls.length,1);
 assert.equal(JSON.parse(calls[0].data).change_reason,'Duplicate order');assert.equal(JSON.parse(calls[0].data).order_id,'order-1');
 assert.equal(w.document.querySelector('dialog'),null);dom.window.close();
});
test('custom reasons are supported and going back never changes the order',()=>{
 const {dom,w,calls}=setup();const input=w.document.querySelector('textarea');input.value='  Guest left before preparation  ';
 w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(JSON.parse(calls[0].data).change_reason,'Guest left before preparation');dom.window.close();
 const other=setup();[...other.w.document.querySelectorAll('button')].find(b=>b.textContent==='Go back').click();assert.equal(other.calls.length,0);other.dom.window.close();
});
test('non-cancellation changes are not presented as cancelling the whole order',()=>{
 const {dom,w,calls}=setup('pending');assert.match(w.document.querySelector('h2').textContent,/Reason for this change/);
 const form=w.document.querySelector('form');w.document.querySelector('textarea').value='  ';form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(calls.length,0);dom.window.close();
});
