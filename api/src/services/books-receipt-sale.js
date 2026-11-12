"use strict";
// Internal coordinator stage, deliberately not registered as a payment route.
const {ObjectId}=require('mongodb'),{createHash}=require('node:crypto');
const journal=require('./books-receipt-journal'),source=require('../v1/accounting-source'),Money=require('../utils/currency');
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=m=>{throw Object.assign(new Error(m),{status:409});};
const equal=require('node:util').isDeepStrictEqual;
const writeConcern={w:1,j:true};
function unreserved(){return {books_receipt_lock:{$exists:false},books_receipt_owner:{$exists:false},legacy_invoice_payment_lock:{$exists:false}};}
function mutable(sale){if(sale&&Object.hasOwn(sale,'legacy_invoice_payment_lock'))fail('Check the unfinished POS invoice payment before collecting again.');if(sale&&(Object.hasOwn(sale,'books_receipt_lock')||Object.hasOwn(sale,'books_receipt_owner')))fail('This sale has a Books payment operation. Recover its original payment before changing it.');}
function invoiceIdentity(value){if(value?._bsontype==='ObjectId')return {kind:'objectId',value:String(value)};if(typeof value==='string')return {kind:'string',value};fail('Original invoice identity is unavailable');}
function checkedBasis(original,invoiceId,identity){
 const v=original.values,currency={currencyCode:v.currencyCode,currencyDigits:v.currencyDigits};
 if(typeof v.currencyCode!=='string'||!Number.isInteger(v.currencyDigits)||v.sale_process==='Hold'||!['Unpaid','Partialy Paid','Paid'].includes(v.payment_status))fail('Review the original sale payment state');
 const exact=value=>{if(!['number','string'].includes(typeof value)||String(value).trim()==='')fail('Original payment amount is missing');const n=Money.toMinor(value,currency);if(n<0||Money.fromMinor(n,currency)!==Number(value))fail('Original payment amount is not exact');return n;};
 const total=exact(v.sales_total),pending=exact(v.payment_pending),paid=total-pending;if(paid<0||(v.payment_status==='Unpaid'&&paid!==0)||(v.payment_status==='Paid'&&pending!==0)||exact(v.partial_balance??0)!==paid)fail('Original sale balance needs review');
 if(v.wallet_amount!==undefined)exact(v.wallet_amount);
 if(String(v.source_invoice_id)!==invoiceId)fail('Original invoice identity changed');
 return journal.basis({sourceId:original.sourceId,invoiceId,...(identity?{invoiceIdentity:identity}:{}),revision:hash(JSON.stringify(original)),...currency,totalMinor:String(total),paidMinor:String(paid),pendingMinor:String(pending)});
}
function create({db,now=()=>new Date()}){
 const sales=db.collection('sales'),commands=journal.create({db,now});
 const filter=(context,b)=>({_id:b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value,license:journal.licenseValue(context),branch_id:/^[a-f0-9]{24}$/.test(context.branchId)?new ObjectId(context.branchId):context.branchId});
 const lockOf=(context,id,c,original)=>({version:1,journalId:id,commandId:c.commandId,authority:context.authority,reviewHash:c.review.reviewHash,sourceJson:original.sourceJson,sourceRevision:original.revision});
 const owned=(lock,context,id,c)=>lock?.version===1&&lock.journalId===id&&lock.commandId===c.commandId&&lock.authority===context.authority&&lock.reviewHash===c.review.reviewHash&&lock.sourceRevision===c.review.values.basis.revision&&typeof lock.sourceJson==='string'&&hash(lock.sourceJson)===lock.sourceRevision;
 async function read(context,id,cmd){const c=await commands.outcome(context,id,cmd);if(!c)fail('Original payment request is missing');const b=c.review.values.basis,query=filter(context,b),sale=await sales.findOne(query);if(!sale||String(sale.source_invoice_id)!==b.invoiceId||(b.invoiceIdentity&&!equal(invoiceIdentity(sale.source_invoice_id),b.invoiceIdentity)))fail('Original invoice sale is unavailable');return {c,b,query,sale};}
 const service={
  async prepare(context,sourceId,invoiceId,input){
   if(!sourceId||!['objectId','string'].includes(sourceId.kind)||typeof sourceId.value!=='string')fail('Choose the original sale');
   const sale=await sales.findOne(filter(context,{sourceId}));if(!sale||String(sale.source_invoice_id)!==invoiceId)fail('Original invoice sale is unavailable');
   const projected=await sales.findOne({...filter(context,{sourceId}),$expr:{$eq:['$$ROOT',{$literal:sale}]}},{projection:source.projection});if(!projected)fail('Original sale changed');
   const b=checkedBasis(JSON.parse(source.exportSale(projected).sourceJson),invoiceId,invoiceIdentity(sale.source_invoice_id));return commands.prepare(context,b,input);
  },
  async accept(context,id,cmd,reviewHash,confirmed){const c=await commands.outcome(context,id,cmd);if(confirmed!==true||!c||c.review.reviewHash!==reviewHash)fail('Confirm the original payment review');if(!['accepted','projected'].includes(c.state))await service.reserve(context,id,cmd);return commands.accept(context,id,cmd,reviewHash,confirmed);},
  async stop(context,id,cmd,reviewHash){const outcome=await commands.stop(context,id,cmd,reviewHash);await service.releaseStopped(context,id,cmd);return outcome;},
  async reserve(context,id,cmd,attempt=0){
   const {c,b,query,sale}=await read(context,id,cmd);
   if(Object.hasOwn(sale,'legacy_invoice_payment_lock'))fail('Check the unfinished POS invoice payment before continuing');
   if(sale.books_receipt_lock){if(!owned(sale.books_receipt_lock,context,id,c))fail('Another payment owns this sale');if(c.state==='prepared'){const current=await sales.findOne({...query,$expr:{$eq:['$$ROOT',{$literal:sale}]}},{projection:source.projection});if(!current||source.exportSale(current).revision!==b.revision)fail('The reserved source changed');}return sale.books_receipt_lock;}
   if(c.state!=='prepared')fail('Recover the accepted receipt on its original reserved sale');
   if(sale.books_receipt_owner&&!equal(sale.books_receipt_owner,{version:1,journalId:id,authority:context.authority}))fail('Another installation owns this sale');
   if(sale.captain_payment_plan||sale.payment_correction_pending||(sale.captain_edit_until&&new Date(sale.captain_edit_until)>now()))fail('Finish the existing sale operation first');
   const projected=await sales.findOne({...query,$expr:{$eq:['$$ROOT',{$literal:sale}]}},{projection:source.projection});if(!projected){if(attempt<3)return service.reserve(context,id,cmd,attempt+1);fail('The original sale changed');}const original=source.exportSale(projected);if(original.revision!==b.revision)fail('The reviewed source changed');if(!equal(checkedBasis(JSON.parse(original.sourceJson),b.invoiceId,invoiceIdentity(sale.source_invoice_id)),b))fail('Payment basis differs from the original sale');
   const lock=lockOf(context,id,c,original),saved=await sales.updateOne({...query,$expr:{$eq:['$$ROOT',{$literal:sale}]}},{$set:{books_receipt_lock:lock}},{writeConcern});
   if(!saved.matchedCount){const concurrent=await sales.findOne(query);if(!owned(concurrent?.books_receipt_lock,context,id,c))fail('The sale changed before reservation');}
   if((await commands.outcome(context,id,cmd))?.state==='stopped'){await service.releaseStopped(context,id,cmd);fail('This payment request was stopped');}
   return lock;
  },
  async apply(context,id,cmd,attempt=0){
   const {c,b,query,sale}=await read(context,id,cmd);if(!['accepted','projected'].includes(c.state)||!owned(sale.books_receipt_lock,context,id,c))fail('The accepted payment reservation is missing');
   const original=JSON.parse(sale.books_receipt_lock.sourceJson);if(!equal(checkedBasis(original,b.invoiceId,invoiceIdentity(sale.source_invoice_id)),b))fail('Original payment basis changed');const customer=original.customerReferences?.customerId,usesWallet=customer&&['string','objectId'].includes(customer.kind)&&ObjectId.isValid(customer.value);
   const currency={currencyCode:b.currencyCode,currencyDigits:b.currencyDigits},amount=Number(c.receipt.amountMinor),paid=Money.fromMinor(Number(c.receipt.paidMinor),currency),pending=Money.fromMinor(Number(c.receipt.pendingMinor),currency);
   const wallet=usesWallet?Money.toMinor(original.values.wallet_amount??0,currency)+amount:null;if(wallet!==null&&(!Number.isSafeInteger(wallet)||wallet<0))fail('Original wallet value needs review');
   const effect={receiptId:c.receipt.id,journalId:id,commandId:cmd,reviewHash:c.review.reviewHash,paidMinor:c.receipt.paidMinor,pendingMinor:c.receipt.pendingMinor,walletMinor:wallet===null?null:String(wallet)};
   const target={partial_balance:paid,payment_pending:pending,payment_status:pending>0?'Partialy Paid':'Paid',...(wallet===null?{}:{wallet_amount:Money.fromMinor(wallet,currency)})};
   const projected=await sales.findOne({...query,$expr:{$eq:['$$ROOT',{$literal:sale}]}},{projection:source.projection});if(!projected){if(attempt<3)return service.apply(context,id,cmd,attempt+1);fail('Sale changed during payment recovery');}
   const currentOriginal=source.exportSale(projected),expectedOriginal=JSON.parse(sale.books_receipt_lock.sourceJson);Object.assign(expectedOriginal.values,target,{updated_date:c.receipt.at});
   if(sale.books_receipt_projection){if(equal(sale.books_receipt_projection,effect)){if(!equal(JSON.parse(currentOriginal.sourceJson),expectedOriginal)||Object.entries(target).some(([k,v])=>sale[k]!==v))fail('Applied payment values changed');return effect;}if(sale.books_receipt_projection.commandId===cmd)fail('Receipt projection identity conflicts');}
   if(c.state==='projected')fail('Acknowledged sale projection is missing');
   if(currentOriginal.revision!==b.revision)fail('Sale changed before receipt projection');
   const saved=await sales.updateOne({...query,$expr:{$eq:['$$ROOT',{$literal:sale}]}},{$set:{...target,updated_date:new Date(c.receipt.at),books_receipt_projection:effect,books_receipt_owner:{version:1,journalId:id,authority:context.authority}}},{writeConcern});
   if(!saved.matchedCount){if(attempt<3)return service.apply(context,id,cmd,attempt+1);fail('Payment projection changed; recover the original');}
   return effect;
  },
  async releaseStopped(context,id,cmd){const {c,query,sale}=await read(context,id,cmd);if(c.state!=='stopped')fail('Only a stopped unaccepted request can release its reservation');if(!sale.books_receipt_lock)return;if(!owned(sale.books_receipt_lock,context,id,c))fail('Another payment owns this sale');if(!(await sales.updateOne({...query,books_receipt_lock:sale.books_receipt_lock},{$unset:{books_receipt_lock:''}},{writeConcern})).matchedCount&&(await sales.findOne(query))?.books_receipt_lock)fail('Payment reservation changed');},
  async finalize(context,id,cmd){const {c,query,sale}=await read(context,id,cmd);if(c.state!=='projected'||sale.books_receipt_projection?.receiptId!==c.receipt.id)fail('All payment effects must finish before releasing the sale');if(!sale.books_receipt_lock)return;try{await service.apply(context,id,cmd);}catch(error){const latest=await sales.findOne(query);if(latest&&!latest.books_receipt_lock&&latest.books_receipt_projection?.receiptId===c.receipt.id)return;throw error;}if(!owned(sale.books_receipt_lock,context,id,c))fail('Another payment owns this sale');if(!(await sales.updateOne({...query,books_receipt_lock:sale.books_receipt_lock},{$unset:{books_receipt_lock:''}},{writeConcern})).matchedCount&&(await sales.findOne(query))?.books_receipt_lock)fail('Payment reservation changed');}
 };
 return service;
}
module.exports={create,unreserved,mutable};
