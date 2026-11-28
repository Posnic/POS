"use strict";
// Local request evidence only. Callers must never send before prepare succeeds.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createInvoicePaymentRequests=factory;})(globalThis,function({storage,locks,randomUUID,now=()=>new Date().toISOString()}){
 const fail=()=>{throw new Error('Original payment request storage needs review');};
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
 const keys=['licenseId','branchId','userId','invoiceId'];
 function scopeKey(scope){
  if(!scope||keys.some(key=>typeof scope[key]!=='string'||!scope[key]||scope[key].length>128))fail();
  return 'posnic:invoice-payment:v1:'+JSON.stringify(keys.map(key=>scope[key]));
 }
 function cents(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value))fail();
  const [whole,fraction='']=value.split('.'),n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(n<=0n||n>BigInt(Number.MAX_SAFE_INTEGER))fail();return n;
 }
 function validate(record,scope){
  if(!record||record.version!==1||scopeKey(record.scope)!==scopeKey(scope)||!record.request||
     !uuid(record.request.commandId)||!Number.isFinite(Date.parse(record.createdAt)))fail();
  cents(record.request.amount);
  for(const [key,max] of [['method',40],['reference',80]])if(typeof record.request[key]!=='string'||record.request[key].length>max)fail();
  return record;
 }
 function load(scope){const raw=storage.getItem(scopeKey(scope));if(raw===null)return null;
  if(raw.length>4096)fail();let record;try{record=JSON.parse(raw);}catch{fail();}return validate(record,scope);
 }
 function exclusive(scope,work){if(!locks||typeof locks.request!=='function')fail();return locks.request(scopeKey(scope),{mode:'exclusive'},work);}
 return {
  load,
  prepare(scope,values){return exclusive(scope,()=>{
   const existing=load(scope);if(existing)return {created:false,record:existing};
   const record=validate({version:1,scope:Object.fromEntries(keys.map(key=>[key,scope[key]])),createdAt:now(),
    request:{commandId:randomUUID(),amount:String(values.amount),method:String(values.method||'').trim(),reference:String(values.reference||'').trim()}},scope);
   const encoded=JSON.stringify(record);storage.setItem(scopeKey(scope),encoded);
   if(storage.getItem(scopeKey(scope))!==encoded)fail();
   return {created:true,record};
  });},
  replaceStopped(scope,commandId,status){return exclusive(scope,()=>{
   const record=load(scope);if(!record)return false;
   if(record.request.commandId!==commandId||status?.state!=='stopped'||status.commandId!==commandId||status.canReplace!==true)fail();
   storage.removeItem(scopeKey(scope));if(storage.getItem(scopeKey(scope))!==null)fail();return true;
  });},
  complete(scope,commandId,status){return exclusive(scope,()=>{
   const record=load(scope);if(!record)return false;
   if(record.request.commandId!==commandId||status?.state!=='saved'||status.releasePending!==false||
      status.commandId!==commandId||status.result?.status!==true||status.result.data?.commandId!==commandId||
      cents(String(status.result.data.amount))!==cents(record.request.amount))fail();
   storage.removeItem(scopeKey(scope));if(storage.getItem(scopeKey(scope))!==null)fail();return true;
  });},
 };
});
