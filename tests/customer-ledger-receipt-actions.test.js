"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
const source=fs.readFileSync('frontend/static/script/js/modules/js/customers.js','utf8');
const action=source.slice(source.indexOf('PosnicPro.transactiondetails.transactionAction = function'));
for(const language of ['_english','ar'])test('customer ledger actions preserve receipts in '+language,()=>{
 const dict=JSON.parse(fs.readFileSync('languages/'+language+'.json','utf8'));
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=dom.window;
 try{
  w.$=jquery(w);let deleted=[];
  w.PosnicPro={i18n:{t:(key,fallback)=>dict[key]||fallback},transactiondetails:{removeTransactionDetails:id=>deleted.push(id)}};
  w.eval(action);
  const main=w.document.querySelector('main');
  for(const field of ['invoice_id','legacy_invoice_payment_id','books_receipt_id']){
   main.innerHTML=w.PosnicPro.transactiondetails.transactionAction({_id:'receipt',sale_id:'',[field]:'original'});
   assert.equal(main.querySelectorAll('button,a,[onclick]').length,0);
   assert.ok(main.textContent.includes(dict.lang_recorded_payment));
   assert.ok(main.textContent.includes(dict.lang_review_original_payment));
  }
  main.innerHTML=w.PosnicPro.transactiondetails.transactionAction({_id:'allocation',sale_id:'sale'});
  assert.equal(main.querySelectorAll('button,[onclick]').length,0);
  assert.ok(main.querySelector('[aria-label]'));
  const id='manual"<img src=x onerror=alert(1)>';
  main.innerHTML=w.PosnicPro.transactiondetails.transactionAction({_id:id,sale_id:''});
  const button=main.querySelector('button');assert.ok(button);assert.equal(button.type,'button');
  assert.equal(button.dataset.module,'customers');assert.equal(button.dataset.access,'delete');
  assert.equal(main.querySelectorAll('img').length,0);
  w.eval(button.getAttribute('onclick').replace(/^return /,''));assert.deepEqual(deleted,[id]);
 }finally{dom.window.close();}
});
