"use strict";
// Internal coordinator primitive. No route may call this without verifying the
// authenticated installation authority, source snapshot and payment permission.
// One document owns receipt acceptance; ledger/invoice projection is a separate,
// recoverable step. It is deliberately not enabled by the existing payment route.
const {createHash}=require('node:crypto');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const text=(v,name,max=128)=>{if(typeof v!=='string'||!v||v.length>max||v!==v.trim()||[...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))fail('Invalid '+name);return v;};
const minor=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>BigInt(Number.MAX_SAFE_INTEGER))fail('Invalid payment amount');return BigInt(v);};
const fingerprint=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('Invalid source revision');return v;};
function scope(v){return {license:text(v.license,'shop'),branchId:text(v.branchId,'branch'),authority:text(v.authority,'payment authority')};}
function basis(v){
 const sourceId={kind:v.sourceId?.kind,value:text(v.sourceId?.value,'sale identity')};if(!['objectId','string'].includes(sourceId.kind)||(sourceId.kind==='objectId'&&!/^[a-f0-9]{24}$/.test(sourceId.value)))fail('Invalid sale identity');
 if(!/^[A-Z]{3}$/.test(v.currencyCode)||!Number.isInteger(v.currencyDigits)||v.currencyDigits<0||v.currencyDigits>4)fail('Saved currency is required');
 if(minor(v.totalMinor)!==minor(v.paidMinor)+minor(v.pendingMinor))fail('Original sale balance does not reconcile');
 return {sourceId,invoiceId:text(v.invoiceId,'invoice'),revision:fingerprint(v.revision),currencyCode:v.currencyCode,currencyDigits:v.currencyDigits,totalMinor:v.totalMinor,paidMinor:v.paidMinor,pendingMinor:v.pendingMinor};
}
const identity=(s,b)=>hash([s.license,b.sourceId.kind,b.sourceId.value]);
function validate(doc){
 if(!doc||doc.version!==1||doc._id!==identity(scope(doc.scope),basis(doc.baseline))||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.commands)||doc.commands.length>1000)fail('Receipt history is unavailable');
 let paid=minor(doc.baseline.paidMinor),pending=null,sourceRevision=doc.baseline.revision,revision=0;const seen=new Set();
 for(const c of doc.commands){
  if(seen.has(c.commandId)||!['prepared','accepted','projected','stopped'].includes(c.state))fail('Receipt history conflicts');seen.add(c.commandId);
  const review=c.review;if(!review||review.commandId!==c.commandId||review.journalId!==doc._id||review.reviewHash!==hash(review.values)||JSON.stringify(review.values.scope)!==JSON.stringify(doc.scope))fail('Receipt review changed');
  const b=basis(review.values.basis),i=review.values.input;if(b.revision!==sourceRevision)fail('Source revision does not follow its original projection');revision+=c.state==='prepared'?1:c.state==='projected'?3:2;if(i.commandId!==c.commandId||!/^[-a-zA-Z0-9]{16,64}$/.test(c.commandId)||minor(i.amountMinor)<=0n||minor(i.amountMinor)>minor(b.pendingMinor)||typeof i.reference!=='string'||i.reference.length>80)fail('Receipt request changed');text(i.method,'payment method',40);
  if(JSON.stringify(b.sourceId)!==JSON.stringify(doc.baseline.sourceId)||b.invoiceId!==doc.baseline.invoiceId||b.currencyCode!==doc.baseline.currencyCode||b.currencyDigits!==doc.baseline.currencyDigits||b.totalMinor!==doc.baseline.totalMinor||minor(b.paidMinor)!==paid)fail('Receipt sequence does not reconcile');
  if(pending)fail('An unfinished receipt was bypassed');
  if(c.state==='accepted'||c.state==='projected'){
   paid+=minor(i.amountMinor);const expected={id:hash([doc.scope.authority,doc._id,c.commandId]),commandId:c.commandId,amountMinor:i.amountMinor,method:i.method,reference:i.reference,at:c.receipt?.at,paidMinor:paid.toString(),pendingMinor:(minor(b.totalMinor)-paid).toString()};
   if(!c.receipt||JSON.stringify(c.receipt)!==JSON.stringify(expected)||typeof c.receipt.at!=='string'||!Number.isFinite(Date.parse(c.receipt.at))||new Date(c.receipt.at).toISOString()!==c.receipt.at)fail('Accepted receipt changed');
   if(c.state==='projected')sourceRevision=fingerprint(c.projectedRevision);
  }else if(c.receipt!==undefined)fail('An unaccepted request contains money');
  if(c.state==='prepared'||c.state==='accepted')pending=c.commandId;
 }
 if(doc.revision!==revision)fail('Receipt history revision changed');
 if(doc.active!==pending)fail('Receipt recovery pointer changed');return doc;
}
function create({db,now=()=>new Date()}){
 const collection=db.collection('books_receipt_journals');
 const read=async(s,id)=>{const doc=await collection.findOne({_id:id,'scope.license':s.license,'scope.branchId':s.branchId,'scope.authority':s.authority});if(!doc)fail('Payment request not found on this installation');return validate(doc);};
 const result=c=>structuredClone(c);
 async function mutate(s,id,cmd,work){for(let attempt=0;attempt<20;attempt++){const doc=await read(s,id),c=doc.commands.find(c=>c.commandId===cmd);if(!c)fail('Payment request not found');const copy=structuredClone(doc),changed=work(copy,copy.commands.find(c=>c.commandId===cmd));if(!changed)return result(c);copy.revision++;validate(copy);const saved=await collection.replaceOne({_id:id,revision:doc.revision},copy,{writeConcern:{w:1,j:true}});if(saved.matchedCount)return result(copy.commands.find(c=>c.commandId===cmd));}fail('Payment changed; check the original result');}
 return {
  async prepare(context,source,input){
   const s=scope(context),b=basis(source),i={commandId:text(input.commandId,'request'),amountMinor:input.amountMinor,method:text(input.method,'payment method',40),reference:input.reference??''};
   if(!/^[-a-zA-Z0-9]{16,64}$/.test(i.commandId)||typeof i.reference!=='string'||i.reference.length>80||minor(i.amountMinor)<=0n||minor(i.amountMinor)>minor(b.pendingMinor))fail('Review the amount received');
   const id=identity(s,b),values={scope:s,basis:b,input:i},review={journalId:id,commandId:i.commandId,values,reviewHash:hash(values)};
   try{await collection.updateOne({_id:id},{$setOnInsert:{_id:id,version:1,scope:s,baseline:b,revision:0,active:null,commands:[]}},{upsert:true,writeConcern:{w:1,j:true}});}catch(e){if(e.code!==11000)throw e;}
   for(let attempt=0;attempt<20;attempt++){
    const doc=await read(s,id),existing=doc.commands.find(c=>c.commandId===i.commandId);if(existing){if(existing.review.reviewHash!==review.reviewHash)fail('Request identity already has different details');return result(existing);}
    if(doc.active)fail('Check the unfinished payment before starting another');if(doc.commands.length>=1000)fail('Payment history needs archival review');
    const copy=structuredClone(doc);copy.commands.push({commandId:i.commandId,state:'prepared',review});copy.active=i.commandId;copy.revision++;validate(copy);
    if((await collection.replaceOne({_id:id,revision:doc.revision},copy,{writeConcern:{w:1,j:true}})).matchedCount)return result(copy.commands.at(-1));
   }fail('Payment changed; review again');
  },
  async outcome(context,id,cmd){const doc=await read(scope(context),id);return result(doc.commands.find(c=>c.commandId===cmd)||null);},
  async accept(context,id,cmd,reviewHash,confirmed){if(confirmed!==true)fail('Confirm the received payment');return mutate(scope(context),id,cmd,(doc,c)=>{if(c.review.reviewHash!==reviewHash)fail('Payment review changed');if(['accepted','projected'].includes(c.state))return false;if(c.state!=='prepared'||doc.active!==cmd)fail('This request was stopped');const b=c.review.values.basis,i=c.review.values.input,paid=minor(b.paidMinor)+minor(i.amountMinor);c.state='accepted';c.receipt={id:hash([doc.scope.authority,id,cmd]),commandId:cmd,amountMinor:i.amountMinor,method:i.method,reference:i.reference,at:now().toISOString(),paidMinor:paid.toString(),pendingMinor:(minor(b.totalMinor)-paid).toString()};return true;});},
  async stop(context,id,cmd,reviewHash){return mutate(scope(context),id,cmd,(doc,c)=>{if(c.review.reviewHash!==reviewHash)fail('Payment review changed');if(c.state==='stopped')return false;if(c.state!=='prepared')fail('An accepted receipt cannot be stopped');c.state='stopped';doc.active=null;return true;});},
  async projected(context,id,cmd,evidence){return mutate(scope(context),id,cmd,(doc,c)=>{if(!['accepted','projected'].includes(c.state)||evidence.receiptId!==c.receipt.id||evidence.paidMinor!==c.receipt.paidMinor||evidence.pendingMinor!==c.receipt.pendingMinor)fail('Payment projection differs from the receipt');fingerprint(evidence.revision);if(c.state==='projected'){if(c.projectedRevision!==evidence.revision)fail('Projection evidence changed');return false;}c.state='projected';c.projectedRevision=evidence.revision;doc.active=null;return true;});}
 };
}
module.exports={create,validate,basis};
