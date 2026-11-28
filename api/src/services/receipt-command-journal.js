'use strict';
// Internal persistence only. No route enables this until the receipt coordinator
// validates source evidence, reserves competing writers and verifies projections.
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.split(' ').sort().join(',');
function identity(value){
 if(!exact(value,'kind value')||!['string','objectId'].includes(value.kind)||!text(value.value)||
    (value.kind==='objectId'&&!/^[a-f0-9]{24}$/.test(value.value)))fail('receipt_identity_invalid');
 return {kind:value.kind,value:value.value};
}
function scopeOf(scope){
 if(!exact(scope,'installationId license branch')||!uuid(scope.installationId))fail('receipt_scope_invalid');
 return {installationId:scope.installationId,license:identity(scope.license),branch:identity(scope.branch)};
}
function commandOf(input){
 if(!exact(input,'requestId reviewId sale invoice customer sourceRevision currency amountMinor method')||!uuid(input.requestId)||!revision(input.sourceRevision)||!uuid(input.reviewId)||
    input.currency!=='AED'||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0||!text(input.method))fail('receipt_command_invalid');
 return {version:1,requestId:input.requestId,reviewId:input.reviewId,sale:identity(input.sale),
   invoice:identity(input.invoice),customer:input.customer===null?null:identity(input.customer),
   sourceRevision:input.sourceRevision,currency:input.currency,amountMinor:input.amountMinor,method:input.method};
}
function createJournal(db,scope,actor){
 if(!exact(actor,'id name')||!text(actor.name))fail('receipt_actor_invalid');
 const actorJson=JSON.stringify({id:identity(actor.id),name:actor.name});
 const actorIdJson=JSON.stringify(identity(actor.id));
 const originalActor=row=>JSON.stringify(JSON.parse(row.actorJson).id)===actorIdJson;
 const scopeJson=JSON.stringify(scopeOf(scope));
 const rows=db.collection('books_receipt_commands');
 function key(id){if(!uuid(id))fail('receipt_command_invalid');return hash(JSON.stringify([scopeJson,id]));}
 function verify(row,id){
  if(!row)return null;
  let command;
  try{const stored=JSON.parse(row.commandJson);if(stored.version!==1)fail('receipt_journal_corrupt');const {version,...input}=stored;command=commandOf(input);}catch{fail('receipt_journal_corrupt');}
  if(row._id!==key(id)||row.scopeJson!==scopeJson||command.requestId!==id||
     JSON.stringify(command)!==row.commandJson||hash(row.commandJson)!==row.commandHash||
     !['prepared','accepted','completed','stopped'].includes(row.state))fail('receipt_journal_corrupt');
  try{
   const savedActor=JSON.parse(row.actorJson);
   if(!exact(savedActor,'id name')||!text(savedActor.name)||
      JSON.stringify({id:identity(savedActor.id),name:savedActor.name})!==row.actorJson||hash(row.actorJson)!==row.actorHash)fail('receipt_journal_corrupt');
  }catch{fail('receipt_journal_corrupt');}
  if(row.state==='completed'&&(!row.resultJson||hash(row.resultJson)!==row.resultHash))fail('receipt_journal_corrupt');
  return row;
 }
 async function read(id){return verify(await rows.findOne({_id:key(id),scopeJson}),id);}
 async function prepare(input){
  const command=commandOf(input),commandJson=JSON.stringify(command),commandHash=hash(commandJson),id=command.requestId;
  try{await rows.updateOne({_id:key(id)},{$setOnInsert:{scopeJson,commandJson,commandHash,actorJson,actorHash:hash(actorJson),state:'prepared',createdAt:new Date()}},{upsert:true});}
  catch(error){if(error.code!==11000)throw error;}
  const saved=await read(id);
  if(!saved||saved.commandJson!==commandJson)fail('receipt_request_reused');
  if(!originalActor(saved))fail('receipt_original_actor_required');
  return saved;
 }
 async function transition(input,from,to,extra={}){
  const command=commandOf(input),id=command.requestId,saved=await read(id);
  if(!saved)fail('receipt_request_missing');
  const commandJson=JSON.stringify(command);
  if(saved.commandJson!==commandJson)fail('receipt_request_reused');
  if(!originalActor(saved))fail('receipt_original_actor_required');
  await rows.updateOne({_id:key(id),scopeJson,commandJson,actorJson:saved.actorJson,state:from},{$set:{state:to,...extra}});
  const current=await read(id);
  if(!current||current.state!==to)fail('receipt_state_conflict');
  return current;
 }
 return {
  prepare,read,
  // Caller must already hold sale/customer reservations before acceptance.
  accept:input=>transition(input,'prepared','accepted',{acceptedAt:new Date()}),
  stop:input=>transition(input,'prepared','stopped',{stoppedAt:new Date()}),
  // Caller must verify all projections before publishing a terminal result.
  async complete(input,result){
   if(!exact(result,'receiptId saleRevision')||!uuid(result.receiptId)||!revision(result.saleRevision))fail('receipt_result_invalid');
   const resultJson=JSON.stringify({receiptId:result.receiptId,saleRevision:result.saleRevision});
   const row=await transition(input,'accepted','completed',{resultJson,resultHash:hash(resultJson),completedAt:new Date()});
   if(row.resultJson!==resultJson)fail('receipt_result_conflict');
   return row;
  }
 };
}
module.exports={createJournal};
