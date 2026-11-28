'use strict';
// Persist the exact selection before sending. Only a verified terminal result
// releases it; an uncertain reply never permits replacement.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createCustomerWalletSettlements=factory;})(globalThis,function({storage,locks,randomUUID,now=()=>new Date().toISOString()}){
 const keys=['licenseId','branchId','userId','customerId'];
 const fail=()=>{throw Error('Original settlement request storage needs review');};
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
 function key(scope){if(!scope||keys.some(k=>typeof scope[k]!=='string'||!scope[k]||scope[k].length>128))fail();return 'posnic:wallet-settlement:v1:'+JSON.stringify(keys.map(k=>scope[k]));}
 function normalize(input){
  if(!input||Object.keys(input).some(k=>k!=='sales')||!Array.isArray(input.sales)||!input.sales.length||input.sales.length>100)fail();
  const ids=new Set(),sales=input.sales.map(row=>{
   if(!row||Object.keys(row).some(k=>!['id','amount','paidamount'].includes(k))||typeof row.id!=='string'||!/^[a-f0-9]{24}$/.test(row.id)||ids.has(row.id))fail();ids.add(row.id);
   for(const field of ['amount','paidamount'])if(typeof row[field]!=='number'||!Number.isFinite(row[field])||row[field]<0||row[field]>Number.MAX_SAFE_INTEGER)fail();
   if(row.amount===0)fail();return {id:row.id,amount:row.amount,paidamount:row.paidamount};
  });return {sales:sales.sort((a,b)=>a.id.localeCompare(b.id))};
 }
 function validate(record,scope){if(!record||record.version!==1||key(record.scope)!==key(scope)||!uuid(record.commandId)||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||JSON.stringify(normalize(record.request))!==JSON.stringify(record.request))fail();return record;}
 function load(scope){const raw=storage.getItem(key(scope));if(raw===null)return null;if(typeof raw!=='string'||raw.length>32768)fail();let record;try{record=JSON.parse(raw);}catch{fail();}return validate(record,scope);}
 function exclusive(scope,fn){if(!locks||typeof locks.request!=='function')fail();return locks.request(key(scope),{mode:'exclusive'},fn);}
 return {
  load,
  prepare(scope,input){return exclusive(scope,()=>{
   const existing=load(scope);if(existing)return {created:false,record:existing};
   const record=validate({version:1,scope:Object.fromEntries(keys.map(k=>[k,scope[k]])),commandId:randomUUID(),request:normalize(input),createdAt:now()},scope);
   const encoded=JSON.stringify(record);if(encoded.length>32768)fail();storage.setItem(key(scope),encoded);if(storage.getItem(key(scope))!==encoded)fail();return {created:true,record};
  });},
  complete(scope,commandId,result){return exclusive(scope,()=>{
   const original=load(scope);if(!original)return false;
   if(original.commandId!==commandId||result?.commandId!==commandId)fail();
   if(result.state==='saved'){
    if(JSON.stringify(normalize(result.request))!==JSON.stringify(original.request)||JSON.stringify(result.sales)!==JSON.stringify(original.request.sales.map(row=>row.id))||
       typeof result.balance!=='number'||!Number.isFinite(result.balance)||result.balance<0||result.balance>Number.MAX_SAFE_INTEGER)fail();
   }else if(result.state!=='stopped'||result.canReplace!==true)fail();
   storage.removeItem(key(scope));if(storage.getItem(key(scope))!==null)fail();return true;
  });}
 };
});
