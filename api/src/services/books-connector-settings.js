"use strict";
const {createHash}=require('node:crypto'),{BSON}=require('mongodb');
const journal=require('./books-receipt-journal'),receiptContext=require('./books-receipt-context');
const COLLECTION='books_connector_local';
const fail=code=>{throw Object.assign(new Error('Review the original Books connection setting before trying again.'),{code,status:409});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
async function context(req){
 if(req?.user?.api_token===true||req?.user?.access?.branch?.write!==true)throw Object.assign(new Error('Unauthorized'),{status:403});
 return receiptContext.resolve(req,'read');
}
function create({db}){
 const collection=db.collection(COLLECTION);
 function scopeOf(context){
  if(typeof context.branchId!=='string'||!context.branchId||!/^books-[a-f0-9-]{36}$/.test(context.authority||''))fail('books_connection_scope_invalid');
  return {license:journal.licenseValue(context),branchId:context.branchId,authority:context.authority};
 }
 const key=scope=>createHash('sha256').update(BSON.EJSON.stringify(scope,{relaxed:false})).digest('hex');
 function view(doc){return {enabled:doc?.enabled??false,revision:doc?.revision??0,lastChangedAt:doc?.history.at(-1)?.at??null};}
 async function load(scope){
  const doc=await collection.findOne({_id:key(scope),scope});
  if(doc&&(!Number.isSafeInteger(doc.revision)||doc.revision<1||typeof doc.enabled!=='boolean'||!Array.isArray(doc.history)||doc.history.length!==doc.revision||doc.history.at(-1)?.revision!==doc.revision||doc.history.length>1000||doc.enabled!==doc.history.at(-1)?.enabled||new Set(doc.history.map(item=>item.id)).size!==doc.history.length||doc.history.some((item,index)=>!uuid(item.id)||item.revision!==index+1||item.expectedRevision!==index||typeof item.enabled!=='boolean'||!(item.at instanceof Date)||!Number.isFinite(item.at.getTime()))))fail('books_connection_saved_state_invalid');
  return doc;
 }
 return {
  read:async context=>view(await load(scopeOf(context))),
  async outcome(context,requestId){if(!uuid(requestId))fail('books_connection_request_invalid');const doc=await load(scopeOf(context));return {current:view(doc),request:doc?.history.find(item=>item.id===requestId)||null};},
  async change(context,input){
   if(!input||!uuid(input.requestId)||input.confirmed!==true||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof context.actorId!=='string'||!context.actorId||typeof context.actorName!=='string'||!context.actorName)fail('books_connection_request_invalid');
   const scope=scopeOf(context),_id=key(scope),request={id:input.requestId,expectedRevision:input.expectedRevision,enabled:input.enabled,actorId:context.actorId,actorName:context.actorName};
   for(let attempt=0;attempt<5;attempt++){
    const before=await load(scope),saved=before?.history.find(item=>item.id===request.id);
    if(saved){if(Object.keys(request).some(field=>saved[field]!==request[field]))fail('books_connection_request_changed');return {current:view(before),request:saved};}
    const revision=before?.revision??0;
    if(revision!==input.expectedRevision)fail('books_connection_revision_changed');
    // Bounded single-document history avoids multi-document transaction assumptions.
    // Never prune retry identities; archive/migration must be designed before this cap.
    if(revision>=1000)fail('books_connection_history_review_required');
    const result={...request,revision:revision+1,at:new Date()},next={_id,scope,enabled:input.enabled,revision:revision+1,history:[...(before?.history||[]),result]};
    try{const saved=await collection.replaceOne({_id,scope,revision:before?revision:{$exists:false}},next,{upsert:true,writeConcern:{w:1,j:true}});if(saved.matchedCount||saved.upsertedCount)return {current:view(next),request:result};}
    catch(error){if(error.code!==11000)throw error;}
   }
   fail('books_connection_busy');
  }
 };
}
module.exports={create,context,COLLECTION};
