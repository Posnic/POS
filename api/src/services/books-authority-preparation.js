"use strict";
const fail=code=>{throw Object.assign(new Error('Original Books payment records need review before this installation can be prepared.'),{code,status:409});};
// Desktop preparation must inspect the entire local MongoDB instance, not only
// the selected shop. No document contents or database names leave this audit.
async function assertUnused(client){
 let databases;
 try{databases=(await client.db('admin').admin().listDatabases({nameOnly:true,authorizedDatabases:false})).databases;}
 catch{fail('books_preparation_inventory_unavailable');}
 if(!Array.isArray(databases)||databases.length>1000||databases.some(row=>typeof row.name!=='string'||!row.name))fail('books_preparation_inventory_unavailable');
 const markers=['books_receipt_lock','books_receipt_owner','books_receipt_projection','books_receipt_effect','books_receipt_effects'];
 for(const {name} of databases){
  if(['admin','config','local'].includes(name))continue;
  const db=client.db(name);
  try{
   for(const collection of ['books_receipt_journals','books_connector_local']){
    if(await db.collection(collection).findOne({},{projection:{_id:1},maxTimeMS:5000}))fail('books_preparation_original_records_found');
   }
   for(const collection of ['sales','customers','invoices','transaction','recycle_bin']){
    if(await db.collection(collection).findOne({$or:[...markers.map(field=>({[field]:{$exists:true}})),...(collection==='recycle_bin'?[{document_name:{$in:['books_receipt_journals','books_connector_local']}}]:[])]},{projection:{_id:1},maxTimeMS:5000}))fail('books_preparation_original_records_found');
   }
  }catch(error){if(error.code==='books_preparation_original_records_found')throw error;fail('books_preparation_inventory_unavailable');}
 }
 return true;
}
module.exports={assertUnused};
