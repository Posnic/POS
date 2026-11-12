"use strict";
// Internal coordinator. Authenticated opt-in routes and competing-writer fences
// must be installed before any public payment flow calls this service.
const {ObjectId}=require('mongodb'),journal=require('./books-receipt-journal'),saleModule=require('./books-receipt-sale'),invoiceModule=require('./books-receipt-invoice'),customerModule=require('./books-receipt-customer'),source=require('../v1/accounting-source');
const fail=m=>{throw Object.assign(new Error(m),{status:409});};
function create({db}){
 const commands=journal.create({db}),sales=saleModule.create({db}),invoices=invoiceModule.create({db}),customers=customerModule.create({db});
 const query=(context,b)=>({_id:b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value,license:journal.licenseValue(context)});
 async function release(context,id,cmd,c){await customers.release(context,id,cmd);await invoices.release(context,id,cmd);if(c.state==='stopped')await sales.releaseStopped(context,id,cmd);else await sales.finalize(context,id,cmd);return c;}
 const service={
  async prepare(context,sourceId,invoiceId,input){
   const sale=await db.collection('sales').findOne(query(context,{sourceId}));if(sale?.books_receipt_lock&&sale.books_receipt_lock.commandId!==input.commandId)fail('Finish the previous payment recovery first');return sales.prepare(context,sourceId,invoiceId,input);
  },
  outcome:(context,id,cmd)=>commands.outcome(context,id,cmd),
  async accept(context,id,cmd,reviewHash,confirmed){
   const c=await commands.outcome(context,id,cmd);if(!c||c.review.reviewHash!==reviewHash||confirmed!==true)fail('Confirm the original received payment');
   try{if(c.state==='prepared'){
    if(c.review.values.input.actor?.id!==context.actorId)fail('Confirm using the original payment actor');
    await sales.reserve(context,id,cmd);await invoices.reserve(context,id,cmd);await customers.reserve(context,id,cmd);
    // Recheck every reservation immediately before the one durable acceptance.
    await invoices.reserve(context,id,cmd);await customers.reserve(context,id,cmd);await sales.accept(context,id,cmd,reviewHash,true);
   }else if(!['accepted','projected'].includes(c.state))fail('This payment request was stopped');
   }catch(error){const latest=await commands.outcome(context,id,cmd);if(!latest||!['accepted','projected'].includes(latest.state))throw error;}
   return service.recover(context,id,cmd);
  },
  async stop(context,id,cmd,reviewHash){const c=await commands.stop(context,id,cmd,reviewHash);return release(context,id,cmd,c);},
  async recover(context,id,cmd){
   let c=await commands.outcome(context,id,cmd);if(!c)fail('Original payment request is missing');if(c.state==='prepared')return c;if(c.state==='stopped')return release(context,id,cmd,c);
   try{
    if(c.state==='accepted'){
     await sales.apply(context,id,cmd);await customers.apply(context,id,cmd);await invoices.apply(context,id,cmd);
     // Replays validate completed values, rather than treating a marker as proof.
     await customers.apply(context,id,cmd);await invoices.apply(context,id,cmd);await sales.apply(context,id,cmd);
     const sale=await db.collection('sales').findOne(query(context,c.review.values.basis),{projection:source.projection});if(!sale)fail('Original sale disappeared');
     c=await commands.projected(context,id,cmd,{receiptId:c.receipt.id,paidMinor:c.receipt.paidMinor,pendingMinor:c.receipt.pendingMinor,revision:source.exportSale(sale).revision});
    }
    return await release(context,id,cmd,c);
   }catch(error){
    // Another recovery may have completed and released while this one awaited a write.
    const latest=await commands.outcome(context,id,cmd),sale=await db.collection('sales').findOne(query(context,latest.review.values.basis));
    if(latest.state==='projected'&&sale&&sale.books_receipt_lock?.commandId!==cmd)return latest;
    throw error;
   }
  }
 };
 return service;
}
module.exports={create};
