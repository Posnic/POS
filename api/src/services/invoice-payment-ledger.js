"use strict";
const {ObjectId,BSON}=require('mongodb');
const {canonical}=require('./invoice-payment-effects');
const fields=['_id','license','branch_id','customer_id','sale_id','type','amount','pending','legacy_invoice_payment_id','books_receipt_id'];
const select=row=>Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const fail=()=>{throw new Error('Original customer ledger changed; review the unfinished payment');};
function cents(value){
 if(!['number','string'].includes(typeof value)||! /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(value)))fail();
 const [whole,fraction='']=String(value).split('.'),n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(n>BigInt(Number.MAX_SAFE_INTEGER))fail();return n;
}
const scope=sale=>({license:sale.license,branch_id:sale.branch_id,customer_id:new ObjectId(String(sale.customer_id))});
async function read(db,sale){
 const rows=(await db.collection('transaction').find(scope(sale)).limit(10001).toArray()).map(select);
 if(rows.length>10000||BSON.calculateObjectSize({rows})>512*1024)fail();
 for(const row of rows){if(!['in','out'].includes(row.type))fail();cents(row.amount);}
 return rows;
}
function balance(rows){const n=rows.reduce((sum,row)=>sum+(row.type==='in'?cents(row.amount):-cents(row.amount)),0n);
 const result=Number(n)/100;if(!Number.isSafeInteger(Number(n)))fail();return result;
}
async function capture(db,sale,before){
 const rows=await read(db,sale),own=rows.filter(row=>canonical(row.sale_id)===canonical(sale._id));
 if(own.length>1||(!own.length&&cents(before.paid_amount)!==0n)||
    (own.length&&(own[0].type!=='out'||cents(own[0].amount)!==cents(before.paid_amount)||cents(own[0].pending)!==cents(before.balance))))fail();
 return {rows,balance:balance(rows)};
}
async function verify(db,sale,admission,complete=false){
 const baseline=admission.ledger;if(!baseline||!Array.isArray(baseline.rows)||balance(baseline.rows)!==baseline.balance)fail();
 const rows=await read(db,sale),expected=new Map(baseline.rows.map(row=>[canonical(row._id),row]));
 const own=baseline.rows.find(row=>canonical(row.sale_id)===canonical(sale._id));
 const allocation=own||{_id:admission.allocationId,...scope(sale),sale_id:sale._id,type:'out',amount:0,pending:admission.before.balance,legacy_invoice_payment_id:admission.id};
 const paid={...allocation,amount:Number(cents(admission.before.paid_amount)+cents(admission.amount))/100,pending:Number(cents(admission.before.balance)-cents(admission.amount))/100};
 const money={_id:admission.moneyId,...scope(sale),sale_id:'',type:'in',amount:admission.amount,pending:0,legacy_invoice_payment_id:admission.id};
 let sawMoney=false,sawPaid=false;
 for(const row of rows){
  const key=canonical(row._id);
  if(key===canonical(money._id)){if(canonical(row)!==canonical(money))fail();sawMoney=true;continue;}
  if(key===canonical(allocation._id)){
   sawPaid=canonical(row)===canonical(paid);
   if(!sawPaid&&canonical(row)!==canonical(allocation))fail();
   expected.delete(key);continue;
  }
  if(!expected.has(key)||canonical(row)!==canonical(expected.get(key)))fail();expected.delete(key);
 }
 if(expected.size||(complete&&(!sawMoney||!sawPaid)))fail();
 return balance(rows);
}
module.exports={capture,verify};
