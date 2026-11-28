"use strict";
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createCustomerWalletRecovery=factory;})(globalThis,function({container,scope,store,request,currentScope,language=()=> 'en',onSaved=()=>{}}){
 const doc=container.ownerDocument;let record=null,busy=false,state='unknown',closed=false;
 const scoped=JSON.stringify(scope),current=()=>!closed&&container.isConnected&&JSON.stringify(currentScope())===scoped;
 const t=(en,ar)=>language()==='ar'?ar:en;
 const sameRequest=()=>{const held=store.load(scope);if(!held||held.commandId!==record.commandId||JSON.stringify(held.request)!==JSON.stringify(record.request))throw new Error('Original request changed');};
 function element(tag,text){const node=doc.createElement(tag);node.textContent=text;return node;}
 function render(){
  if(!current())return;container.replaceChildren();container.dir=language()==='ar'?'rtl':'ltr';
  container.append(element('h3',t('Check this wallet entry','التحقق من حركة المحفظة')));
  if(record){container.append(element('p',record.request.kind==='add'?t('Original amount: ','المبلغ الأصلي: ')+record.request.amount:t('Original entry: ','الحركة الأصلية: ')+record.request.entryId));}
  const messages={unknown:t('Check the saved result before trying again.','تحقق من النتيجة المحفوظة قبل إعادة المحاولة.'),pending:t('The original request is unfinished. Continue with its saved details.','الطلب الأصلي غير مكتمل. تابع باستخدام تفاصيله المحفوظة.'),absent:t('The server has not received this request. Retry the original details.','لم يستلم الخادم هذا الطلب. أعد المحاولة بالتفاصيل الأصلية.'),saved:t('The original request is complete. Refresh the ledger to see the current balance.','اكتمل الطلب الأصلي. حدّث السجل لعرض الرصيد الحالي.'),held:t('The result could not be confirmed. Keep the original request and check again.','تعذر تأكيد النتيجة. احتفظ بالطلب الأصلي وأعد التحقق.'),storage:t('The saved request needs review. No new entry was sent.','يحتاج الطلب المحفوظ إلى مراجعة. لم يتم إرسال حركة جديدة.'),empty:t('No unfinished wallet request is saved on this browser.','لا يوجد طلب محفظة غير مكتمل محفوظ في هذا المتصفح.')};
  const status=element('p',busy?t('Checking the original request…','جارٍ التحقق من الطلب الأصلي…'):messages[state]);status.setAttribute('role','status');container.append(status);
  function button(label,action,name){const node=element('button',label);node.type='button';node.disabled=busy;node.dataset.action=name;node.className='btn btn-sm btn-light border mr-2';node.onclick=action;container.append(node);}
  if(record&&state!=='saved'&&state!=='storage'){
   button(t('Check saved result','التحقق من النتيجة المحفوظة'),()=>check(),'check');
   if(['pending','absent'].includes(state))button(state==='pending'?t('Finish original request','إكمال الطلب الأصلي'):t('Retry original request','إعادة محاولة الطلب الأصلي'),()=>perform(state==='pending'?'recover':'submit'),'continue');
  }
 }
 async function receive(response){
  if(!current())return;const result=response?.type==='success'&&response.data;
  if(!result||result.commandId!==record.commandId){state='held';return;}
  if(result.state==='saved'){
   await store.complete(scope,record.commandId,result);if(!current())return;state='saved';onSaved(result);return;
  }
  if(result.state==='pending'&&JSON.stringify(result.request)!==JSON.stringify(record.request)){state='held';return;}
  state=['pending','absent'].includes(result.state)?result.state:'held';
 }
 async function perform(action){
  if(!current()||busy||!record)return;
  try{sameRequest();}catch{state='storage';render();return;}
  busy=true;render();
  const base='customers/'+encodeURIComponent(scope.customerId)+'/wallet-requests/'+record.commandId;
  try{const response=await request(action==='status'?'GET':'POST',base+(action==='recover'?'/recover':''),action==='status'?undefined:action==='recover'?{confirmed:true}:{confirmed:true,request:record.request});await receive(response);}
  catch{if(current())state='held';}finally{busy=false;render();}
 }
 const check=()=>perform('status');
 return {
  reopen(){if(!current())return;try{record=store.load(scope);state=record?'unknown':'empty';}catch{state='storage';}render();},
  async submit(input){
   if(!current()||busy)return;
   busy=true;
   try{const prepared=await store.prepare(scope,input);if(!current())return;record=prepared.record;state='unknown';busy=false;render();if(prepared.created)await perform('submit');}
   catch{if(current()){state='storage';render();}}finally{busy=false;render();}
  },
  check,
  close(){closed=true;container.replaceChildren();}
 };
});
