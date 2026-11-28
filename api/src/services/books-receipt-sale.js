'use strict';
const {ObjectId,BSON}=require('mongodb');
const {createHash}=require('node:crypto');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const digest=sale=>{const {books_receipt_lock,...original}=sale;return createHash('sha256').update(JSON.stringify(ordered(BSON.EJSON.serialize(original,{relaxed:false})))).digest('hex');};
const source=require('../v1/accounting-source');
const journalModule=require('./books-receipt-journal');
const fail=message=>{throw Object.assign(new Error(message),{code:'books_receipt_sale_conflict',status:409});};
const unreserved=()=>({books_receipt_lock:{$exists:false}});
function competing(sale){if(sale.payment_correction_pending||sale.return_refund_lock||new Date(sale.captain_edit_until||0).getTime()>=Date.now())fail('Sale has another payment or edit in progress');}
function mutable(sale){if(Object.hasOwn(sale,'books_receipt_lock'))fail('Sale has an unfinished receipt');}
function minor(value){
 if(!['string','number'].includes(typeof value)||! /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(value)))fail('Invalid original payment amount');
 const [whole,fraction='']=String(value).split('.');const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(result>BigInt(Number.MAX_SAFE_INTEGER))fail('Payment amount exceeds supported precision');return result;
}
function money(value){const result=Number(value)/100;if(minor(result)!==BigInt(value))fail('Payment amount exceeds stored precision');return result;}
function native(id){if(!id||!['string','objectId'].includes(id.kind)||typeof id.value!=='string'||(id.kind==='objectId'&&!/^[a-f0-9]{24}$/.test(id.value)))fail('Invalid source identity');source.identity(id.kind==='objectId'?new ObjectId(id.value):id.value);return id.kind==='objectId'?new ObjectId(id.value):id.value;}
function create({db,now}){
 const sales=db.collection('sales'),journal=journalModule.create({db,now});
 const exported=sale=>source.exportSale(sale,String(sale.license));
 const query=(context,id)=>({_id:native(id),license:context.license,branch_id:context.branchId});
 // BSON/string branch compatibility is explicit; tenant license type remains exact.
 async function load(context,id){
  const q=query(context,id);if(/^[a-f0-9]{24}$/.test(String(context.branchId)))q.branch_id={$in:[context.branchId,new ObjectId(context.branchId)]};
  const sale=await sales.findOne(q);if(!sale)fail('Original sale unavailable');return sale;
 }
 const exact=sale=>({_id:sale._id,$expr:{$eq:['$$ROOT',{$literal:sale}]}});
 const sameLock=(lock,state)=>lock&&lock.journalId===state.review.journalId&&lock.commandId===state.commandId&&lock.reviewHash===state.review.reviewHash;
 async function current(context,id,commandId){
  const state=await journal.outcome(context,id,commandId);
  if(state.review.values.actor.id!==context.actorId)fail('Use the original payment actor');
  const sale=await load(context,state.review.values.basis.sourceId);return {state,sale};
 }
 async function releaseStopped(context,id,commandId){
  const {state,sale}=await current(context,id,commandId);
  if(state.state!=='stopped')fail('Only stopped unaccepted receipts can release a sale');
  if(!sale.books_receipt_lock)return;
  if(!sameLock(sale.books_receipt_lock,state)||sale.books_receipt_lock.appliedRevision)fail('Receipt reservation changed');
  await sales.updateOne({...exact(sale)},{$unset:{books_receipt_lock:''}});
  const after=await load(context,state.review.values.basis.sourceId);
  if(sameLock(after.books_receipt_lock,state))fail('Sale changed during reservation release; retry recovery');
 }
 return {
  async prepare(context,id,invoiceId,input){
   const sale=await load(context,id);competing(sale);
   if(String(sale.source_invoice_id)!==invoiceId||!['Add','Edit'].includes(sale.sale_process))fail('Original invoice sale unavailable');
   if(sale.currencyCode!=='AED'||sale.currencyDigits!==2)fail('Original AED currency evidence required');
   const record=exported(sale),paid=minor(Object.hasOwn(sale,'partial_balance')?sale.partial_balance:sale.paid_amount),pending=minor(sale.payment_pending),total=minor(sale.sales_total);
   const basis={sourceId:record.sourceId,invoiceId,revision:record.revision,currencyCode:'AED',currencyDigits:2,
    totalMinor:String(total),paidMinor:String(paid),pendingMinor:String(pending)};
   return journal.prepare(context,basis,input);
  },
  async reserve(context,id,commandId){
   for(let i=0;i<10;i++){
    const {state,sale}=await current(context,id,commandId);
    if(state.state!=='prepared')fail('Receipt is no longer prepared');
    competing(sale);
    if(exported(sale).revision!==state.review.values.basis.revision)fail('Original source changed');
    if(sale.books_receipt_lock){if(!sameLock(sale.books_receipt_lock,state))fail('Sale reserved by another receipt');return sale.books_receipt_lock;}
    const lock={journalId:id,commandId,reviewHash:state.review.reviewHash,sourceRevision:state.review.values.basis.revision};
    lock.originalDigest=digest(sale);
    lock.originalInvoice=source.identity(sale.source_invoice_id);
    const changed=await sales.updateOne(exact(sale),{$set:{books_receipt_lock:lock}});
    if(!changed.matchedCount)continue;
    const latest=await journal.outcome(context,id,commandId);
    if(latest.state==='stopped'){await releaseStopped(context,id,commandId);fail('Receipt stopped');}
    return lock;
   }
   fail('Sale changed while reserving');
  },
  async accept(context,id,commandId,reviewHash,confirmed){
   const {state,sale}=await current(context,id,commandId);
   if(state.state==='accepted'||state.state==='projected')return journal.accept(context,id,commandId,reviewHash,confirmed);
   if(!sameLock(sale.books_receipt_lock,state))fail('Reserve the original sale first');
   if(exported(sale).revision!==state.review.values.basis.revision||digest(sale)!==sale.books_receipt_lock.originalDigest)fail('Reserved source changed');
   await require('./books-receipt-invoice').create({db}).verifyReserved(context,id,commandId);
   return journal.accept(context,id,commandId,reviewHash,confirmed);
  },
  async apply(context,id,commandId){
   for(let i=0;i<10;i++){
    const {state,sale}=await current(context,id,commandId),lock=sale.books_receipt_lock;
    if(state.state!=='accepted'||!sameLock(lock,state))fail('Accepted reserved receipt required');
    const record=exported(sale);
    if(lock.appliedRevision){
     if(record.revision!==lock.appliedRevision||digest(sale)!==lock.appliedDigest||lock.receiptId!==state.receipt.id)fail('Applied payment values changed');
     return {receiptId:state.receipt.id,paidMinor:state.receipt.paidMinor,pendingMinor:state.receipt.pendingMinor,revision:record.revision};
    }
    if(record.revision!==state.review.values.basis.revision||digest(sale)!==lock.originalDigest)fail('Reserved source values changed');
    const set={partial_balance:money(state.receipt.paidMinor),payment_pending:money(state.receipt.pendingMinor),
     payment_status:state.receipt.pendingMinor==='0'?'Paid':'Partialy Paid',updated_date:new Date(state.receipt.at),updated_by:state.receipt.actor.name};
    if(sale.customer_id!=null)set.wallet_amount=money(minor(sale.wallet_amount??0)+BigInt(state.receipt.amountMinor));
    const projected={...sale,...set},revision=exported(projected).revision;
    set.books_receipt_lock={...lock,appliedRevision:revision,appliedDigest:digest(projected),receiptId:state.receipt.id};
    if((await sales.updateOne(exact(sale),{$set:set})).matchedCount)return {receiptId:state.receipt.id,paidMinor:state.receipt.paidMinor,pendingMinor:state.receipt.pendingMinor,revision};
   }
   fail('Sale changed while applying receipt');
  },
  async verifyReserved(context,id,commandId){
   const {state,sale}=await current(context,id,commandId),lock=sale.books_receipt_lock;
   if(state.state!=='prepared'||!sameLock(lock,state)||exported(sale).revision!==state.review.values.basis.revision||digest(sale)!==lock.originalDigest)fail('Reserved source changed');
   return {state,sale};
  },
  async verifyApplied(context,id,commandId){
   const state=await journal.outcome(context,id,commandId),sale=await load(context,state.review.values.basis.sourceId),lock=sale.books_receipt_lock;
   if(state.state!=='accepted'||!sameLock(lock,state)||lock.receiptId!==state.receipt.id||
      !lock.appliedRevision||exported(sale).revision!==lock.appliedRevision||digest(sale)!==lock.appliedDigest||
      JSON.stringify(source.identity(sale.source_invoice_id))!==JSON.stringify(lock.originalInvoice))fail('Original invoice sale or applied values changed');
   return {state,sale};
  },
  releaseStopped,
  async stop(context,id,commandId,reviewHash){const result=await journal.stop(context,id,commandId,reviewHash);await require('./books-receipt-invoice').create({db}).releaseStopped(context,id,commandId);await releaseStopped(context,id,commandId);return result;}
 };
}
module.exports={create,unreserved,mutable};
