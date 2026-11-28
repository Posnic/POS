'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createCustomerWalletSettlementRecovery=factory;})(globalThis,function({container,scope,store,request,currentScope,language=()=> 'en',onComplete=()=>{},onRefresh=()=>{},saleLabels={}}){
 const doc=container.ownerDocument,scoped=JSON.stringify(scope);let record=null,state='unknown',busy=false,closed=false,confirming=false,balance;
 const current=()=>!closed&&container.isConnected&&JSON.stringify(currentScope())===scoped;
 const t=(en,ar)=>language()==='ar'?ar:en;
 const sameRequest=()=>{const original=store.load(scope);if(!original||original.commandId!==record.commandId||JSON.stringify(original.request)!==JSON.stringify(record.request))throw Error('Original selection changed');};
 function element(tag,text){const node=doc.createElement(tag);node.textContent=text;return node;}
 function render(){
  if(!current())return;container.replaceChildren();container.dir=language()==='ar'?'rtl':'ltr';
  container.append(element('h3',t('Finish this settlement','إكمال هذه التسوية')));
  if(record){const list=element('ul','');for(const sale of record.request.sales){const row=element('li',''),name=element('bdi',saleLabels[sale.id]||sale.id);name.style.overflowWrap='anywhere';row.append(name,element('span',t(' · From wallet: ',' · من المحفظة: ')),element('bdi',String(sale.amount)),element('span',t(' · Previously paid: ',' · المدفوع سابقاً: ')),element('bdi',String(sale.paidamount)));list.append(row);}container.append(list);}
  const messages={unknown:t('Check the saved result before trying again.','تحقق من النتيجة المحفوظة قبل إعادة المحاولة.'),prepared:t('The request is saved. Continue, or stop before reservation begins.','تم حفظ الطلب. تابع أو أوقفه قبل بدء الحجز.'),reserving:t('Reservation has started. Continue the original request; it cannot be replaced.','بدأ الحجز. تابع الطلب الأصلي؛ لا يمكن استبداله.'),applying:t('Some updates may already be saved. Finish with the original sales and amounts.','قد تكون بعض التحديثات قد حُفظت. أكمل بالمبيعات والمبالغ الأصلية.'),absent:t('The server has not received this request. Retry its original details.','لم يستلم الخادم هذا الطلب. أعد المحاولة بالتفاصيل الأصلية.'),saved:t('Settlement complete. Refresh the ledger to see later activity.','اكتملت التسوية. حدّث السجل للاطلاع على الحركات اللاحقة.'),stopped:t('Request stopped. Refresh the ledger before selecting sales again.','تم إيقاف الطلب. حدّث السجل قبل تحديد المبيعات مرة أخرى.'),held:t('The result could not be confirmed. Keep this request and check again.','تعذر تأكيد النتيجة. احتفظ بهذا الطلب وأعد التحقق.'),storage:t('The saved request needs review. No replacement was sent.','يحتاج الطلب المحفوظ إلى مراجعة. لم يتم إرسال طلب بديل.'),empty:t('No unfinished settlement is saved in this browser.','لا توجد تسوية غير مكتملة محفوظة في هذا المتصفح.')};
  const status=element('p',busy?t('Checking the original settlement…','جارٍ التحقق من التسوية الأصلية…'):messages[state]);status.setAttribute('role','status');status.setAttribute('aria-live','polite');container.append(status);
  if(state==='saved')container.append(element('p',t('Wallet balance after this request: ','رصيد المحفظة بعد هذا الطلب: ')+String(balance)));
  function button(label,action,name){const node=element('button',label);node.type='button';node.disabled=busy;node.dataset.action=name;node.className='btn btn-sm btn-light border mr-2';node.onclick=action;container.append(node);return node;}
  if(confirming){
   container.append(element('p',t('Stop before it starts? We will check again. If reservation has started, the original request must continue.','هل تريد الإيقاف قبل البدء؟ سنتحقق مجدداً. إذا بدأ الحجز، يجب متابعة الطلب الأصلي.')));
   button(t('Confirm stop','تأكيد الإيقاف'),()=>perform('stop'),'confirm-stop');button(t('Keep this request','الاحتفاظ بهذا الطلب'),()=>{confirming=false;render();},'keep');
  }else if(record&&!['saved','stopped','storage'].includes(state)){
   button(t('Check saved result','التحقق من النتيجة المحفوظة'),()=>perform('status'),'check');
   if(['prepared','reserving','applying','absent'].includes(state))button(state==='absent'?t('Retry original request','إعادة محاولة الطلب الأصلي'):t('Continue original settlement','متابعة التسوية الأصلية'),()=>perform(state==='absent'?'submit':'recover'),'continue');
   if(state==='prepared')button(t('Stop this request','إيقاف هذا الطلب'),()=>{if(!current()||busy||state!=='prepared')return;confirming=true;render();container.querySelector('[data-action=confirm-stop]')?.focus();},'stop');
  }
  if(['saved','stopped'].includes(state))button(t('Refresh customer ledger','تحديث سجل العميل'),()=>{if(current()&&!busy)onRefresh();},'refresh');
 }
 async function receive(response){
  if(!current())return;sameRequest();const result=response?.type==='success'&&response.data;
  if(!result||result.commandId!==record.commandId){state='held';return;}
  if(['saved','stopped'].includes(result.state)){
   await store.complete(scope,record.commandId,result);if(!current())return;state=result.state;balance=result.balance;onComplete(result);return;
  }
  if(result.state==='pending'){
   if(JSON.stringify(result.request)!==JSON.stringify(record.request)||!['prepared','reserving','applying'].includes(result.phase)){state='held';return;}
   state=result.phase;return;
  }
  state=result.state==='absent'?'absent':'held';
 }
 async function perform(action){
  if(!current()||busy||!record)return;
  if(action==='stop'&&(!confirming||state!=='prepared'))return;
  if(action==='recover'&&!['prepared','reserving','applying'].includes(state))return;
  if(action==='submit'&&!['new','absent'].includes(state))return;
  try{sameRequest();}catch{state='storage';confirming=false;render();return;}
  busy=true;render();const base='customers/'+encodeURIComponent(scope.customerId)+'/wallet-settlements/'+record.commandId;
  try{const response=await request(action==='status'?'GET':'POST',base+(['recover','stop'].includes(action)?'/'+action:''),action==='status'?undefined:action==='submit'?{confirmed:true,request:record.request}:{confirmed:true});await receive(response);}
  catch{if(current())state='held';}finally{busy=false;confirming=false;render();}
 }
 return {
  reopen(){if(!current()||busy)return;confirming=false;try{record=store.load(scope);state=record?'unknown':'empty';}catch{state='storage';}render();},
  async submit(input){if(!current()||busy)return;busy=true;try{const prepared=await store.prepare(scope,input);if(!current())return;record=prepared.record;state=prepared.created?'new':'unknown';busy=false;if(prepared.created)await perform('submit');else render();}catch{if(current())state='storage';}finally{busy=false;render();}},
  check:()=>perform('status'),
  close(){closed=true;container.replaceChildren();}
 };
});
