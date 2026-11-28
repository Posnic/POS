'use strict';
// Deterministic projections for an already admitted ordinary invoice payment.
const fail=()=>{throw new Error('Original payment effect differs; recover the original request');};
function cents(value){
 if(!['string','number'].includes(typeof value)||!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(value)))fail();
 const [whole,fraction='']=String(value).split('.'),n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(n>BigInt(Number.MAX_SAFE_INTEGER))fail();return n;
}
function money(value){const n=Number(value)/100;if(cents(n)!==value)fail();return n;}
const exact=row=>({_id:row._id,$expr:{$eq:['$$ROOT',{$literal:row}]}});
function existing(row,id){
 const effects=row.legacy_invoice_payment_effects||[];
 if(!Array.isArray(effects)||effects.length>1000)fail();
 const found=effects.filter(value=>value.id===id);if(found.length>1)fail();
 return {effects,found:found[0]};
}
function same(a,b){return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([k,v])=>b[k]===v);}
async function allocation(collection,scope,admission){
 const amount=cents(admission.amount),before=cents(admission.before.paid_amount),pending=money(cents(admission.before.balance)-amount);
 const effect={id:admission.id,amount:money(amount),before:money(before),after:money(before+amount),pending};
 for(let i=0;i<10;i++){
  const row=await collection.findOne(scope);if(!row)fail();
  const {effects,found}=existing(row,admission.id);
  if(found){if(!same(found,effect)||cents(row.amount)!==before+amount||cents(row.pending)!==cents(pending)||row.type!=='out')fail();return effect;}
  if(effects.length===1000||row.type!=='out'||cents(row.amount)!==before||cents(row.pending)!==cents(admission.before.balance))fail();
  const result=await collection.updateOne(exact(row),{$inc:{amount:admission.amount},$set:{pending,type:'out',updated_date:admission.startedAt},$push:{legacy_invoice_payment_effects:effect}});
  if(result.matchedCount)return effect;
 }
 fail();
}
async function sale(collection,saleId,admission,saleSet,withCustomer){
 const paid=cents(admission.before.paid_amount)+cents(admission.amount),pending=cents(admission.before.balance)-cents(admission.amount);
 const wallet=cents(admission.walletBefore??0)+(withCustomer?cents(admission.amount):0n);
 const effect={id:admission.id,amount:admission.amount,paid:money(paid),pending:money(pending),wallet:money(wallet),withCustomer};
 if(cents(saleSet.partial_balance)!==paid||cents(saleSet.payment_pending)!==pending||
    saleSet.payment_status!==(pending===0n?'Paid':'Partialy Paid')||saleSet.updated_by!==admission.actor||
    !(saleSet.updated_date instanceof Date)||saleSet.updated_date.getTime()!==new Date(admission.startedAt).getTime())fail();
 const binding=value=>JSON.stringify([value.id,value.amount,value.invoiceId,value.walletBefore,value.actor,
  new Date(value.startedAt).toISOString(),value.before?.paid_amount,value.before?.balance,value.before?.total]);
 for(let i=0;i<10;i++){
  const row=await collection.findOne({_id:saleId,'legacy_invoice_payment_lock.id':admission.id});if(!row?.legacy_invoice_payment_lock||binding(row.legacy_invoice_payment_lock)!==binding(admission))fail();
  const {effects,found}=existing(row,admission.id);
  if(found){if(!same(found,effect)||cents(row.partial_balance)!==paid||cents(row.payment_pending)!==pending||(withCustomer&&cents(row.wallet_amount)!==wallet))fail();return effect;}
  if(effects.length===1000||cents(row.partial_balance??0)!==cents(admission.before.paid_amount)||cents(row.payment_pending)!==cents(admission.before.balance)||
     (withCustomer&&cents(row.wallet_amount??0)!==cents(admission.walletBefore??0)))fail();
  const result=await collection.updateOne(exact(row),{$set:saleSet,...(withCustomer?{$inc:{wallet_amount:admission.amount}}:{}),$push:{legacy_invoice_payment_effects:effect}});
  if(result.matchedCount)return effect;
 }
 fail();
}
module.exports={allocation,sale};
