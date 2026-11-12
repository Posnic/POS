'use strict';
const {ObjectId,BSON}=require('mongodb'),{randomUUID,createHash}=require('node:crypto'),Money=require('../utils/currency'),equal=require('node:util').isDeepStrictEqual;
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const available=()=>({books_receipt_lock:{$exists:false},legacy_invoice_payment_lock:{$exists:false},legacy_wallet_settlement_lock:{$exists:false},customer_ledger_lock:{$exists:false}});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>JSON.stringify(canonical(BSON.EJSON.serialize(value,{relaxed:false})));
const fingerprint=rows=>createHash('sha256').update(encode([...rows].sort((a,b)=>encode(a._id).localeCompare(encode(b._id))))).digest('hex');
async function change({customers,transactions,customer,record,existing,actor=''}){
 if(!customer)fail('Customer not found');
 if(Boolean(record)===Boolean(existing))fail('Choose one customer transaction');
 const scope={customer_id:customer._id,license:customer.license},policy=Money.policy(customer);
 const exact=value=>{if(!['number','string'].includes(typeof value)||String(value).trim()==='')fail('Enter a valid wallet amount');const n=Money.toMinor(value,policy);if(!Number.isSafeInteger(n)||Money.fromMinor(n,policy)!==Number(value))fail('Enter an exact wallet amount');return n;};
 const protectedRow=row=>Boolean(row.sale_id||row.invoice_id)||Object.keys(row).some(k=>k.startsWith('books_receipt_')||k.startsWith('legacy_invoice_payment_')||k.startsWith('legacy_wallet_settlement_'));
 const row=record?{...record,_id:record._id||new ObjectId()}:existing;
 if(!equal(row.customer_id,customer._id)||!equal(row.license,customer.license)||protectedRow(row))fail('Use the original sale or invoice workflow for this transaction');
 if(!['in','out'].includes(row.type)||exact(row.amount)<=0)fail('Enter a positive wallet amount and choose money in or out');
 if(record&&(!(record.date instanceof Date)||!Number.isFinite(record.date.getTime())))fail('Enter a valid transaction date');
 const read=async()=>{const rows=await transactions.find(scope).limit(10001).toArray();if(rows.length>10000)fail('Customer ledger needs a paged review');return rows;};
 const balance=rows=>{let result=0;for(const entry of rows){if(!['in','out'].includes(entry.type)||exact(entry.amount)<0)fail('Customer ledger needs review');result+=(entry.type==='in'?1:-1)*exact(entry.amount);if(!Number.isSafeInteger(result))fail('Customer ledger amount is too large');}return result;};
 const before=await read(),beforeBalance=balance(before);if(beforeBalance!==exact(customer.balance))fail('Customer wallet needs reconciliation');
 if(existing&&!before.some(entry=>equal(entry,existing)))fail('The transaction changed; reopen the customer wallet');
 const expected=record?[...before,row]:before.filter(entry=>!equal(entry._id,row._id)),afterBalance=balance(expected);
 if(afterBalance<0)fail('This credit has already been used or the wallet balance is insufficient');
 const operation={version:1,id:randomUUID(),kind:record?'add':'delete',transaction:row,actor:String(actor),at:new Date(),beforeHash:fingerprint(before),balanceBefore:customer.balance,balanceAfter:Money.fromMinor(afterBalance,policy)};
 let started=false;
 try{
  const claimed=await customers.updateOne({_id:customer._id,license:customer.license,...available(),$expr:{$eq:['$$ROOT',{$literal:customer}]}},{$set:{customer_ledger_lock:operation}},{writeConcern:{w:1,j:true}});
  if(!claimed.matchedCount)fail('Check the unfinished customer payment before changing wallet money');
  if(fingerprint(await read())!==operation.beforeHash)fail('Customer ledger changed before the operation');
  started=true;
  if(record)await transactions.insertOne(row,{writeConcern:{w:1,j:true}});
  else if(!(await transactions.deleteOne({_id:row._id,...scope,$expr:{$eq:['$$ROOT',{$literal:row}]}},{writeConcern:{w:1,j:true}})).deletedCount)fail('The transaction changed; check the original result');
  if(fingerprint(await read())!==fingerprint(expected))fail('Customer ledger changed; check the original result');
  const completed=await customers.updateOne({_id:customer._id,license:customer.license,customer_ledger_lock:operation,balance:customer.balance},{$set:{balance:operation.balanceAfter,updated_date:new Date(),customer_ledger_result:{...operation,state:'completed'}},$unset:{customer_ledger_lock:''}},{writeConcern:{w:1,j:true}});
  if(!completed.matchedCount)fail('Customer wallet completion needs recovery');
  return operation.balanceAfter;
 }catch(error){
  if(!started)await customers.updateOne({_id:customer._id,license:customer.license,'customer_ledger_lock.id':operation.id},{$unset:{customer_ledger_lock:''}},{writeConcern:{w:1,j:true}});
  throw error;
 }
}
module.exports={change};
