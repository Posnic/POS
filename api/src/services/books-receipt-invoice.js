"use strict";
// Internal final-effect stage. It does not accept money or acknowledge completion
// of customer-ledger projections, and is not registered as a public route.
const {ObjectId}=require('mongodb'),equal=require('node:util').isDeepStrictEqual;
const Money=require('../utils/currency'),journal=require('./books-receipt-journal'),saleEffects=require('./books-receipt-sale');
const fail=m=>{throw Object.assign(new Error(m),{status:409});};
function create({db}){
 const commands=journal.create({db}),sales=saleEffects.create({db}),invoices=db.collection('invoices');
 return {async apply(context,id,cmd){
  const c=await commands.outcome(context,id,cmd);if(!c||!['accepted','projected'].includes(c.state))fail('Recover the accepted receipt first');
  await sales.apply(context,id,cmd);
  const b=c.review.values.basis,r=c.receipt,setting={currencyCode:b.currencyCode,currencyDigits:b.currencyDigits},saleId=b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value;
  const sale=await db.collection('sales').findOne({_id:saleId,license:context.license,'books_receipt_projection.receiptId':r.id});
  if(!sale||String(sale.branch_id)!==context.branchId||sale.books_receipt_owner?.authority!==context.authority||sale.books_receipt_lock?.commandId!==cmd)fail('Original sale payment is not reserved');
  const receipt={id:r.id,amount:Money.fromMinor(Number(r.amountMinor),setting),method:r.method,reference:r.reference,note:'',date:new Date(r.at),by:c.review.values.input.actor?.name||''};
  const effect={version:1,receiptId:r.id,journalId:id,commandId:cmd,reviewHash:c.review.reviewHash,paidMinor:r.paidMinor,pendingMinor:r.pendingMinor};
  const status=r.pendingMinor==='0'?'paid':r.paidMinor==='0'?'unpaid':'partial',target={status,sale_id:sale._id,sale_number:String(sale.sales_id||'').slice(0,40),sale_total:Money.fromMinor(Number(b.totalMinor),setting),paid_amount:Money.fromMinor(Number(r.paidMinor),setting),balance:Money.fromMinor(Number(r.pendingMinor),setting),sale_payment_status:sale.payment_status,synced_date:new Date(r.at),updated_date:new Date(r.at)};
  if(!b.invoiceIdentity)fail('Review the original typed invoice identity');
  const query={_id:sale.source_invoice_id,license:context.license,branch_id:sale.branch_id};
  for(let attempt=0;attempt<5;attempt++){
   const found=await invoices.find(query).limit(2).toArray();if(found.length!==1)fail('Original invoice identity is missing or ambiguous');const invoice=found[0];
   if(!equal(invoice.sale_id,sale._id)||!['unpaid','partial','paid'].includes(invoice.status))fail('Invoice no longer belongs to the original issued sale');
   const notes=invoice.payments??[],effects=invoice.books_receipt_effects??[];if(!Array.isArray(notes)||!Array.isArray(effects)||notes.length>5000||effects.length>1000)fail('Invoice payment history needs review');
   const existingNotes=notes.filter(p=>p?.id===r.id),existingEffects=effects.filter(p=>p?.receiptId===r.id);
   if(existingNotes.length||existingEffects.length){
    if(existingNotes.length!==1||existingEffects.length!==1||!equal(existingNotes[0],receipt)||!equal(existingEffects[0],effect)||Object.entries(target).filter(([k])=>!['updated_date','synced_date'].includes(k)).some(([k,v])=>!equal(invoice[k],v)))fail('Invoice receipt differs from its original');
    return effect;
   }
   const paidDate=status==='paid'?invoice.paid_date||new Date(r.at):invoice.paid_date?null:undefined;
   const saved=await invoices.updateOne({_id:invoice._id,license:context.license,branch_id:sale.branch_id,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$set:{...target,...(paidDate===undefined?{}:{paid_date:paidDate})},$push:{payments:receipt,books_receipt_effects:effect}},{writeConcern:{w:1,j:true}});
   if(saved.matchedCount)return effect;
  }
  fail('Invoice changed; recover the original receipt');
 }};
}
module.exports={create};
