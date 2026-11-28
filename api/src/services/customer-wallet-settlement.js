'use strict';
// Standalone-Mongo settlement coordinator. Explicit use only until all legacy
// writers honor wallet_entry_lock on both customer and sale records.
const {ObjectId,BSON}=require('mongodb');
const {createHash}=require('node:crypto');
const {canonical}=require('./invoice-payment-effects');
const decimal=require('../utils/wallet-decimal');
const same=(a,b)=>canonical(a)===canonical(b);
const exact=row=>({_id:row._id,$expr:{$eq:['$$ROOT',{$literal:row}]}});
const fail=message=>{throw Object.assign(new Error(message),{code:'wallet_settlement_conflict'});};
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const sorted=rows=>[...rows].sort((a,b)=>String(a._id).localeCompare(String(b._id)));
function scope(context,id){
 if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))fail('Original settlement ID is required');
 for(const key of ['license','branchId','customerId','actorId'])if(!ObjectId.isValid(String(context[key])))fail('Invalid settlement scope');
 return {_id:id,license:new ObjectId(String(context.license)),branch_id:new ObjectId(String(context.branchId)),customer_id:new ObjectId(String(context.customerId)),actor_id:new ObjectId(String(context.actorId))};
}
function normalize(input){
 if(!input||Object.keys(input).some(k=>k!=='sales')||!Array.isArray(input.sales)||!input.sales.length||input.sales.length>100)fail('Select between one and 100 sales');
 const ids=new Set();const sales=input.sales.map(item=>{
  if(!item||Object.keys(item).some(k=>!['id','amount','paidamount'].includes(k))||typeof item.id!=='string'||!/^[a-f0-9]{24}$/.test(item.id)||ids.has(item.id))fail('Select each original sale once');
  ids.add(item.id);decimal.amount(item.amount);decimal.amount(item.paidamount);if(item.amount<=0)fail('Settlement amount must be positive');
  return {id:item.id,amount:item.amount,paidamount:item.paidamount};
 });
 return {sales:sales.sort((a,b)=>a.id.localeCompare(b.id))};
}
function available(row){
 for(const key of ['wallet_entry_lock','books_receipt_lock','legacy_invoice_payment_lock','captain_payment_plan','payment_correction_pending','return_refund_lock'])
  if(Object.hasOwn(row,key))fail('An original record has an unfinished operation');
 if(row.captain_edit_until&&new Date(row.captain_edit_until)>new Date())fail('A sale is being edited');
}
function create({db}){
 const journals=db.collection('wallet_settlement_journal'),customers=db.collection('customers'),sales=db.collection('sales'),ledger=db.collection('transaction');
 const customerQuery=key=>({_id:key.customer_id,license:key.license,branch_id:key.branch_id});
 async function rows(key){const rows=await ledger.find({customer_id:key.customer_id,license:key.license}).limit(10001).toArray();
  if(rows.length>10000||rows.some(row=>!same(row.branch_id,key.branch_id)))fail('Customer ledger scope requires review');decimal.balance(rows);return sorted(rows);}
 const lock=journal=>({kind:'sale-settlement',commandId:journal._id,actorId:journal.actor_id,planHash:journal.planHash});
 const held=(row,journal)=>({...row,wallet_entry_lock:lock(journal)});
 const savedResult=journal=>({state:'saved',commandId:journal._id,request:journal.request,balance:journal.plan.balance,sales:journal.request.sales.map(item=>item.id)});
 function validate(journal,key){
  if(!journal||!['_id','license','branch_id','customer_id','actor_id'].every(k=>same(journal[k],key[k])))fail('Original settlement belongs to another scope or cashier');
  if(!['prepared','applying','completed'].includes(journal.state)||digest(journal.plan)!==journal.planHash||!same(normalize(journal.request),journal.request))fail('Original settlement evidence requires review');
  if(!same(journal.plan.customer._id,key.customer_id)||!same(journal.plan.customer.license,key.license)||!same(journal.plan.customer.branch_id,key.branch_id))fail('Original customer differs');
  if(journal.state==='completed'&&!same(journal.result,savedResult(journal)))fail('Saved settlement result differs from its original plan');
  return journal;
 }
 async function current(key){return validate(await journals.findOne({_id:key._id}),key);}
 async function status(context,id){const key=scope(context,id),journal=await journals.findOne({_id:id});if(!journal)return {state:'absent',commandId:id};validate(journal,key);
  return journal.state==='completed'?journal.result:{state:'pending',commandId:id,request:journal.request,phase:journal.state};}
 async function submit(context,id,input){
  const key=scope(context,id),request=normalize(input),existing=await journals.findOne({_id:id});
  if(existing){validate(existing,key);if(!same(existing.request,request))fail('Original settlement request differs');return resume(context,id);}
  const customer=await customers.findOne(customerQuery(key));if(!customer||customer.is_deleted===true)fail('Customer unavailable');available(customer);
  const baseline=await rows(key),balance=decimal.balance(baseline);if(balance!==customer.balance)fail('Customer balance differs from its ledger');
  const total=decimal.balance(request.sales.map(item=>({type:'in',amount:item.amount})));if(total>balance)fail('Not enough wallet balance');
  const startedAt=new Date(),effects=[];
  for(const item of request.sales){
   const sale=await sales.findOne({_id:new ObjectId(item.id),license:key.license,branch_id:key.branch_id});
   if(!sale||!same(sale.customer_id,key.customer_id)||sale.is_deleted===true||!['Add','Edit'].includes(sale.sale_process))fail('Original sale unavailable');available(sale);
   // Invoice/quote mirrors require their own original snapshots before activation.
   if(sale.source_invoice_id)fail('Invoice-linked settlement requires the invoice recovery adapter');
   if(sale.payment_pending!==item.amount||sale.partial_balance!==item.paidamount||
      (Object.hasOwn(sale,'paid_amount')&&sale.paid_amount!==item.paidamount))fail('Original sale balance changed');
   const allocation=baseline.filter(row=>same(row.sale_id,sale._id));
   if(allocation.length!==1||allocation[0].type!=='out'||allocation[0].amount!==(sale.wallet_amount||0))fail('Original sale allocation differs');
   const paid=decimal.balance([{type:'in',amount:item.paidamount},{type:'in',amount:item.amount}]);
   if(sale.sales_total!==paid)fail('Sale total differs from its paid and pending amounts');
   const wallet=decimal.balance([{type:'in',amount:allocation[0].amount},{type:'in',amount:item.amount}]);
   effects.push({sale,allocation:allocation[0],saleAfter:{...sale,partial_balance:paid,paid_amount:paid,wallet_amount:wallet,payment_pending:0,payment_status:'Paid',updated_date:startedAt,updated_by_id:key.actor_id},
    allocationAfter:{...allocation[0],amount:wallet,pending:0,updated_date:startedAt}});
  }
  const expected=baseline.map(row=>effects.find(effect=>same(effect.allocation._id,row._id))?.allocationAfter||row);
  const plan={customer,baseline,effects,balance:decimal.balance(expected),startedAt};
  const journal={...key,request,plan,planHash:digest(plan),state:'prepared'};
  if(BSON.calculateObjectSize(journal)>512*1024)fail('Settlement exceeds the retained-original limit');
  try{await journals.insertOne(journal);}catch(error){if(error.code!==11000)throw error;const saved=await current(key);if(!same(saved.request,request))fail('Original settlement request differs');}
  return resume(context,id);
 }
 async function replace(collection,before,after){
  if((await collection.replaceOne(exact(before),after)).matchedCount)return;
  if(!same(await collection.findOne({_id:before._id}),after))fail('Original settlement record changed; retain the request for review');
 }
 async function release(journal){
  // Completion is durable before release; historical saved results never rewrite
  // records changed by a later request once their original lock has gone.
  const releases=[...journal.plan.effects.map(e=>({collection:sales,row:e.saleAfter})),
   {collection:customers,row:{...journal.plan.customer,balance:journal.plan.balance,updated_date:journal.plan.startedAt}}];
  for(const entry of releases){const row=await entry.collection.findOne({_id:entry.row._id});
   if(!same(row?.wallet_entry_lock,lock(journal)))continue;
   if(!same(row,held(entry.row,journal)))fail('Completed settlement changed before reservation release');
   if(!(await entry.collection.replaceOne(exact(row),entry.row)).matchedCount){const latest=await entry.collection.findOne({_id:row._id});if(same(latest?.wallet_entry_lock,lock(journal)))fail('Retry original settlement release');}
  }
 }
 async function resume(context,id){
  const key=scope(context,id);let journal=await current(key);
  if(journal.state==='completed'){await release(journal);return journal.result;}
  const plan=journal.plan;
  if(journal.state==='prepared'){
   await replace(customers,plan.customer,held(plan.customer,journal));
   for(const effect of plan.effects)await replace(sales,effect.sale,held(effect.sale,journal));
   if(!same(await rows(key),plan.baseline))fail('Ledger changed before settlement admission');
   await journals.updateOne({_id:id,state:'prepared',planHash:journal.planHash},{$set:{state:'applying'}});
   journal=await current(key);
  }
  if(journal.state==='completed'){await release(journal);return journal.result;}
  const expected=plan.baseline.map(row=>plan.effects.find(effect=>same(effect.allocation._id,row._id))?.allocationAfter||row);
  // Allow only exact before/after allocations while resuming partial effects.
  const observed=await rows(key);
  if(observed.length!==plan.baseline.length||observed.some(row=>{
   const effect=plan.effects.find(e=>same(e.allocation._id,row._id));
   return effect?!same(row,effect.allocation)&&!same(row,effect.allocationAfter):!same(row,plan.baseline.find(old=>same(old._id,row._id)));
  }))fail('Ledger changed during settlement; retain the original request');
  for(const effect of plan.effects){
   await replace(sales,held(effect.sale,journal),held(effect.saleAfter,journal));
   await replace(ledger,effect.allocation,effect.allocationAfter);
  }
  if(!same(await rows(key),sorted(expected)))fail('Settlement ledger verification failed');
  const customerAfter={...plan.customer,balance:plan.balance,updated_date:plan.startedAt};
  await replace(customers,held(plan.customer,journal),held(customerAfter,journal));
  const result=savedResult(journal);
  await journals.updateOne({_id:id,state:'applying',planHash:journal.planHash},{$set:{state:'completed',result}});
  journal=await current(key);if(journal.state!=='completed'||!same(journal.result,result))fail('Settlement completion requires review');
  await release(journal);return journal.result;
 }
 return {submit,status,resume};
}
module.exports={create};
