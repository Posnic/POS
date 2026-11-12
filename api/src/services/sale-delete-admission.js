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
 const customerScopes=[];
 const release=async completed=>{
  if(completed)for(const sale of originals)if(await sales.findOne({_id:sale._id,license:sale.license},{projection:{_id:1}}))fail('Sale deletion completion needs review');
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
 return {id:operation.id,async finish({completed,started}){
  // Unknown cleanup is never unlocked by time or a fresh request.
  if(completed||!started)await release(completed);
 }};
}
module.exports={begin};
