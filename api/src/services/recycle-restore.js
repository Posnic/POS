'use strict';
const {isDeepStrictEqual:equal}=require('node:util');
const prefixes=['books_receipt_','legacy_invoice_payment_','legacy_wallet_settlement_'];
const protectedDocument=doc=>doc&&Object.keys(doc).some(key=>prefixes.some(prefix=>key.startsWith(prefix)));
const fail=message=>{throw new Error(message);};
async function restoreRecord({getCollection,backupCollection,backupName,doc,license}){
 const name=doc.document_name;
 if(typeof name!=='string'||!/^[a-z][a-z0-9_]{0,80}$/.test(name)||name===backupName||name==='books_receipt_journals')fail('This backup needs its original recovery workflow');
 if(doc.body_discarded===true||!doc._id||!equal(doc.license,license))fail('Backup is unavailable in this shop');
 if(protectedDocument(doc))fail('Payment recovery records cannot be restored through the recycle bin');
 const original={...doc};delete original.document_name;delete original.document_backup_date;delete original.restore_attempt;
 const target=await getCollection(name),existing=await target.findOne({_id:original._id});
 if(existing&&(!equal(existing.license,license)||protectedDocument(existing)))fail('The live document belongs to another shop or has payment history/recovery');
 let attempt=doc.restore_attempt;
 if(!attempt){
  attempt={version:1,before:existing||null};
  const prepared=await backupCollection.updateOne({_id:doc._id,license,$expr:{$eq:['$$ROOT',{$literal:doc}]}},{$set:{restore_attempt:attempt}},{writeConcern:{w:1,j:true}});
  if(!prepared.matchedCount)fail('The backup changed; reopen its saved restore result');
  doc={...doc,restore_attempt:attempt};
 }
 if(attempt.version!==1||Object.keys(attempt).sort().join(',')!=='before,version')fail('The original restore attempt is unavailable');
 if(!equal(existing,original)&&!equal(existing||null,attempt.before))fail('The live document changed since this restore was prepared; the backup was retained');

 if(existing){
  if(!equal(existing.license,license))fail('The existing document belongs to another shop');
  if(protectedDocument(existing))fail('The live document has payment history or recovery in progress');
  if(!equal(existing,original)){
   const changed=await target.replaceOne({_id:original._id,license,$expr:{$eq:['$$ROOT',{$literal:existing}]}},original,{writeConcern:{w:1,j:true}});
   if(!changed.matchedCount)fail('The live document changed during restore; the backup was retained');
  }
 }else{
  // Keep the original identity. A committed insert whose reply is lost can then
  // be recovered without generating another customer/sale or orphaning links.
  try{await target.insertOne(original,{writeConcern:{w:1,j:true}});}catch(error){
   if(error.code!==11000)throw error;
   const concurrent=await target.findOne({_id:original._id});
   if(!equal(concurrent,original)||protectedDocument(concurrent))fail('Another document appeared during restore; the backup was retained');
  }
 }
 const removed=await backupCollection.deleteOne({_id:doc._id,license,$expr:{$eq:['$$ROOT',{$literal:doc}]}},{writeConcern:{w:1,j:true}});
 if(!removed.deletedCount&&await backupCollection.findOne({_id:doc._id,license}))fail('The backup changed during restore and was retained');
 return {id:doc._id,collection:name};
}
module.exports={restoreRecord};
