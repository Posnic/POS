"use strict";
const {randomUUID}=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const receipt=require('./books-receipt-sale');
const fail=message=>{throw Object.assign(new Error(message),{status:409,statusCode:409});};
const writable=()=>({...receipt.unreserved(),customer_ledger_lock:{$exists:false}});
const wc={w:1,j:true};
async function begin(db,originals,{actor=''}={}){
 if(!originals.length||originals.length>100)fail('Select between one and 100 sales for deletion');
 const sales=db.collection('sales'),customers=db.collection('customers');
 const operation={version:1,id:randomUUID(),actor:String(actor),at:new Date(),sales:originals.map(s=>({_id:s._id,license:s.license,branch_id:s.branch_id}))};
 const customerScopes=[],backups=[];
 const release=async completed=>{
  if(completed)for(const sale of originals)if(await sales.findOne({_id:sale._id,license:sale.license},{projection:{_id:1}}))fail('Sale deletion completion needs review');
  if(completed)for(const entry of backups){
   const key={_id:entry._id,document_name:entry.document_name,license:entry.license,'sale_delete_evidence.commandId':operation.id};
   if(await db.collection(entry.document_name).findOne({_id:entry._id,license:entry.license},{projection:{_id:1}}))fail('A backed-up record still exists; deletion cannot propagate');
   const original=await db.collection('recycle_bin').findOne(key);
   if(!original)fail('The original deletion backup is unavailable');
   if(original.sale_delete_evidence?.state==='committed')continue;
   if(original.sale_delete_evidence?.state!=='pending')fail('The deletion backup changed');
   const committedAt=new Date(Math.max(Date.now(),original.updated_date instanceof Date?original.updated_date.getTime()+1:0));
   let changed,error;
   try{changed=await db.collection('recycle_bin').updateOne({...key,sale_delete_evidence:original.sale_delete_evidence},{$set:{sale_delete_evidence:{version:1,commandId:operation.id,state:'committed',committedAt},updated_date:committedAt}},{writeConcern:wc});}catch(cause){error=cause;}
   if(error||!changed?.matchedCount){const saved=await db.collection('recycle_bin').findOne(key);if(saved?.sale_delete_evidence?.state!=='committed')throw error||Object.assign(new Error('Deletion evidence completion needs review'),{status:409});}
  }
  for(const scope of customerScopes){
   const update=completed?{$set:{sale_delete_result:{...operation,state:'completed'}},$unset:{sale_delete_lock:''}}:{$unset:{sale_delete_lock:''}};
   let result,error;
   try{result=await customers.updateOne({...scope,'sale_delete_lock.id':operation.id},update,{writeConcern:wc});}catch(cause){error=cause;}
   if(completed&&(error||!result?.matchedCount)){
    // A committed acknowledgement can lose its reply. Read its original
    // result without clearing a newer operation or recomputing wallet money.
    const saved=await customers.findOne(scope);
    if(!equal(saved?.sale_delete_result,{...operation,state:'completed'}))throw error||Object.assign(new Error('Customer deletion completion needs review'),{status:409});
   }else if(error)throw error;
  }
  for(const sale of originals)await sales.updateOne({_id:sale._id,license:sale.license,'sale_delete_lock.id':operation.id},{$unset:{sale_delete_lock:''}},{writeConcern:wc});
 };
 try{
  for(const sale of originals){
   receipt.mutable(sale);
   if(!(await sales.updateOne({_id:sale._id,license:sale.license,...writable(),$expr:{$eq:['$$ROOT',{$literal:sale}]}},{$set:{sale_delete_lock:operation}},{writeConcern:wc})).matchedCount)fail('A selected sale changed or has an unfinished payment');
   const customerId=sale.customer_id||sale.customer;
   if(!customerId)continue;
   const scope={_id:customerId,license:sale.license};
   if(customerScopes.some(value=>equal(value,scope)))continue;
   const customer=await customers.findOne(scope);
   if(!customer)fail('The sale customer is unavailable; review its wallet before deleting');
   customerScopes.push(scope);
   if(!(await customers.updateOne({...scope,...writable(),$expr:{$eq:['$$ROOT',{$literal:customer}]}},{$set:{sale_delete_lock:{...operation,balanceBefore:customer.balance}}},{writeConcern:wc})).matchedCount)fail('A customer has an unfinished payment; check its saved result before deleting');
  }
 }catch(error){await release(false);throw error;}
 return {id:operation.id,backupData(name,doc){
  if(!['sales','transaction'].includes(name))fail('Unsupported deletion backup');
  if(!backups.some(entry=>entry.document_name===name&&equal(entry._id,doc._id)&&equal(entry.license,doc.license)))backups.push({_id:doc._id,document_name:name,license:doc.license});
  return {...doc,sale_delete_evidence:{version:1,commandId:operation.id,state:'pending'}};
 },async finish({completed,started}){
  // Unknown cleanup is never unlocked by time or a fresh request.
  if(completed||!started)await release(completed);
 }};
}
module.exports={begin};
