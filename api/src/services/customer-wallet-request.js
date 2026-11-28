"use strict";
// Local, explicitly invoked request engine. Not mounted until every customer
// writer participates in the same admission boundary and UI recovery is wired.
const {ObjectId,BSON}=require('mongodb');
const {createHash}=require('node:crypto');
const {canonical}=require('./invoice-payment-effects');
const fail=message=>{throw Object.assign(new Error(message),{code:'wallet_request_conflict'});};
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const exact=row=>({_id:row._id,license:row.license,$expr:{$eq:['$$ROOT',{$literal:row}]}});
function cents(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-7)fail('A valid two-decimal amount is required');
 return BigInt(Math.round(value*100));
}
function balance(rows){const total=rows.reduce((sum,row)=>{if(!['in','out'].includes(row.type))fail('Unsupported ledger entry');return sum+(row.type==='in'?cents(row.amount):-cents(row.amount));},0n);if(total>BigInt(Number.MAX_SAFE_INTEGER)||total< -BigInt(Number.MAX_SAFE_INTEGER))fail('Ledger total is too large');return Number(total)/100;}
function normalize(value){
 if(value?.kind==='remove'&&ObjectId.isValid(value.entryId)&&Object.keys(value).every(key=>['kind','entryId'].includes(key)))return {kind:'remove',entryId:String(value.entryId)};
 if(value?.kind!=='add'||!['in','out'].includes(value.type)||cents(value.amount)<=0n||Object.keys(value).some(key=>!['kind','amount','type','date','description','image'].includes(key)))fail('Invalid wallet request');
 const date=new Date(value.date);if(typeof value.date!=='string'||!Number.isFinite(+date))fail('A valid date is required');
 for(const key of ['description','image'])if(value[key]!=null&&(typeof value[key]!=='string'||value[key].length>2048))fail('Invalid wallet entry details');
 return {kind:'add',amount:value.amount,type:value.type,date:date.toISOString(),description:value.description||'',image:value.image||''};
}
function scope(context){
 for(const key of ['license','branchId','customerId'])if(!ObjectId.isValid(String(context[key])))fail('Invalid wallet scope');
 if(typeof context.actorId!=='string'||!context.actorId)fail('Original cashier is required');
 return {_id:new ObjectId(String(context.customerId)),license:new ObjectId(String(context.license)),branch_id:new ObjectId(String(context.branchId)),is_deleted:{$ne:true}};
}
function identity(id){if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))fail('A valid original request ID is required');}
const sourceHash=customer=>hash(Object.fromEntries(Object.entries(customer).filter(([key])=>!['wallet_entry_lock','wallet_entry_requests'].includes(key))));
function create({db}){
 const customers=db.collection('customers'),ledger=db.collection('transaction');
 const query=context=>scope(context);
 function validateEvidence(customer){
  if(Object.hasOwn(customer,'wallet_entry_requests')){
   const history=customer.wallet_entry_requests;
   if(!Array.isArray(history)||history.length>100)fail('Wallet request history needs review');
   const ids=new Set();for(const item of history){
    if(!item||typeof item!=='object')fail('Wallet request history needs review');identity(item.id);
    if(ids.has(item.id)||typeof item.actorId!=='string'||!item.actorId||item.result?.state!=='saved'||item.result.commandId!==item.id||
       hash(normalize(item.request))!==hash(item.request)||hash(item.result.request)!==hash(item.request)||item.result.kind!==item.request.kind||
       !Number.isFinite(item.result.balance)||!ObjectId.isValid(item.result.entryId))fail('Wallet request history needs review');
    ids.add(item.id);
   }
  }
  if(Object.hasOwn(customer,'wallet_entry_lock')){
   const lock=customer.wallet_entry_lock;
   if(!lock||typeof lock!=='object'||typeof lock.actorId!=='string'||!lock.actorId||!Array.isArray(lock.baseline)||!lock.entry||
      typeof lock.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(lock.sourceHash))fail('Wallet reservation needs review');
   identity(lock.id);if(hash(normalize(lock.request))!==hash(lock.request))fail('Wallet reservation needs review');
   if((customer.wallet_entry_requests||[]).some(item=>item.id===lock.id))fail('Wallet request has conflicting saved states');
  }
 }

 async function rows(context){const key=query(context);const result=await ledger.find({customer_id:key._id,license:key.license}).limit(10001).toArray();if(result.length>10000||BSON.calculateObjectSize({rows:result})>512*1024)fail('Ledger exceeds recovery limit');if(result.some(row=>String(row.branch_id)!==String(key.branch_id)))fail('Cross-branch wallet recovery requires review');balance(result);return result;}
 const ordered=value=>[...value].sort((a,b)=>canonical(a._id).localeCompare(canonical(b._id)));
 function saved(customer,context,id,request){validateEvidence(customer);const found=(customer.wallet_entry_requests||[]).find(item=>item.id===id);if(!found)return null;if(found.actorId!==context.actorId||(request&&hash(found.request)!==hash(request)))fail('Original wallet request differs');return found.result;}
 async function status(context,id){identity(id);const customer=await customers.findOne(query(context));if(!customer)fail('Customer not found');validateEvidence(customer);const result=saved(customer,context,id);if(result)return result;const lock=customer.wallet_entry_lock;if(lock?.id===id){if(lock.actorId!==context.actorId)fail('Only the original cashier can recover this request');return {state:'pending',commandId:id,request:lock.request};}return {state:['wallet_entry_lock','books_receipt_lock','legacy_invoice_payment_lock'].some(key=>Object.hasOwn(customer,key))?'other_pending':'absent',commandId:id};}
 async function submit(context,id,input){
  identity(id);const request=normalize(input),key=query(context);
  for(let attempt=0;attempt<8;attempt++){
   const customer=await customers.findOne(key);if(!customer)fail('Customer not found');validateEvidence(customer);
   const result=saved(customer,context,id,request);if(result)return result;
   if(customer.wallet_entry_lock){const lock=customer.wallet_entry_lock;if(lock.id!==id||lock.actorId!==context.actorId||hash(lock.request)!==hash(request))fail('Another wallet request is unfinished');return resume(context,id);}
   if(Object.hasOwn(customer,'books_receipt_lock')||Object.hasOwn(customer,'legacy_invoice_payment_lock'))fail('Customer has an unfinished receipt');
   if((customer.wallet_entry_requests||[]).length>=100)fail('Wallet request history requires archival before another entry');
   const baseline=await rows(context);if(balance(baseline)!==customer.balance)fail('Customer balance differs from its ledger');
   let entry;
   if(request.kind==='remove'){
    entry=baseline.find(row=>String(row._id)===request.entryId);if(!entry)fail('Original entry not found');
    if(entry.sale_id||['invoice_id','legacy_invoice_payment_id','books_receipt_id'].some(field=>Object.hasOwn(entry,field)))fail('A sale or invoice receipt cannot be removed');
   }else entry={_id:new ObjectId(),license:key.license,branch_id:key.branch_id,customer_id:key._id,customer_name:customer.name||'',sale_id:'',amount:request.amount,type:request.type,pending:0,description:request.description,transaction_image:request.image,date:new Date(request.date),created_date:new Date(),updated_date:new Date()};
   const lock={id,actorId:context.actorId,request,baseline,entry,sourceHash:sourceHash(customer)};
   if(!(await customers.updateOne(exact(customer),{$set:{wallet_entry_lock:lock}})).matchedCount)continue;
   return resume(context,id);
  }
  fail('Customer changed while saving the original request');
 }
 async function resume(context,id){
  identity(id);const key=query(context),customer=await customers.findOne(key);if(!customer)fail('Customer not found');validateEvidence(customer);const completed=saved(customer,context,id);if(completed)return completed;
  const lock=customer.wallet_entry_lock;if(!lock||lock.id!==id||lock.actorId!==context.actorId)fail('Original wallet admission unavailable');
  if(sourceHash(customer)!==lock.sourceHash)fail('Customer changed; keep the original request for review');
  const expected=lock.request.kind==='add'?[...lock.baseline,lock.entry]:lock.baseline.filter(row=>String(row._id)!==String(lock.entry._id));
  let current=await rows(context);const same=(a,b)=>hash(ordered(a))===hash(ordered(b));
  if(!same(current,expected)){
   if(!same(current,lock.baseline))fail('Ledger changed; keep the original request for review');
   if(lock.request.kind==='add'){
    try{await ledger.insertOne(lock.entry);}catch(error){if(error.code!==11000)throw error;const existing=await ledger.findOne({_id:lock.entry._id,license:key.license});if(hash(existing)!==hash(lock.entry))fail('Original wallet entry differs');}
   }else await ledger.deleteOne(exact(lock.entry));
  }
  current=await rows(context);if(!same(current,expected))fail('Ledger changed while applying the original request');
  const result={state:'saved',commandId:id,kind:lock.request.kind,request:lock.request,balance:balance(expected),entryId:String(lock.entry._id)};
  const changed=await customers.updateOne(exact(customer),{$set:{balance:result.balance,updated_date:new Date()},$unset:{wallet_entry_lock:''},$push:{wallet_entry_requests:{id,actorId:lock.actorId,request:lock.request,result}}});
  if(!changed.matchedCount){const latest=await customers.findOne(key);const done=latest&&saved(latest,context,id);if(done)return done;fail('Customer changed before wallet completion; keep the original request');}
  return result;
 }
 return {submit,resume,status};
}
module.exports={create};
