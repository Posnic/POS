"use strict";
const {ObjectId}=require('mongodb'),{randomUUID}=require('node:crypto');
const fail=()=>{throw new Error('Invoice issuance needs original-result recovery');};
function create({db}){
 const invoices=db.collection('invoices');
 const scope=(id,context)=>{
  if(![id,context.licenseId,context.branchId].every(value=>value&&ObjectId.isValid(String(value))))fail();
  return {_id:new ObjectId(String(id)),license:new ObjectId(String(context.licenseId)),branch_id:new ObjectId(String(context.branchId))};
 };
 return {
  async reserve(id,context,commandId,request){
   const key=scope(id,context),invoice=await invoices.findOne(key);
   if(!invoice||invoice.sale_id||invoice.status!=='draft'||invoice.books_receipt_lock||invoice.invoice_issue_lock)fail();
   if(commandId&&(invoice.invoice_payment_stops||[]).some(row=>row.id===commandId))fail();
   const lock={token:randomUUID(),state:'preparing',commandId:commandId||null,actor:context.userName,actorId:context.userId?String(context.userId):null,startedAt:new Date()};
   const requests=invoice.invoice_payment_requests||[];
   if(!Array.isArray(requests)||requests.length>=1000)fail();
   const existing=commandId&&requests.find(row=>row.id===commandId);
   if(existing&&!require('./invoice-sync').invoiceRequestMatches(invoice,commandId,request,context))fail();
   const record=commandId&&request&&!existing?{id:commandId,request,actor:context.userName,actorId:lock.actorId}:null;
   const result=await invoices.updateOne({...key,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$set:{invoice_issue_lock:lock},...(record?{$push:{invoice_payment_requests:record}}:{})});
   if(!result.matchedCount)fail();return {invoice,token:lock.token};
  },
  async stop(id,context,commandId){
   for(let attempt=0;attempt<5;attempt++){
    const key=scope(id,context),invoice=await invoices.findOne(key);if(!invoice)fail();
    const stops=invoice.invoice_payment_stops||[];if(!Array.isArray(stops))fail();
    const existing=stops.find(row=>row.id===commandId);if(existing)return existing;
    if(invoice.sale_id||invoice.invoice_issue_lock||invoice.books_receipt_lock||invoice.status!=='draft'||stops.length>=1000||require('mongodb').BSON.calculateObjectSize(invoice)>512*1024)fail();
    const record={id:commandId,actor:context.userName,actorId:context.userId?String(context.userId):null,stoppedAt:new Date()};
    const result=await invoices.updateOne({...key,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$push:{invoice_payment_stops:record}});
    if(result.matchedCount)return record;
   }
   fail();
  },
  async preparingFailed(id,context,token){
   const result=await invoices.updateOne({...scope(id,context),'invoice_issue_lock.token':token,'invoice_issue_lock.state':'preparing'},{$unset:{invoice_issue_lock:''}});
   if(!result.matchedCount)fail();
  },
  async booking(id,context,token){
   const result=await invoices.updateOne({...scope(id,context),'invoice_issue_lock.token':token,'invoice_issue_lock.state':'preparing'},{$set:{'invoice_issue_lock.state':'booking'}});
   if(!result.matchedCount)fail();
  },
  async booked(id,context,token,saleId){
   if(!saleId||!ObjectId.isValid(String(saleId)))fail();
   const result=await invoices.updateOne({...scope(id,context),'invoice_issue_lock.token':token,'invoice_issue_lock.state':'booking'},{$set:{'invoice_issue_lock.state':'booked','invoice_issue_lock.saleId':String(saleId)}});
   if(!result.matchedCount)fail();
  },
  async verifyBooked(id,context,lock){
   if(lock?.state!=='booked'||!ObjectId.isValid(String(lock.saleId)))fail();
   const key=scope(id,context);
   const sale=await db.collection('sales').findOne({_id:new ObjectId(lock.saleId),license:key.license,branch_id:key.branch_id,source_invoice_id:key._id});
   if(!sale)fail();return sale;
  },
  async complete(id,context,token,saleId){
   const key=scope(id,context),invoice=await invoices.findOne(key);
   if(!invoice||String(invoice.sale_id)!==String(saleId)||invoice.invoice_issue_lock?.token!==token||invoice.invoice_issue_lock?.state!=='booked')fail();
   const result=await invoices.updateOne({...key,$expr:{$eq:['$$ROOT',{$literal:invoice}]}},{$unset:{invoice_issue_lock:''}});
   if(!result.matchedCount)fail();
  },
 };
}
module.exports={create};
