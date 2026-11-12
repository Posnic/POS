"use strict";
// Internal standalone-Mongo projection. No normal payment route enables it yet.
const {ObjectId,BSON}=require('mongodb'),{createHash}=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const journal=require('./books-receipt-journal'),salesModule=require('./books-receipt-sale'),Money=require('../utils/currency');
const fail=m=>{throw Object.assign(new Error(m),{status:409});},wc={w:1,j:true};
const key=v=>BSON.EJSON.stringify(v,{relaxed:false});
const digest=rows=>createHash('sha256').update(key([...rows].sort((a,b)=>key(a._id).localeCompare(key(b._id))))).digest('hex');
const exact=(value,currency)=>{if(!['number','string'].includes(typeof value)||String(value).trim()==='')fail('Customer ledger amount is missing');const n=Money.toMinor(value,currency);if(!Number.isSafeInteger(n)||Money.fromMinor(n,currency)!==Number(value))fail('Customer ledger amount is not exact');return n;};
function create({db}){
 const commands=journal.create({db}),sales=salesModule.create({db}),customers=db.collection('customers'),transactions=db.collection('transaction');
 async function execute(context,id,cmd,reserveOnly=false){
  const c=await commands.outcome(context,id,cmd);if(!c||!(reserveOnly?['prepared']:['accepted','projected']).includes(c.state))fail('Recover the original receipt first');if(reserveOnly)await sales.reserve(context,id,cmd);else await sales.apply(context,id,cmd);
  const b=c.review.values.basis,r=c.receipt||{id:createHash('sha256').update(JSON.stringify([context.authority,id,cmd])).digest('hex')},currency={currencyCode:b.currencyCode,currencyDigits:b.currencyDigits};
  const sale=await db.collection('sales').findOne({_id:b.sourceId.kind==='objectId'?new ObjectId(b.sourceId.value):b.sourceId.value,license:journal.licenseValue(context)});
  if(!sale||sale.books_receipt_lock?.commandId!==cmd||sale.books_receipt_lock?.authority!==context.authority)fail('Original sale is not reserved');
  const original=JSON.parse(sale.books_receipt_lock.sourceJson),ref=original.customerReferences?.customerId;
  if(!ref){if(original.customerReferences?.legacyCustomer)fail('Legacy customer identity needs review');return {receiptId:r.id,required:false};}
  if(!['objectId','string'].includes(ref.kind)||!ObjectId.isValid(ref.value))fail('Original customer identity needs review');
  const customerId=new ObjectId(ref.value),scope={customer_id:customerId,license:journal.licenseValue(context),branch_id:sale.branch_id},customerQuery={_id:customerId,license:journal.licenseValue(context),branch_id:sale.branch_id};
  const identity={version:1,journalId:id,commandId:cmd,receiptId:r.id,authority:context.authority,reviewHash:c.review.reviewHash};

  const rows=async()=>{const result=await transactions.find(scope).limit(10001).toArray();if(result.length>10000)fail('Customer ledger needs a paged review');return result;};
  const balance=entries=>{let n=0n;for(const row of entries){if(!['in','out'].includes(row.type))fail('Customer ledger direction needs review');const amount=exact(row.amount,currency);if(amount<0)fail('Customer ledger amount needs review');n+=BigInt(amount)*(row.type==='in'?1n:-1n);}if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))fail('Customer balance is too large');return Money.fromMinor(Number(n),currency);};
  for(let attempt=0;attempt<12;attempt++){
   const customer=await customers.findOne(customerQuery);if(!customer)fail('Original customer is unavailable');if(Object.hasOwn(customer,'customer_ledger_lock'))fail('Check the unfinished customer transaction before continuing');if(Object.hasOwn(customer,'legacy_wallet_settlement_lock'))fail('Check the unfinished customer wallet settlement before continuing');if(Object.hasOwn(customer,'legacy_invoice_payment_lock'))fail('Check the unfinished POS customer payment before continuing');let lock=customer.books_receipt_lock;
   if(!lock){
    const before=await rows(),own=await transactions.find({sale_id:sale._id,license:journal.licenseValue(context)}).limit(2).toArray();if(own.length>1||own.some(row=>!equal(row.customer_id,customerId)||!equal(row.branch_id,sale.branch_id)))fail('Sale allocation is ambiguous');
    const wallet=exact(original.values.wallet_amount??0,currency);
    if(own.length&&(own[0].type!=='out'||exact(own[0].amount,currency)!==wallet||exact(own[0].pending,currency)!==Number(b.pendingMinor)))fail('Original sale allocation differs');
    if(!own.length&&wallet!==0)fail('Original wallet allocation is missing');
    if(exact(customer.balance,currency)!==exact(balance(before),currency))fail('Customer balance needs reconciliation');
    lock={identity,beforeHash:digest(before),own:own[0]||null,balance:customer.balance};
    const saved=await customers.updateOne({...customerQuery,$expr:{$eq:['$$ROOT',{$literal:customer}]}},{$set:{books_receipt_lock:lock}},{writeConcern:wc});if(!saved.matchedCount)continue;
   }
   if(!equal(lock.identity,identity))fail('Another receipt owns this customer');
   if(reserveOnly){
    const latest=await commands.outcome(context,id,cmd);
    if(latest.state==='stopped'){await customers.updateOne({...customerQuery,books_receipt_lock:lock},{$unset:{books_receipt_lock:''}},{writeConcern:wc});fail('This payment request was stopped');}
    if(latest.state!=='prepared')fail('Payment acceptance changed; recover the original');
    if(digest(await rows())!==lock.beforeHash||customer.balance!==lock.balance)fail('Customer ledger changed before acceptance');
    return {identity,required:true};
   }

  const received={_id:'books-receipt:'+r.id,...scope,sale_id:'',customer_name:String(sale.customer_name||''),customer_phone:String(sale.customer_phone||''),branch_name:String(sale.branch_name||''),amount:Money.fromMinor(Number(r.amountMinor),currency),type:'in',pending:0,description:'Invoice payment'+(r.method?' - '+r.method:''),transaction_image:'',date:new Date(r.at),created_date:new Date(r.at),updated_date:new Date(r.at),invoice_id:sale.source_invoice_id,books_receipt_effect:identity};
   const allocation={...(lock.own||{_id:'books-allocation:'+id,...scope,sale_id:sale._id,customer_name:String(sale.customer_name||''),transaction_image:'category.svg',sale_total:Money.fromMinor(Number(b.totalMinor),currency),description:'Add sale',date:new Date(r.at),created_date:new Date(r.at)}),amount:Money.fromMinor(exact(original.values.wallet_amount??0,currency)+Number(r.amountMinor),currency),pending:Money.fromMinor(Number(r.pendingMinor),currency),type:'out',updated_date:new Date(r.at),books_receipt_effect:identity};
   const allocations=await transactions.find({sale_id:sale._id,license:journal.licenseValue(context)}).limit(2).toArray();if(allocations.length>1||allocations.some(row=>!equal(row._id,allocation._id)||!equal(row.customer_id,customerId)||!equal(row.branch_id,sale.branch_id)))fail('Sale allocation is ambiguous');
   const current=await rows(),money=current.find(row=>equal(row._id,received._id)),own=current.find(row=>equal(row._id,allocation._id));
   if(money&&!equal(money,received))fail('Received money differs from its original');
   if(own&&!equal(own,lock.own)&&!equal(own,allocation))fail('Sale allocation differs from its original');
   if(lock.own&&!own)fail('Original sale allocation is missing');
   const baseline=current.filter(row=>!equal(row._id,received._id)&&!equal(row._id,allocation._id));if(lock.own)baseline.push(lock.own);
   if(digest(baseline)!==lock.beforeHash)fail('Customer ledger changed during receipt recovery');
   if(!money){try{await transactions.insertOne(received,{writeConcern:wc});}catch(e){if(e.code!==11000)throw e;}continue;}
   if(!equal(own,allocation)){
    if(lock.own){await transactions.replaceOne({_id:lock.own._id,...scope,$expr:{$eq:['$$ROOT',{$literal:lock.own}]}},allocation,{writeConcern:wc});}
    else{try{await transactions.insertOne(allocation,{writeConcern:wc});}catch(e){if(e.code!==11000)throw e;}}
    continue;
   }
   const target=balance(current),effect={...identity,balance:target};
   if(customer.books_receipt_effect?.receiptId===r.id){if(!equal(customer.books_receipt_effect,effect)||customer.balance!==target)fail('Applied customer balance changed');return effect;}
   if(customer.balance!==lock.balance)fail('Customer balance changed during receipt recovery');
   const saved=await customers.updateOne({...customerQuery,$expr:{$eq:['$$ROOT',{$literal:customer}]}},{$set:{balance:target,updated_date:new Date(r.at),books_receipt_effect:effect}},{writeConcern:wc});if(saved.matchedCount)return effect;
  }
  fail('Customer changed; recover the original receipt');
 }
 return {reserve:(context,id,cmd)=>execute(context,id,cmd,true),apply:(context,id,cmd)=>execute(context,id,cmd),async release(context,id,cmd){
  const c=await commands.outcome(context,id,cmd);if(!c||!['stopped','projected'].includes(c.state))fail('Finish or stop the original receipt first');
  const query={license:journal.licenseValue(context),'books_receipt_lock.identity.journalId':id,'books_receipt_lock.identity.commandId':cmd,'books_receipt_lock.identity.authority':context.authority};
  const found=await customers.find(query).limit(2).toArray();if(found.length>1)fail('Customer reservation is ambiguous');if(!found.length)return;
  const customer=found[0],lock=customer.books_receipt_lock;if(String(customer.branch_id)!==context.branchId||lock.identity.reviewHash!==c.review.reviewHash)fail('Customer reservation changed');
  if(c.state==='projected'&&(customer.books_receipt_effect?.receiptId!==c.receipt.id||customer.books_receipt_effect?.reviewHash!==c.review.reviewHash||customer.balance!==customer.books_receipt_effect.balance))fail('Customer receipt is incomplete');
  if(!(await customers.updateOne({_id:customer._id,...query,books_receipt_lock:lock},{$unset:{books_receipt_lock:''}},{writeConcern:wc})).matchedCount&&await customers.findOne({_id:customer._id,...query}))fail('Customer reservation changed');
 }};
}
module.exports={create};
