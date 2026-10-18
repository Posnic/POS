'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const namespace=require('./extension-namespace');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
async function cloudStore({db,scope,storeCode}){
 const root=process.env.POSNIC_HKTV_CONNECTOR_ROOT;
 if(!root||!path.isAbsolute(root))fail('hktv_cloud_connection_required',503);
 const config=JSON.parse(await fs.readFile(path.join(root,'private/config.json'),'utf8'));
 if(config.tenantDb!==db.databaseName||config.license!==String(scope.license)||config.branchId!==String(scope.branchId)||config.storeCode!==storeCode)fail('hktv_connection_scope_mismatch',403);
 return require(path.join(root,'src/order-store.cjs')).createOrderStore(db,{license:String(scope.license),branchId:String(scope.branchId),storeCode});
}
async function context(args){
 const {descriptor,actor,db,scope,readState=namespace.readNamespace,getStore=cloudStore}=args;
 if(descriptor.id!=='posnic.hktvmall-gogox'||!actor.permissions?.includes('read'))fail('hktv_orders_forbidden',403);
 const state=await readState(db,scope,descriptor,actor);
 if(state.busy)fail('hktv_orders_busy');
 // This marker is written only by the checked cutover, after migrating and
 // verifying every legacy order. Merely deploying these routes enables nothing.
 if(state.state.orderStorage!=='records-v1')fail('hktv_order_storage_not_active',503);
 return {state,store:await getStore({db,scope,storeCode:state.state.storeCode})};
}
async function listOrders(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>!['after','limit','search','status','preparation','warehouseId','dateFrom','dateTo','collection'].includes(k)))fail('hktv_orders_query_invalid',422);
 const {store,state}=await context(args);
 const result=await store.list({...input,mappedSkus:(state.state.mappings||[]).map(m=>m.sku)});
 return {orders:result.records.map(r=>({order:r.data,revision:r.revision})),next:result.next,total:result.total,settingsRevision:state.revision};
}
async function orderOptions(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>!['skuAfter','skuSearch','limit'].includes(k)))fail('hktv_orders_query_invalid',422);
 const {store,state}=await context(args);
 return {...await store.options(input),settingsRevision:state.revision};
}
async function readOrder(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>k!=='orderKey')||!/^[a-f0-9]{64}$/.test(input.orderKey||''))fail('hktv_order_key_invalid',422);
 const {store,state}=await context(args),row=await store.read(input.orderKey);
 if(!row)fail('hktv_order_not_found',404);
 return {order:row.data,revision:row.revision,settingsRevision:state.revision};
}
async function orderHistory(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>!['orderKey','from','limit'].includes(k))||!/^[a-f0-9]{64}$/.test(input.orderKey||''))fail('hktv_order_key_invalid',422);
 const {store}=await context(args);
 const result=await store.history(input.orderKey,{from:input.from,limit:input.limit});
 return {events:result.records.map(r=>({revision:r.revision,previousVersion:r.previousVersion,at:r.createdAt,actorId:r.actorId,reason:r.reason,order:r.data})),next:result.next};
}
async function commandOrder(args){
 const {descriptor,actor,input}=args;
 if(!input||Object.keys(input).some(k=>!['expectedRevision','settingsRevision','command'].includes(k))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Number.isSafeInteger(input.settingsRevision))fail('hktv_order_command_invalid',422);
 const command=input.command,reason={'order.pack':'packing','order.handover':'handover'}[command?.type];
 if(!reason||!/^[a-f0-9]{64}$/.test(command.orderKey||''))fail('hktv_order_command_invalid',422);
 const required=descriptor.commands?.[command.type];
 if(!Array.isArray(required)||!required.length||!actor.permissions?.includes('write')||required.some(p=>!actor.permissions.includes(p)))fail('hktv_order_command_forbidden',403);
 const {store,state}=await context(args);
 if(state.revision!==input.settingsRevision)fail('hktv_settings_changed');
 const before=await store.read(command.orderKey);if(!before)fail('hktv_order_not_found',404);
 const selected={...state.state,orders:[before.data]};
 const plan=await descriptor.plan({state:selected,revision:input.expectedRevision,command,actor,context:{}});
 const nonOrders=value=>JSON.stringify({...value,orders:[]});
 if(!plan||!Array.isArray(plan.effects)||plan.effects.length||plan.state?.orders?.length!==1||plan.state.orders[0].key!==command.orderKey||nonOrders(plan.state)!==nonOrders(selected))fail('hktv_order_plan_invalid',422);
 const latest=await (args.readState||namespace.readNamespace)(args.db,args.scope,descriptor,actor);
 if(latest.busy||latest.revision!==state.revision)fail('hktv_settings_changed');
 const result=await store.write({order:plan.state.orders[0],expectedRevision:input.expectedRevision,actorId:String(actor.userId),reason});
 return {...result,result:plan.result};
}
module.exports={orderOptions,listOrders,readOrder,orderHistory,commandOrder,cloudStore};
