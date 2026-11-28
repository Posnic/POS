"use strict";
// Explicit installer: not loaded by pages_css_js_map until writer acceptance.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.installCustomerWalletPage=factory;})(globalThis,function({P,$,document,store,createRecovery}){
 const original={show:P.customers.showTransaction,submit:P.customers.transaction,remove:P.transactiondetails.removeTransactionDetails};
 let view=null,active=null,target=null,sequence=0,removal=null;
 const id=value=>String(value?.$oid||value||'');
 const user=()=>id(P.local.get('userid'));
 const branch=()=>id(P.local.get('branch_id'));
 const t=(en,ar)=>document.documentElement.lang==='ar'?ar:en;
 const current=()=>active&&target===active.customerId&&id(P.record_id)===target&&user()===active.userId&&branch()===active.branchId?active:null;
 const controls=()=>$('#transaction_add_list_form').find('input:not([type=hidden]),select,textarea,button[type=submit]');
 function message(){P.alert('error',t('The original wallet request needs review. No new entry was sent.','يحتاج طلب المحفظة الأصلي إلى مراجعة. لم يتم إرسال حركة جديدة.'));}
 const get=url=>new Promise((resolve,reject)=>P.get(url,resolve,reject));
 const request=(method,url,body)=>new Promise((resolve,reject)=>{
  if(method==='GET')P.get({url,data:{}},resolve,reject);
  else P.request({method,url,data:JSON.stringify(body)},resolve,reject);
 });
 async function open(customerId,action){
  const ticket=++sequence;target=id(customerId);active=null;view?.close();view=null;controls().prop('disabled',true);
  const actor=user(),selectedBranch=branch();
  try{
   const response=await get('customers/'+encodeURIComponent(target));
   if(ticket!==sequence||user()!==actor||branch()!==selectedBranch)return;
   if(response?.type!=='success'||id(response.data?._id)!==target||id(response.data?.branch_id)!==selectedBranch)throw Error('Customer unavailable');
   active={licenseId:id(response.data.license),branchId:id(response.data.branch_id),userId:actor,customerId:target};
   const scope={...active},held=store.load(scope);
   let container=document.getElementById('customer_wallet_recovery');
   if(!container){container=document.createElement('section');container.id='customer_wallet_recovery';container.className='border rounded p-3 mt-2';document.getElementById('transaction_add_list_form').append(container);}
   view=createRecovery({container,scope,store,request,currentScope:current,language:()=>document.documentElement.lang,onSaved:async()=>{
    if(JSON.stringify(current())!==JSON.stringify(scope))return;
    controls().prop('disabled',false);document.getElementById('transaction_add_list_form').reset();$('#customerTransaction_id').val(scope.customerId);
    // Fetch the current balance: a recovered saved result may be historical.
    try{const fresh=await get('customers/'+scope.customerId);if(JSON.stringify(current())!==JSON.stringify(scope))return;
     if(fresh?.type==='success')$('#customer_current_balance').val(fresh.data.balance);
     P.transactiondetails.transactiondetailsTable();
    }catch{P.alert('error',t('The request is saved. Refresh the customer ledger to see its current balance.','تم حفظ الطلب. حدّث سجل العميل لعرض رصيده الحالي.'));}
   }});
   view.reopen();controls().prop('disabled',!!held);
   if(held&&held.request.kind==='add'){
    $('#transaction_amount').val(held.request.amount);$('#transaction_type').val(held.request.type);$('#transaction_notes').val(held.request.description);
   }
   if(action){controls().prop('disabled',true);await view.submit(action);}
  }catch{if(ticket===sequence){controls().prop('disabled',true);message();}}
 }
 P.customers.showTransaction=function(customerId){original.show.call(this,customerId);return open(customerId);};
 P.customers.transaction=function(){
  if(!view||!current()||id($('#customerTransaction_id').val())!==active.customerId){message();return false;}
  const data=P.getFormData($('#transaction_add_list_form'));
  controls().prop('disabled',true);
  return view.submit({kind:'add',amount:data.amount,type:data.type,date:data.date,description:data.description||'',image:data.transaction_image||''}).finally(()=>{try{if(current()&&!store.load(active))controls().prop('disabled',false);}catch{}});
 };
 P.transactiondetails.removeTransactionDetails=function(entryId){
  const customerId=id(P.record_id);
  if(!this.deleteConfirmation){removal={entryId:id(entryId),customerId,actor:user()};return original.remove.call(this,entryId);}
  this.deleteConfirmation=false;
  if(!removal||removal.entryId!==id(entryId)||removal.customerId!==customerId||removal.actor!==user()){message();return false;}
  removal=null;original.show.call(P.customers,customerId);return open(customerId,{kind:'remove',entryId:id(entryId)});
 };
 return {close(){sequence++;active=null;target=null;view?.close();view=null;},uninstall(){this.close();P.customers.showTransaction=original.show;P.customers.transaction=original.submit;P.transactiondetails.removeTransactionDetails=original.remove;}};
});
