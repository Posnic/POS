'use strict';
const {ObjectId}=require('mongodb'),{randomUUID}=require('node:crypto');
const Money=require('../utils/currency');
const fail=message=>{throw new Error(message);},wc={w:1,j:true};
const available=()=>({books_receipt_lock:{$exists:false},books_receipt_owner:{$exists:false},legacy_invoice_payment_lock:{$exists:false},legacy_wallet_settlement_lock:{$exists:false}});
const exact=(value,policy)=>{if(!['string','number'].includes(typeof value)||String(value).trim()==='')fail('Reopen the customer wallet to review the amounts');const n=Money.toMinor(value,policy);if(!Number.isSafeInteger(n)||n<0||Money.fromMinor(n,policy)!==Number(value))fail('Reopen the customer wallet to review the amounts');return n;};
async function settle(db,data,{guard,mirror}){
 const sales=db.collection('sales'),customers=db.collection('customers'),transactions=db.collection('transaction');
 if(!Array.isArray(data.sales)||!data.sales.length||data.sales.length>100||!ObjectId.isValid(String(data.id)))fail('Select a customer and the sales to settle');
 if(!data.branch_id||!ObjectId.isValid(String(data.branch_id))||!data.license)fail('The customer branch is unavailable');
 const branch=new ObjectId(String(data.branch_id)),customerId=new ObjectId(String(data.id)),scope={license:data.license,branch_id:branch},customerQuery={_id:customerId,...scope};
 const customer=await customers.findOne(customerQuery);if(!customer)fail('Customer not found');
 const operation={version:1,id:randomUUID(),kind:'wallet-settlement',at:new Date(),actor:String(data.loggedUserName||''),customerId};
 const plans=[],seen=new Set();let total=0,policy=null,started=false;
 for(const selected of data.sales){
  if(!ObjectId.isValid(String(selected.id))||seen.has(String(selected.id)))fail('Select each sale only once');seen.add(String(selected.id));
  const sale=await sales.findOne({_id:new ObjectId(String(selected.id)),...scope});
  if(!sale||String(sale.customer_id)!==String(customerId))fail('A selected sale does not belong to this customer');
  require('./books-receipt-sale').mutable(sale);
  await guard(db,sale);
  const currency=Money.policy(sale);if(policy&&(currency.currencyCode!==policy.currencyCode||currency.currencyDigits!==policy.currencyDigits))fail('Settle sales in the same currency');policy=currency;
  const due=exact(sale.payment_pending,policy),paid=exact(sale.partial_balance||0,policy),saleTotal=exact(sale.sales_total,policy),wallet=exact(sale.wallet_amount||0,policy);
  if(!due||!['Unpaid','Partialy Paid'].includes(sale.payment_status)||paid+due!==saleTotal||exact(selected.amount,policy)!==due||exact(selected.paidamount||0,policy)!==paid)fail('The sale balance changed; reopen the customer wallet');
  const rows=await transactions.find({sale_id:sale._id,license:data.license}).limit(2).toArray(),own=rows[0];
  if(rows.length>1||own&&(String(own.customer_id)!==String(customerId)||String(own.branch_id)!==String(branch)||own.type!=='out'||exact(own.amount,policy)!==wallet||exact(own.pending,policy)!==due)||!own&&wallet!==0)fail('The original sale allocation needs review');
  total+=due;if(!Number.isSafeInteger(total)||!Number.isSafeInteger(wallet+due))fail('The selected amount is too large');plans.push({sale,own,due,paid,wallet,saleTotal});
 }
 if(exact(customer.balance,policy)<total)fail('Not enough wallet balance');
 // Compare the actual ledger as well as its cached wallet balance before reserving it.
 const ledger=await transactions.find({customer_id:customerId,...scope}).limit(10001).toArray();if(ledger.length>10000)fail('This customer ledger needs a paged review');
 let ledgerBalance=0;for(const row of ledger){if(!['in','out'].includes(row.type))fail('Customer ledger direction needs review');ledgerBalance+=(row.type==='in'?1:-1)*exact(row.amount,policy);if(!Number.isSafeInteger(ledgerBalance))fail('Customer ledger amount is too large');}
 if(ledgerBalance!==exact(customer.balance,policy))fail('Customer wallet needs reconciliation');
 try{
  // Claim customer then every sale before the first financial change. Partial admission
  // is safe to undo; once writing starts an unknown result must retain its reservations.
  if(!(await customers.updateOne({...customerQuery,...available(),$expr:{$eq:['$$ROOT',{$literal:customer}]}},{$set:{legacy_wallet_settlement_lock:operation}},{writeConcern:wc})).matchedCount)fail('Another payment owns this customer; check its saved result');
  for(const p of plans){if(!(await sales.updateOne({_id:p.sale._id,...scope,...available(),captain_payment_plan:{$exists:false},$expr:{$eq:['$$ROOT',{$literal:p.sale}]}},{$set:{legacy_wallet_settlement_lock:operation}},{writeConcern:wc})).matchedCount)fail('A selected sale changed or another payment owns it');}
  started=true;
  for(const p of plans){
   const amount=Money.fromMinor(p.wallet+p.due,policy),now=new Date(),allocation=p.own?{...p.own,amount,pending:0,description:'Edit sale',updated_date:now}:{_id:new ObjectId(),...scope,customer_id:customerId,sale_id:p.sale._id,type:'out',amount,pending:0,sale_total:Money.fromMinor(p.saleTotal,policy),description:'Add sale',date:now,created_date:now,updated_date:now};
   if(p.own){if(!(await transactions.replaceOne({_id:p.own._id,...scope,$expr:{$eq:['$$ROOT',{$literal:p.own}]}},allocation,{writeConcern:wc})).matchedCount)fail('The sale allocation changed; check the saved settlement');}
   else await transactions.insertOne(allocation,{writeConcern:wc});
   if(!(await sales.updateOne({_id:p.sale._id,...scope,legacy_wallet_settlement_lock:operation},{$set:{partial_balance:Money.fromMinor(p.saleTotal,policy),payment_status:'Paid',payment_pending:0,wallet_amount:amount,floor_lifecycle:p.sale.floor_lifecycle===true||p.sale.sale_process==='KOT',kitchen_required:p.sale.kitchen_required===true||p.sale.sale_process==='KOT',updated_date:now,updated_by:String(data.loggedUserName||''),...(data.loggedUserId&&ObjectId.isValid(String(data.loggedUserId))?{updated_by_id:new ObjectId(String(data.loggedUserId))}:{})}},{writeConcern:wc})).matchedCount)fail('The sale reservation changed; check the saved settlement');
   if(p.sale.source_invoice_id){const result=await mirror(p.sale._id);if(!result?.synced)fail('Wallet was applied but the invoice needs recovery');}
  }
  const balance=Money.fromMinor(ledgerBalance-total,policy);
  if(!(await customers.updateOne({...customerQuery,legacy_wallet_settlement_lock:operation},{$set:{balance,legacy_wallet_settlement_result:{...operation,state:'completed',amount:Money.fromMinor(total,policy),balance}},$unset:{legacy_wallet_settlement_lock:''}},{writeConcern:wc})).matchedCount)fail('Customer wallet completion needs recovery');
  for(const p of plans){if(!(await sales.updateOne({_id:p.sale._id,...scope,legacy_wallet_settlement_lock:operation},{$set:{legacy_wallet_settlement_result:{...operation,state:'completed',amount:Money.fromMinor(p.due,policy)}},$unset:{legacy_wallet_settlement_lock:''}},{writeConcern:wc})).matchedCount)fail('Sale settlement completion needs recovery');}
  return {status:true,data:balance,message:'Sales settled successfully'};
 }catch(error){
  if(!started){
   await sales.updateMany({_id:{$in:plans.map(p=>p.sale._id)},...scope,'legacy_wallet_settlement_lock.id':operation.id},{$unset:{legacy_wallet_settlement_lock:''}},{writeConcern:wc});
   await customers.updateOne({...customerQuery,'legacy_wallet_settlement_lock.id':operation.id},{$unset:{legacy_wallet_settlement_lock:''}},{writeConcern:wc});
  }
  throw error;
 }
}
module.exports={settle};
