'use strict';
// Capture deterministic document mirrors alongside a wallet settlement plan.
// Printed totals, lines, tax, terms and existing payment notes remain originals.
const {ObjectId}=require('mongodb');
const {canonical}=require('./invoice-payment-effects');
const same=(a,b)=>canonical(a)===canonical(b);
const fail=message=>{throw Object.assign(new Error(message),{code:'wallet_settlement_conflict'});};
function available(row){
 if(row.is_deleted===true||['wallet_entry_lock','books_receipt_lock','legacy_invoice_payment_lock','invoice_issue_lock'].some(key=>Object.hasOwn(row,key)))
  fail('Original document has an unfinished operation');
}
async function capture(db,sale,paid,at){
 const documents=[],wall={license:sale.license,branch_id:sale.branch_id};let quoteId=sale.source_quote_id;
 if(sale.source_invoice_id){
  if(!ObjectId.isValid(String(sale.source_invoice_id)))fail('Original invoice identity differs');
  const invoice=await db.collection('invoices').findOne({_id:new ObjectId(String(sale.source_invoice_id)),...wall});
  if(!invoice||!['unpaid','partial'].includes(invoice.status)||String(invoice.sale_id)!==String(sale._id)||
     (invoice.customer_id&&String(invoice.customer_id)!==String(sale.customer_id)))fail('Original invoice link differs');
  available(invoice);
  if(invoice.paid_amount!==sale.partial_balance||invoice.balance!==sale.payment_pending||
     (Object.hasOwn(invoice,'sale_total')&&invoice.sale_total!==sale.sales_total))fail('Invoice payment mirror differs from its sale');
  if(quoteId&&invoice.source_quote_id&&String(quoteId)!==String(invoice.source_quote_id))fail('Original quotation links differ');
  quoteId=invoice.source_quote_id||quoteId;
  const after={...invoice,status:'paid',sale_total:sale.sales_total,paid_amount:paid,balance:0,
   sale_number:String(sale.sales_id||invoice.sale_number||'').slice(0,40),sale_payment_status:'Paid',synced_date:at,updated_date:at};
  if(!invoice.paid_date)after.paid_date=at;
  documents.push({collection:'invoices',before:invoice,after});
 }
 if(quoteId){
  if(!ObjectId.isValid(String(quoteId)))fail('Original quotation identity differs');
  const quote=await db.collection('quotes').findOne({_id:new ObjectId(String(quoteId)),...wall});
  if(!quote||!['open','draft','sent','accepted','invoiced','converted'].includes(quote.status)||
     (quote.customer_id&&String(quote.customer_id)!==String(sale.customer_id))||
     (quote.converted_sale_id&&String(quote.converted_sale_id)!==String(sale._id)))fail('Original quotation link differs');
  if((quote.invoice_id&&String(quote.invoice_id)!==String(sale.source_invoice_id))||(quote.status==='invoiced'&&!quote.invoice_id))fail('Original quotation invoice link differs');
  available(quote);
  if(quote.status==='converted'&&String(quote.converted_sale_id)!==String(sale._id))fail('Original quotation conversion differs');
  const after=quote.status==='converted'?quote:{...quote,status:'converted',converted_sale_id:sale._id,converted_date:at,updated_date:at};
  documents.push({collection:'quotes',before:quote,after});
 }
 for(const document of documents)if(!same(document.before.license,sale.license)||!same(document.before.branch_id,sale.branch_id))fail('Original document scope differs');
 return documents;
}
module.exports={capture};
