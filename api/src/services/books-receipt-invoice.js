'use strict';
// Projects an already accepted receipt; it never initiates another collection.
const {ObjectId,BSON}=require('mongodb');
const {createHash}=require('node:crypto');
const saleModule=require('./books-receipt-sale');
const fail=message=>{throw Object.assign(new Error(message),{code:'books_receipt_invoice_conflict',status:409});};
const order=v=>Array.isArray(v)?v.map(order):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(order(BSON.EJSON.serialize(v,{relaxed:false})))).digest('hex');
const identity=value=>require('../v1/accounting-source').identity(value);
function minor(value){
 if(!['string','number'].includes(typeof value)||!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(value)))fail('Invoice payment balance differs');
 const [whole,fraction='']=String(value).split('.');return String(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
function money(value){const n=Number(value)/100;if(minor(n)!==String(value))fail('Invoice amount precision differs');return n;}
const financial=invoice=>Object.fromEntries(['sale_id','total','items','sale_total','paid_amount','balance','status','payments','sale_payment_status'].filter(k=>Object.hasOwn(invoice,k)).map(k=>[k,invoice[k]]));
function create({db}){
 const invoices=db.collection('invoices'),sales=saleModule.create({db});
 const journal=require('./books-receipt-journal').create({db});
 const wall=context=>({license:context.license,branch_id:/^[a-f0-9]{24}$/.test(context.branchId)?{$in:[context.branchId,new ObjectId(context.branchId)]}:context.branchId});
 const owns=(invoice,state)=>invoice.books_receipt_lock?.journalId===state.review.journalId&&invoice.books_receipt_lock?.commandId===state.commandId&&invoice.books_receipt_lock?.reviewHash===state.review.reviewHash;
 const exact=invoice=>({_id:invoice._id,$expr:{$eq:['$$ROOT',{$literal:invoice}]}});
 async function load(context,sale){const typed=sale.books_receipt_lock.originalInvoice;return invoices.findOne({...wall(context),_id:typed.kind==='objectId'?new ObjectId(typed.value):typed.value});}
 function eligible(invoice,state){
  if(invoice.invoice_issue_lock)fail('Finish original invoice issuance first');
  const basis=state.review.values.basis;
  if(!invoice||hash(identity(invoice.sale_id))!==hash(basis.sourceId))fail('Original invoice sale unavailable');
  if(!['partial','unpaid','issued'].includes(invoice.status)||minor(invoice.paid_amount)!==basis.paidMinor||minor(invoice.balance)!==basis.pendingMinor)fail('Original invoice payment balance differs');
 }
 async function releaseStopped(context,id,commandId){
  const state=await journal.outcome(context,id,commandId);
  if(state.state!=='stopped')fail('Only stopped unaccepted receipts release invoices');
  if(state.review.values.actor.id!==context.actorId)fail('Use the original payment actor');
  const held=await invoices.find({...wall(context),'books_receipt_lock.journalId':id,'books_receipt_lock.commandId':commandId}).limit(2).toArray();
  if(held.length>1)fail('Invoice reservation identity differs');
  for(const invoice of held){
   if(!owns(invoice,state)||(invoice.books_receipt_effects||[]).some(row=>row.journalId===id&&row.commandId===commandId))fail('Invoice receipt cannot be released');
   if(!(await invoices.updateOne(exact(invoice),{$unset:{books_receipt_lock:''}})).matchedCount){
    const latest=await invoices.findOne({_id:invoice._id,...wall(context)});
    if(latest&&owns(latest,state))fail('Invoice changed while releasing; retry recovery');
   }
  }
 }
 return {
  releaseStopped,
  async releaseCompleted(context,id,commandId){
   const state=await journal.outcome(context,id,commandId);
   if(state.state!=='projected'||!state.effects)fail('Verified completion required');
   const typed=state.effects.invoice.invoiceId;
   const invoice=await invoices.findOne({...wall(context),_id:typed.kind==='objectId'?new ObjectId(typed.value):typed.value});
   if(!invoice)fail('Completed invoice unavailable');
   if(!owns(invoice,state))return;
   if(hash(financial(invoice))!==state.effects.invoice.financialHash)fail('Completed invoice differs');
   const notes=(invoice.payments||[]).filter(row=>row.books_receipt_id===state.receipt.id);
   if(notes.length!==1)fail('Completed invoice receipt differs');
   const result=await invoices.updateOne(exact(invoice),{$unset:{books_receipt_lock:''}});
   if(!result.matchedCount){const latest=await invoices.findOne({_id:invoice._id,...wall(context)});if(latest&&owns(latest,state))fail('Invoice release changed; retry recovery');}
  },
  async reserve(context,id,commandId){
   for(let i=0;i<10;i++){
    const {state,sale}=await sales.verifyReserved(context,id,commandId),invoice=await load(context,sale);eligible(invoice,state);
    if(invoice.books_receipt_lock){
     if(!owns(invoice,state)||invoice.books_receipt_lock.originalHash!==hash(financial(invoice)))fail('Invoice reserved or original values changed');
     return invoice.books_receipt_lock;
    }
    const lock={journalId:id,commandId,reviewHash:state.review.reviewHash,originalHash:hash(financial(invoice))};
    if(!(await invoices.updateOne(exact(invoice),{$set:{books_receipt_lock:lock}})).matchedCount)continue;
    if((await journal.outcome(context,id,commandId)).state==='stopped'){await releaseStopped(context,id,commandId);fail('Receipt stopped');}
    return lock;
   }
   fail('Invoice changed while reserving');
  },
  async verifyReserved(context,id,commandId){
   const {state,sale}=await sales.verifyReserved(context,id,commandId),invoice=await load(context,sale);eligible(invoice,state);
   if(!owns(invoice,state)||invoice.books_receipt_lock.originalHash!==hash(financial(invoice)))fail('Reserve the unchanged original invoice first');
   return invoice.books_receipt_lock;
  },
  async verify(context,id,commandId){return create({db}).apply(context,id,commandId,true);},
  async apply(context,journalId,commandId,verifyOnly=false){
  for(let i=0;i<10;i++){
   const {state,sale}=await sales.verifyApplied(context,journalId,commandId),receipt=state.receipt,basis=state.review.values.basis;
   const typed=sale.books_receipt_lock.originalInvoice,invoice=await load(context,sale);
   if(!invoice||hash(identity(invoice.sale_id))!==hash(basis.sourceId))fail('Original invoice sale unavailable');
   if((invoice.payments!==undefined&&!Array.isArray(invoice.payments))||(invoice.payments?.length||0)>1000||
      (invoice.books_receipt_effects!==undefined&&!Array.isArray(invoice.books_receipt_effects)))fail('Original invoice payment history differs');
   if(!owns(invoice,state))fail('Original invoice reservation differs');
   const payments=invoice.payments||[];
   const effects=invoice.books_receipt_effects||[],own=effects.filter(row=>row.receiptId===receipt.id);
   const notes=payments.filter(row=>row.books_receipt_id===receipt.id);
   const note={books_receipt_id:receipt.id,amount:money(receipt.amountMinor),method:receipt.method,reference:receipt.reference,
    date:new Date(receipt.at),by:receipt.actor.name};
   if(own.length){
    if(own.length!==1||own[0].journalId!==journalId||own[0].commandId!==commandId||notes.length!==1||hash(notes[0])!==hash(note)||own[0].financialHash!==hash(financial(invoice)))fail('Recorded invoice receipt differs');
    return {receiptId:receipt.id,invoiceId:typed,financialHash:own[0].financialHash};
   }
   if(verifyOnly)fail('All payment effects must be applied before completion');
   if(invoice.books_receipt_lock.originalHash!==hash(financial(invoice)))fail('Reserved invoice values changed');
   if(notes.length||effects.length>=500||!['partial','unpaid','issued'].includes(invoice.status)||
      minor(invoice.paid_amount)!==basis.paidMinor||minor(invoice.balance)!==basis.pendingMinor)fail('Original invoice payment balance differs');
   const set={paid_amount:money(receipt.paidMinor),balance:money(receipt.pendingMinor),sale_total:money(basis.totalMinor),
    status:receipt.pendingMinor==='0'?'paid':'partial',sale_payment_status:receipt.pendingMinor==='0'?'Paid':'Partialy Paid',
    payments:[...payments,note],updated_date:new Date(receipt.at),updated_by:receipt.actor.name};
   const financialHash=hash(financial({...invoice,...set}));
   set.books_receipt_effects=[...effects,{receiptId:receipt.id,journalId,commandId,financialHash}];
   const result=await invoices.updateOne({_id:invoice._id,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$set:set});
   if(result.matchedCount)return {receiptId:receipt.id,invoiceId:typed,financialHash};
  }
  fail('Invoice changed during receipt recovery');
 }};
}
module.exports={create};
