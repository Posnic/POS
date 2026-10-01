const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {create}=require('../frontend/static/script/js/modules/js/order-journal');
const source=fs.readFileSync('frontend/static/script/js/modules/js/order-recovery.js','utf8');
function app(header=false){
 const dom=new JSDOM('<div id="sales_new"><h4 class="page-title">Sale</h4></div>',{url:'https://shop.test',runScripts:'outside-only'});
 const w=dom.window;if(header)w.document.querySelector('#sales_new').insertAdjacentHTML('beforeend','<div id="sale-header-actions"><button id="billing_outlets_open">Billing outlets</button></div>');w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const scope={server:'shop',branch:'branch',user:'staff'};
 const journal=create(w.localStorage,()=>scope);
 const entry=journal.save({idempotencyKey:'request-1',table_number:'T1',sales_total:200,items:[{item_name:'<img src=x onerror=alert(1)>',item_quantity:2,item_note:'no salt'}]});
 const calls=[],alerts=[];
 w.PosnicPro={sales:{submissionJournal:()=>journal,guardDiscountApproval:(params,proceed)=>proceed()},alert:(...args)=>alerts.push(args),post:(...args)=>calls.push(args)};
 w.$=fn=>fn();w.eval(source);
 return {dom,w,scope,journal,entry,calls,alerts,recovery:w.PosnicPro.orderRecovery};
}
test('review renders stored values as text and retries the exact payload only once',()=>{
 const a=app();a.recovery.show();
 assert.equal(a.w.document.querySelectorAll('img').length,0);
 assert.match(a.w.document.querySelector('dialog').textContent,/no salt/);
 a.recovery.retry(a.entry);a.recovery.retry(a.entry);
 assert.equal(a.calls.length,1);assert.deepEqual(JSON.parse(a.calls[0][0].data),a.entry.payload);
 a.calls[0][1]({type:'success',data:{_id:'sale-1'}});
 assert.equal(a.journal.pending().length,0);assert.equal(a.w.document.querySelector('#desktop-pending-orders').hidden,true);
 a.dom.window.close();
});
test('failed retry leaves the original record available for another attempt',()=>{
 const a=app();a.recovery.retry(a.entry);a.calls[0][2]();
 assert.equal(a.journal.pending().length,1);a.recovery.retry(a.entry);assert.equal(a.calls.length,2);a.dom.window.close();
});

test('confirmed no-write rejection releases pending retry and preserves its rejected payload',()=>{
 const a=app();let resets=0;a.w.PosnicPro.sales.resetOrderRequest=()=>{resets++;};
 a.recovery.show();a.recovery.retry(a.entry);
 a.calls[0][2]({responseJSON:{type:'error',data:{submission_outcome:'not_saved',request_id:a.entry.id}}});
 assert.equal(a.journal.pending().length,0);assert.equal(resets,1);
 assert.match(a.w.document.querySelector('dialog').textContent,/No pending submissions/);
 a.dom.window.close();
});
test('account change while manager approval is open prevents submission',()=>{
 const a=app();let approval;
 a.w.PosnicPro.sales.guardDiscountApproval=(params,proceed)=>{approval=proceed;};
 a.recovery.retry(a.entry);a.scope.user='other';approval();
 assert.equal(a.calls.length,0);a.scope.user='staff';assert.equal(a.journal.pending().length,1);a.dom.window.close();
});
test('normal sale submission in flight cannot be resent from recovery',()=>{
 const a=app();a.w.PosnicPro.sales.submissionInProgress=true;a.recovery.retry(a.entry);assert.equal(a.calls.length,0);a.dom.window.close();
});

test('recovery uses localized labels and readable inherited headings in RTL',()=>{
 const a=app();a.w.document.documentElement.dir='rtl';
 a.w.PosnicPro.i18n={t:(key,fallback)=>key==='lang_pending_submissions'?'طلبات معلقة':fallback};
 a.recovery.show();const dialog=a.w.document.querySelector('dialog');
 assert.equal(dialog.dir,'rtl');assert.equal(dialog.querySelector('h4').textContent,'طلبات معلقة');
 assert.equal(dialog.querySelector('h4').style.color,'inherit');
 assert.equal(dialog.querySelector('button').style.minHeight,'44px');a.dom.window.close();
});

test('pending recovery sits before Billing outlets outside the sale heading',()=>{
 const a=app(true);const parent=a.w.document.getElementById('sale-header-actions');
 assert.deepEqual([...parent.children].map(x=>x.id),['desktop-pending-orders','billing_outlets_open']);
 assert.equal(a.w.document.querySelector('.page-title button'),null);
 a.dom.window.close();
});
