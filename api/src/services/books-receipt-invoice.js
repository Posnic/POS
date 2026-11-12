"use strict";
// Internal final-effect stage. It does not accept money or acknowledge completion
// of customer-ledger projections, and is not registered as a public route.
const {ObjectId,BSON}=require('mongodb'),{createHash}=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const Money=require('../utils/currency'),journal=require('./books-receipt-journal'),saleEffects=require('./books-receipt-sale');
const fail=m=>{throw Object.assign(new Error(m),{status:409});};
const fingerprint=invoice=>{const copy={...invoice};delete copy.books_receipt_lock;return createHash('sha256').update(BSON.EJSON.stringify(copy,{relaxed:false})).digest('hex');};
function create({db}){
 const commands=journal.create({db}),sales=saleEffects.create({db}),invoices=db.collection('invoices');
 return {async reserve(context,id,cmd){
  const c=await commands.outcome(context,id,cmd);if(c?.state!=='prepared')fail('Review the unaccepted payment first');await sales.reserve(context,id,cmd);
  const b=c.review.values.basis,identity={journalId:id,commandId:cmd,authority:context.authority,reviewHash:c.review.reviewHash};if(!b.invoiceIdentity)fail('Review the typed invoice identity');
  const query={_id:b.invoiceIdentity.kind==='objectId'?new ObjectId(b.invoiceIdentity.value):b.invoiceIdentity.value,license:journal.licenseValue(context)};
  for(let attempt=0;attempt<5;attempt++){
   const invoice=await invoices.findOne(query);if(!invoice||String(invoice.branch_id)!==context.branchId||!equal(invoice.sale_id,b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value))fail('Original invoice is unavailable');
   const currency={currencyCode:b.currencyCode,currencyDigits:b.currencyDigits};
   if(!['unpaid','partial'].includes(invoice.status)||invoice.paid_amount!==Money.fromMinor(Number(b.paidMinor),currency)||invoice.balance!==Money.fromMinor(Number(b.pendingMinor),currency)||!Array.isArray(invoice.payments??[]))fail('Original invoice payment mirror needs review');
   let lock=invoice.books_receipt_lock;
   if(lock){if(!equal(lock.identity,identity)||lock.beforeHash!==fingerprint(invoice))fail('Invoice reservation changed');}
   else {lock={identity,beforeHash:fingerprint(invoice)};if(!(await invoices.updateOne({...query,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$set:{books_receipt_lock:lock}},{writeConcern:{w:1,j:true}})).matchedCount)continue;}
   const current=await commands.outcome(context,id,cmd);if(current.state==='stopped'){await invoices.updateOne({...query,books_receipt_lock:lock},{$unset:{books_receipt_lock:''}},{writeConcern:{w:1,j:true}});fail('This payment request was stopped');}if(current.state!=='prepared')fail('Payment acceptance changed; recover the original');return lock;
  }
  fail('Invoice changed; review the original payment');
 },async release(context,id,cmd){
  const c=await commands.outcome(context,id,cmd);if(!c||!['stopped','projected'].includes(c.state))fail('Finish or stop the original receipt first');const b=c.review.values.basis;
  if(!b.invoiceIdentity)fail('Review the typed invoice identity');const query={_id:b.invoiceIdentity.kind==='objectId'?new ObjectId(b.invoiceIdentity.value):b.invoiceIdentity.value,license:journal.licenseValue(context)};
  const invoice=await invoices.findOne(query);if(!invoice&&c.state==='stopped')return;if(!invoice||String(invoice.branch_id)!==context.branchId)fail('Original invoice is unavailable');const lock=invoice.books_receipt_lock;if(!lock)return;
  if(!equal(lock.identity,{journalId:id,commandId:cmd,authority:context.authority,reviewHash:c.review.reviewHash}))fail('Another receipt owns this invoice');
  if(c.state==='projected'&&(!invoice.books_receipt_effects?.some(e=>e.receiptId===c.receipt.id&&e.reviewHash===c.review.reviewHash)||!invoice.payments?.some(p=>p.id===c.receipt.id)))fail('Invoice receipt is incomplete');
  if(!(await invoices.updateOne({...query,books_receipt_lock:lock},{$unset:{books_receipt_lock:''}},{writeConcern:{w:1,j:true}})).matchedCount&&(await invoices.findOne(query))?.books_receipt_lock)fail('Invoice reservation changed');
 },async apply(context,id,cmd){
  const c=await commands.outcome(context,id,cmd);if(!c||!['accepted','projected'].includes(c.state))fail('Recover the accepted receipt first');
  await sales.apply(context,id,cmd);
  const b=c.review.values.basis,r=c.receipt,setting={currencyCode:b.currencyCode,currencyDigits:b.currencyDigits},saleId=b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value;
  const sale=await db.collection('sales').findOne({_id:saleId,license:journal.licenseValue(context),'books_receipt_projection.receiptId':r.id});
  if(!sale||String(sale.branch_id)!==context.branchId||sale.books_receipt_owner?.authority!==context.authority||sale.books_receipt_lock?.commandId!==cmd)fail('Original sale payment is not reserved');
  const receipt={id:r.id,amount:Money.fromMinor(Number(r.amountMinor),setting),method:r.method,reference:r.reference,note:'',date:new Date(r.at),by:c.review.values.input.actor?.name||''};
  const effect={version:1,receiptId:r.id,journalId:id,commandId:cmd,reviewHash:c.review.reviewHash,paidMinor:r.paidMinor,pendingMinor:r.pendingMinor};
  const status=r.pendingMinor==='0'?'paid':r.paidMinor==='0'?'unpaid':'partial',target={status,sale_id:sale._id,sale_number:String(sale.sales_id||'').slice(0,40),sale_total:Money.fromMinor(Number(b.totalMinor),setting),paid_amount:Money.fromMinor(Number(r.paidMinor),setting),balance:Money.fromMinor(Number(r.pendingMinor),setting),sale_payment_status:sale.payment_status,synced_date:new Date(r.at),updated_date:new Date(r.at)};
  if(!b.invoiceIdentity)fail('Review the original typed invoice identity');
  const query={_id:sale.source_invoice_id,license:journal.licenseValue(context),branch_id:sale.branch_id};
  for(let attempt=0;attempt<5;attempt++){
   const found=await invoices.find(query).limit(2).toArray();if(found.length!==1)fail('Original invoice identity is missing or ambiguous');const invoice=found[0];
   if(!equal(invoice.sale_id,sale._id)||!['unpaid','partial','paid'].includes(invoice.status))fail('Invoice no longer belongs to the original issued sale');
   const notes=invoice.payments??[],effects=invoice.books_receipt_effects??[];if(!Array.isArray(notes)||!Array.isArray(effects)||notes.length>5000||effects.length>1000)fail('Invoice payment history needs review');
   const existingNotes=notes.filter(p=>p?.id===r.id),existingEffects=effects.filter(p=>p?.receiptId===r.id);
   if(existingNotes.length||existingEffects.length){
    if(existingNotes.length!==1||existingEffects.length!==1||!equal(existingNotes[0],receipt)||!equal(existingEffects[0],effect)||Object.entries(target).filter(([k])=>!['updated_date','synced_date'].includes(k)).some(([k,v])=>!equal(invoice[k],v)))fail('Invoice receipt differs from its original');
    return effect;
   }
   if(invoice.books_receipt_lock&&(!equal(invoice.books_receipt_lock.identity,{journalId:id,commandId:cmd,authority:context.authority,reviewHash:c.review.reviewHash})||invoice.books_receipt_lock.beforeHash!==fingerprint(invoice)))fail('Invoice changed after reservation');
   const paidDate=status==='paid'?invoice.paid_date||new Date(r.at):invoice.paid_date?null:undefined;
   const saved=await invoices.updateOne({_id:invoice._id,license:journal.licenseValue(context),branch_id:sale.branch_id,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$set:{...target,...(paidDate===undefined?{}:{paid_date:paidDate})},$push:{payments:receipt,books_receipt_effects:effect}},{writeConcern:{w:1,j:true}});
   if(saved.matchedCount)return effect;
  }
  fail('Invoice changed; recover the original receipt');
 }};
}
module.exports={create};
