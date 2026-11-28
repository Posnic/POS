'use strict';
// Per-sale receipt sequence. Single-document compare-and-swap works on standalone
// MongoDB. The coordinator owns source reservations and financial projections.
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{code:'books_receipt_conflict',status:409});};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const rev=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const minor=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER);
function identity(value){
 if(value?._bsontype==='ObjectId')return {kind:'objectId',value:value.toHexString()};
 if(text(value))return {kind:'string',value};
 fail('Invalid source identity');
}
function typed(value){
 if(!value||!['string','objectId'].includes(value.kind)||!text(value.value)||
    (value.kind==='objectId'&&!/^[a-f0-9]{24}$/.test(value.value)))fail('Invalid source identity');
 return {kind:value.kind,value:value.value};
}
function scope(context){
 if(!context||![context.branchId,context.authority,context.actorId,context.actorName].every(text))fail('Invalid authenticated payment actor or scope');
 const license=identity(context.license);
 return {licenseKind:license.kind,license:license.value,branchId:context.branchId,authority:context.authority};
}
function basis(source){
 if(!source||!text(source.invoiceId)||!rev(source.revision)||source.currencyCode!=='AED'||source.currencyDigits!==2||
   ![source.totalMinor,source.paidMinor,source.pendingMinor].every(minor)||
   BigInt(source.paidMinor)+BigInt(source.pendingMinor)!==BigInt(source.totalMinor))fail('Invalid original payment balances');
 return {sourceId:typed(source.sourceId),invoiceId:source.invoiceId,revision:source.revision,currencyCode:'AED',currencyDigits:2,
  totalMinor:source.totalMinor,paidMinor:source.paidMinor,pendingMinor:source.pendingMinor};
}
function values(context,source,input){
 const original=basis(source),scoped=scope(context);
 if(!input||!text(input.commandId)||!minor(input.amountMinor)||BigInt(input.amountMinor)<=0n||
   BigInt(input.amountMinor)>BigInt(original.pendingMinor)||!text(input.method)||
   typeof input.reference!=='string'||input.reference.length>256||/[\x00-\x1f\x7f]/.test(input.reference))fail('Invalid payment request');
 if(input.actor?.id!==context.actorId||input.actor?.name!==context.actorName)fail('Use the authenticated payment actor');
 return {scope:scoped,basis:original,commandId:input.commandId,amountMinor:input.amountMinor,method:input.method,
  reference:input.reference,actor:{id:context.actorId,name:context.actorName}};
}
const journalId=(scoped,sourceId)=>hash([scoped.licenseKind,scoped.license,scoped.branchId,sourceId]);
function receipt(command){
 const v=command.review.values;
 return {id:hash([command.review.journalId,command.commandId,command.review.reviewHash]),at:command.acceptedAt,amountMinor:v.amountMinor,
  paidMinor:String(BigInt(v.basis.paidMinor)+BigInt(v.amountMinor)),pendingMinor:String(BigInt(v.basis.pendingMinor)-BigInt(v.amountMinor)),
  currencyCode:'AED',currencyDigits:2,method:v.method,reference:v.reference,actor:v.actor};
}
function validate(row){
 if(!row||row.version!==1||!Array.isArray(row.commands)||!row.commands.length||row.commands.length>500)fail('Invalid receipt journal');
 let revision=0,active=null,lastProjected=null;const seen=new Set();
 for(const command of row.commands){
  const v=command.review?.values;
  if(!v||!timestamp(command.preparedAt)||seen.has(command.commandId)||command.commandId!==v.commandId)fail('Invalid receipt command');
  seen.add(command.commandId);
  const context={license:v.scope?.licenseKind==='objectId'?new (require('mongodb').ObjectId)(v.scope.license):v.scope?.license,
   branchId:v.scope?.branchId,authority:v.scope?.authority,actorId:v.actor?.id,actorName:v.actor?.name};
  const canonical=values(context,v.basis,{commandId:v.commandId,amountMinor:v.amountMinor,method:v.method,reference:v.reference,actor:v.actor});
  if(hash(canonical)!==hash(v)||hash(v)!==command.review.reviewHash||command.review.journalId!==row._id||
   journalId(v.scope,v.basis.sourceId)!==row._id||hash(v.scope)!==hash(row.scope)||hash(v.basis.sourceId)!==hash(row.sourceId))fail('Invalid receipt review');
  if(active)fail('Unfinished receipt sequence');
  if(lastProjected&&(v.basis.revision!==lastProjected.projectedRevision||v.basis.paidMinor!==lastProjected.receipt.paidMinor||
    v.basis.pendingMinor!==lastProjected.receipt.pendingMinor||v.basis.totalMinor!==lastProjected.review.values.basis.totalMinor||
    v.basis.invoiceId!==lastProjected.review.values.basis.invoiceId))fail('Invalid receipt sequence');
  if(command.state==='prepared'){revision++;active=command.commandId;if(command.receipt||command.projectedRevision)fail('Invalid prepared receipt');}
  else if(command.state==='stopped'){revision+=2;if(command.receipt||command.projectedRevision)fail('Invalid stopped receipt');}
  else if(['accepted','projected'].includes(command.state)){
   if(!timestamp(command.acceptedAt)||hash(command.receipt)!==hash(receipt(command)))fail('Invalid accepted receipt');
   if(command.state==='accepted'){revision+=2;active=command.commandId;if(command.projectedRevision)fail('Invalid accepted projection');}
   else {revision+=3;if(!rev(command.projectedRevision))fail('Invalid projected revision');lastProjected=command;}
  }else fail('Invalid receipt state');
 }
 if(row.revision!==revision||row.active!==active)fail('Invalid receipt journal revision');
 return row;
}
const outcome=command=>({commandId:command.commandId,state:command.state,review:command.review,
 ...(command.receipt?{receipt:command.receipt}:{}),...(command.projectedRevision?{projectedRevision:command.projectedRevision}:{})});
