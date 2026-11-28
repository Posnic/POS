"use strict";
// Caller must persist before sending; never clear an uncertain original.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createCustomerWalletRequests=factory;})(globalThis,function({storage,locks,randomUUID,now=()=>new Date().toISOString()}){
 const fail=()=>{throw new Error('Original wallet request storage needs review');};
 const keys=['licenseId','branchId','userId','customerId'];
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
 function scopeKey(scope){if(!scope||keys.some(key=>typeof scope[key]!=='string'||!scope[key]||scope[key].length>128))fail();return 'posnic:customer-wallet:v1:'+JSON.stringify(keys.map(key=>scope[key]));}
 function normalize(input){
  if(input?.kind==='remove'){
   if(typeof input.entryId!=='string'||!/^[a-f0-9]{24}$/.test(input.entryId)||Object.keys(input).some(key=>!['kind','entryId'].includes(key)))fail();
   return {kind:'remove',entryId:input.entryId};
  }
  if(input?.kind!=='add'||Object.keys(input).some(key=>!['kind','amount','type','date','description','image'].includes(key))||!['in','out'].includes(input.type))fail();
  const raw=String(input.amount);if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(raw))fail();
  const [whole,fraction='']=raw.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(minor<=0n||minor>BigInt(Number.MAX_SAFE_INTEGER))fail();const amount=Number(minor)/100;
  if(Math.round(amount*100)!==Number(minor))fail();
  if(typeof input.date!=='string'||!Number.isFinite(Date.parse(input.date)))fail();
  for(const key of ['description','image'])if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>2048))fail();
  return {kind:'add',amount,type:input.type,date:new Date(input.date).toISOString(),description:input.description||'',image:input.image||''};
 }
 const same=(left,right)=>JSON.stringify(normalize(left))===JSON.stringify(normalize(right));
 function validate(record,scope){
  if(!record||record.version!==1||scopeKey(record.scope)!==scopeKey(scope)||!uuid(record.commandId)||!Number.isFinite(Date.parse(record.createdAt)))fail();
  if(JSON.stringify(normalize(record.request))!==JSON.stringify(record.request))fail();return record;
 }
 function load(scope){const raw=storage.getItem(scopeKey(scope));if(raw===null)return null;if(raw.length>16384)fail();let record;try{record=JSON.parse(raw);}catch{fail();}return validate(record,scope);}
 function exclusive(scope,work){if(!locks||typeof locks.request!=='function')fail();return locks.request(scopeKey(scope),{mode:'exclusive'},work);}
 return {
  load,
  prepare(scope,input){return exclusive(scope,()=>{
   const existing=load(scope);if(existing)return {created:false,record:existing};
   const record=validate({version:1,scope:Object.fromEntries(keys.map(key=>[key,scope[key]])),commandId:randomUUID(),request:normalize(input),createdAt:now()},scope);
   const encoded=JSON.stringify(record);storage.setItem(scopeKey(scope),encoded);if(storage.getItem(scopeKey(scope))!==encoded)fail();return {created:true,record};
  });},
  complete(scope,commandId,status){return exclusive(scope,()=>{
   const original=load(scope);if(!original)return false;
   if(original.commandId!==commandId||status?.state!=='saved'||status.commandId!==commandId||status.kind!==original.request.kind||!same(status.request,original.request)||
      typeof status.balance!=='number'||!Number.isFinite(status.balance)||typeof status.entryId!=='string'||!/^[a-f0-9]{24}$/.test(status.entryId)||
      (original.request.kind==='remove'&&original.request.entryId!==status.entryId))fail();
   storage.removeItem(scopeKey(scope));if(storage.getItem(scopeKey(scope))!==null)fail();return true;
  });}
 };
});
