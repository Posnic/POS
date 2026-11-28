'use strict';
const {BSON}=require('mongodb');
const {createHash}=require('node:crypto');
const order=v=>Array.isArray(v)?v.map(order):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(order(BSON.EJSON.serialize(v,{relaxed:false})))).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{code:'books_receipt_customer_conflict',status:409});};
function minor(v){
 if(!['string','number'].includes(typeof v)||!/^[-]?(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(v)))fail('Customer ledger amount invalid');
 const negative=String(v).startsWith('-'),[whole,fraction='']=(negative?String(v).slice(1):String(v)).split('.');
 const n=(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(negative?-1n:1n);
 if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))fail('Customer ledger amount exceeds precision');return n;
}
function money(v){const n=Number(v)/100;if(minor(n)!==BigInt(v))fail('Customer ledger precision differs');return n;}
const fields=['_id','license','branch_id','customer_id','sale_id','type','amount','pending','books_receipt_id'];
const selected=row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
const sorted=rows=>rows.map(selected).sort((a,b)=>hash(a._id).localeCompare(hash(b._id)));
const exact=row=>({_id:row._id,$expr:{$eq:['$$ROOT',{$literal:row}]}});
function create({db}){
 const customers=db.collection('customers'),transactions=db.collection('transaction');
 const sales=require('./books-receipt-sale').create({db}),journal=require('./books-receipt-journal').create({db});
 const scope=sale=>({license:sale.license,branch_id:sale.branch_id,customer_id:sale.customer_id});
 const customerQuery=sale=>({_id:sale.customer_id,license:sale.license,branch_id:sale.branch_id});
 const owns=(customer,state)=>customer.books_receipt_lock?.journalId===state.review.journalId&&customer.books_receipt_lock?.commandId===state.commandId&&customer.books_receipt_lock?.reviewHash===state.review.reviewHash;
 async function ledger(sale){
  const rows=await transactions.find(scope(sale)).limit(10001).toArray();
  if(rows.length>10000)fail('Customer ledger exceeds review limit');
  for(const row of rows)if(!['in','out'].includes(row.type)||minor(row.amount)<0n)fail('Customer ledger amount invalid');
  return rows;
 }
 function balance(rows){return rows.reduce((n,row)=>n+(row.type==='in'?minor(row.amount):-minor(row.amount)),0n);}
 function original(customer,state){
  if(!customer||!owns(customer,state))fail('Another receipt owns this customer');
  const lock=customer.books_receipt_lock;
  if(hash(sorted(lock.baseline))!==lock.baselineHash||String(balance(lock.baseline))!==lock.balanceMinor)fail('Original customer ledger changed');
  return lock;
 }
 async function releaseStopped(context,id,commandId){
  const state=await journal.outcome(context,id,commandId);
  if(state.state!=='stopped'||state.review.values.actor.id!==context.actorId)fail('Only the original stopped receipt can release customer admission');
  const held=await customers.find({'books_receipt_lock.journalId':id,'books_receipt_lock.commandId':commandId,license:context.license}).limit(2).toArray();
  if(held.length>1)fail('Customer reservation identity differs');
  for(const customer of held){
   original(customer,state);
   if(customer.books_receipt_effect?.commandId===commandId&&customer.books_receipt_effect?.journalId===id)fail('Applied customer receipt cannot be released');
   if(!(await customers.updateOne(exact(customer),{$unset:{books_receipt_lock:''}})).matchedCount){
    const latest=await customers.findOne({_id:customer._id});if(latest&&owns(latest,state))fail('Customer changed during release; retry recovery');
   }
  }
 }
 return {
  releaseStopped,
  async releaseCompleted(context,id,commandId){
   const state=await journal.outcome(context,id,commandId);
   if(state.state!=='projected'||!state.effects)fail('Verified completion required');
   if(state.effects.customer.required===false)return;
   const held=await customers.find({'books_receipt_lock.journalId':id,'books_receipt_lock.commandId':commandId,license:context.license}).limit(2).toArray();
   if(held.length>1)fail('Customer release identity differs');
   for(const customer of held){
    original(customer,state);
    const saleScope={license:customer.license,branch_id:customer.branch_id,customer_id:customer._id};
    if(hash(customer.books_receipt_effect)!==hash(state.effects.customer)||minor(customer.balance)!==BigInt(state.effects.customer.balanceMinor)||
       hash(sorted(await ledger(saleScope)))!==state.effects.customer.ledgerHash)fail('Completed customer ledger changed');
    if(!(await customers.updateOne(exact(customer),{$unset:{books_receipt_lock:''}})).matchedCount){const latest=await customers.findOne({_id:customer._id});if(latest&&owns(latest,state))fail('Customer release changed; retry recovery');}
   }
  },
  async reserve(context,id,commandId){
   for(let i=0;i<10;i++){
    const {state,sale}=await sales.verifyReserved(context,id,commandId);
    if(sale.customer_id==null)return {required:false};
    const customer=await customers.findOne(customerQuery(sale));if(!customer)fail('Original customer unavailable');
    if(Object.hasOwn(customer,'wallet_entry_lock'))fail('Customer has an unfinished wallet request');
    if(customer.legacy_invoice_payment_lock)fail('Customer has an unfinished invoice payment');
    const rows=await ledger(sale),baseline=sorted(rows),baselineHash=hash(baseline);
    if(customer.books_receipt_lock){const lock=original(customer,state);if(lock.baselineHash!==baselineHash||minor(customer.balance)!==BigInt(lock.balanceMinor))fail('Customer ledger changed');return lock;}
    const own=rows.filter(row=>hash(row.sale_id)===hash(sale._id));
    if(own.length>1||(own.length&&(own[0].type!=='out'||minor(own[0].amount)!==BigInt(state.review.values.basis.paidMinor)||minor(own[0].pending)!==BigInt(state.review.values.basis.pendingMinor)))||(!own.length&&state.review.values.basis.paidMinor!=='0'))fail('Original customer allocation differs');
    if(balance(rows)!==minor(customer.balance))fail('Customer balance differs from original ledger');
    if(Buffer.byteLength(JSON.stringify(order(BSON.EJSON.serialize(baseline))))>512*1024)fail('Customer ledger exceeds review limit');
    const lock={journalId:id,commandId,reviewHash:state.review.reviewHash,baseline,baselineHash,balanceMinor:String(balance(rows)),allocationId:own[0]?own[0]._id:null};
    if(!(await customers.updateOne(exact(customer),{$set:{books_receipt_lock:lock}})).matchedCount)continue;
    if((await journal.outcome(context,id,commandId)).state==='stopped'){await releaseStopped(context,id,commandId);fail('Receipt stopped');}
    return lock;
   }
   fail('Customer changed while reserving');
  },
  async verifyReserved(context,id,commandId){
   const {state,sale}=await sales.verifyReserved(context,id,commandId);if(sale.customer_id==null)return {required:false};
   const customer=await customers.findOne(customerQuery(sale)),lock=original(customer,state);
   if(hash(sorted(await ledger(sale)))!==lock.baselineHash||minor(customer.balance)!==BigInt(lock.balanceMinor))fail('Customer ledger changed');return lock;
  },
  async verify(context,id,commandId){return create({db}).apply(context,id,commandId,true);},
  async apply(context,id,commandId,verifyOnly=false){
   for(let i=0;i<15;i++){
    const {state,sale}=await sales.verifyApplied(context,id,commandId);if(sale.customer_id==null)return {required:false};
    const customer=await customers.findOne(customerQuery(sale)),lock=original(customer,state),receipt=state.receipt;
    const incoming={_id:hash([receipt.id,'money']),...scope(sale),sale_id:'',type:'in',amount:money(receipt.amountMinor),pending:0,books_receipt_id:receipt.id};
    const allocationId=lock.allocationId??hash([receipt.id,'allocation']);
    const previous=lock.baseline.find(row=>hash(row._id)===hash(allocationId));
    const allocation={...(previous||{_id:allocationId,...scope(sale),sale_id:sale._id}),type:'out',amount:money(receipt.paidMinor),pending:money(receipt.pendingMinor)};
    const withMoney=sorted([...lock.baseline,incoming]);
    const final=sorted([...lock.baseline.filter(row=>hash(row._id)!==hash(allocationId)),incoming,allocation]);
    const current=await ledger(sale),currentHash=hash(sorted(current)),finalHash=hash(final);
    if(minor(customer.balance)!==BigInt(lock.balanceMinor))fail('Customer balance changed');
    if(verifyOnly&&currentHash!==finalHash)fail('All payment effects must be applied before completion');
    if(currentHash===lock.baselineHash){
     try{await transactions.insertOne({...incoming,date:new Date(receipt.at),created_date:new Date(receipt.at),updated_date:new Date(receipt.at),invoice_id:sale.source_invoice_id});}catch(e){if(e.code!==11000)throw e;}
     continue;
    }
    if(currentHash===hash(withMoney)){
     const old=current.find(row=>hash(row._id)===hash(allocationId));
     if(old)await transactions.updateOne(exact(old),{$set:{amount:allocation.amount,pending:allocation.pending,type:'out',updated_date:new Date(receipt.at)}});
     else try{await transactions.insertOne({...allocation,date:new Date(receipt.at),created_date:new Date(receipt.at),updated_date:new Date(receipt.at)});}catch(e){if(e.code!==11000)throw e;}
     continue;
    }
    if(currentHash!==finalHash)fail('Customer ledger changed or allocation differs');
    const effect={journalId:id,commandId,receiptId:receipt.id,ledgerHash:finalHash,balanceMinor:lock.balanceMinor};
    if(customer.books_receipt_effect?.receiptId===receipt.id){if(hash(customer.books_receipt_effect)!==hash(effect))fail('Customer effect differs');return effect;}
    if(verifyOnly)fail('All payment effects must be applied before completion');
    if((await customers.updateOne(exact(customer),{$set:{balance:money(lock.balanceMinor),books_receipt_effect:effect,updated_date:new Date(receipt.at)}})).matchedCount)return effect;
   }
   fail('Customer receipt busy; retry original recovery');
  }
 };
}
module.exports={create};