function create({db,now=()=>new Date()}){
 const at=()=>{const value=now().toISOString();if(!timestamp(value))fail('Invalid receipt time');return value;};
 const rows=db.collection('books_receipt_journals');
 function scoped(row,context){validate(row);if(hash(row.scope)!==hash(scope(context)))fail('Receipt journal not found');return row;}
 async function load(context,id){const row=await rows.findOne({_id:id});if(!row)fail('Receipt journal not found');return scoped(row,context);}
 function find(row,id){const command=row.commands.find(c=>c.commandId===id);if(!command)fail('Receipt request not found');return command;}
 async function change(context,id,edit){
  for(let attempt=0;attempt<30;attempt++){
   const row=await load(context,id),next=structuredClone(row),result=edit(next);
   if(result)return result;
   validate(next);
   const changed=await rows.replaceOne({_id:id,revision:row.revision,scope:row.scope},next);
   if(changed.matchedCount)return null;
  }
  fail('Receipt busy; recover the original request');
 }
 return {
  async prepare(context,source,input){
   const v=values(context,source,input),id=journalId(v.scope,v.basis.sourceId);
   const review={journalId:id,reviewHash:hash(v),values:v},command={commandId:input.commandId,state:'prepared',preparedAt:at(),review};
   const initial={_id:id,version:1,scope:v.scope,sourceId:v.basis.sourceId,revision:1,active:input.commandId,commands:[command]};
   validate(initial);
   try{await rows.updateOne({_id:id},{$setOnInsert:initial},{upsert:true});}catch(error){if(error.code!==11000)throw error;}
   const existing=await change(context,id,row=>{
    const old=row.commands.find(c=>c.commandId===input.commandId);
    if(old){if(old.review.reviewHash!==review.reviewHash)fail('Request already used with different details');return outcome(old);}
    if(row.active)fail('Finish the unfinished receipt first');
    if(row.commands.length>=500)fail('Receipt history limit requires review');
    row.commands.push(command);row.revision++;row.active=input.commandId;
   });
   return existing||outcome(find(await load(context,id),input.commandId));
  },
  async outcome(context,id,commandId){return outcome(find(await load(context,id),commandId));},
  async accept(context,id,commandId,reviewHash,confirmed){
   if(confirmed!==true)fail('Confirm the original payment review');
   const existing=await change(context,id,row=>{
    const c=find(row,commandId);if(c.review.values.actor.id!==context.actorId)fail('Use the original payment actor');
    if(c.review.reviewHash!==reviewHash)fail('Payment review changed');
    if(c.state==='stopped')fail('Payment request stopped');
    if(c.state!=='prepared')return outcome(c);
    c.state='accepted';c.acceptedAt=at();c.receipt=receipt(c);row.revision++;
   });
   return existing||outcome(find(await load(context,id),commandId));
  },
  async stop(context,id,commandId,reviewHash){
   const existing=await change(context,id,row=>{
    const c=find(row,commandId);if(c.review.values.actor.id!==context.actorId)fail('Use the original payment actor');
    if(c.review.reviewHash!==reviewHash)fail('Payment review changed');
    if(c.state==='stopped')return outcome(c);
    if(c.state!=='prepared')fail('Accepted receipt cannot be stopped');
    c.state='stopped';row.active=null;row.revision++;
   });
   return existing||outcome(find(await load(context,id),commandId));
  },
  async projected(context,id,commandId,proof){
   const existing=await change(context,id,row=>{
    const c=find(row,commandId);if(c.review.values.actor.id!==context.actorId)fail('Use the original payment actor');
    if(!['accepted','projected'].includes(c.state)||!proof||!rev(proof.revision)||proof.receiptId!==c.receipt.id||
      proof.paidMinor!==c.receipt.paidMinor||proof.pendingMinor!==c.receipt.pendingMinor)fail('Invalid payment projection proof');
    if(c.state==='projected'){if(c.projectedRevision!==proof.revision)fail('Projection revision changed');return outcome(c);}
    c.state='projected';c.projectedRevision=proof.revision;row.active=null;row.revision++;
   });
   return existing||outcome(find(await load(context,id),commandId));
  }
 };
}
module.exports={create,validate};
