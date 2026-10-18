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
 if(Object.keys(input).some(k=>!['after','limit','search','status','preparation','warehouseId','dateFrom','dateTo','collection','destination'].includes(k)))fail('hktv_orders_query_invalid',422);
 const {store,state}=await context(args);
 const mappedSkus=state.state.mappingStorage==='records-v1'?await store.mappings.keys():(state.state.mappings||[]).map(m=>m.sku);
 const result=await store.list({...input,mappedSkus});
 const matched=new Set(mappedSkus);
 const preparation=o=>o.reviewStatus==='changed-order'?'changed':o.handover?'handed-over':o.packing?'packed':o.lines.every(l=>matched.has(l.sku))?'ready':'needs-matching';
 return {orders:result.records.map(r=>({order:r.data,revision:r.revision,preparation:preparation(r.data)})),next:result.next,total:result.total,settingsRevision:state.revision};
}
async function orderOptions(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>!['skuAfter','skuSearch','limit'].includes(k)))fail('hktv_orders_query_invalid',422);
 const {store,state}=await context(args);
 const importStatus=await (args.getImportStatus||require('./extension-hktv-import-status').readImportStatus)({db:args.db,scope:args.scope,storeCode:state.state.storeCode}).catch(()=>({state:'unavailable'}));
 return {...await store.options(input),settingsRevision:state.revision,importStatus};
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
 const mapped=state.state.mappingStorage==='records-v1'?await store.mappings.findMany(before.data.lines.map(l=>l.sku)):null;
 const selected={...state.state,orders:[before.data],...(mapped?{mappings:mapped.map(r=>r.data)}:{})};
 const plan=await descriptor.plan({state:selected,revision:input.expectedRevision,command,actor,context:{}});
 const nonOrders=value=>JSON.stringify({...value,orders:[]});
 if(!plan||!Array.isArray(plan.effects)||plan.effects.length||plan.state?.orders?.length!==1||plan.state.orders[0].key!==command.orderKey||nonOrders(plan.state)!==nonOrders(selected))fail('hktv_order_plan_invalid',422);
 const latest=await (args.readState||namespace.readNamespace)(args.db,args.scope,descriptor,actor);
 if(latest.busy||latest.revision!==state.revision)fail('hktv_settings_changed');
 if(mapped){const current=await store.mappings.findMany(before.data.lines.map(l=>l.sku));const stamp=rows=>JSON.stringify(rows.map(r=>[r.key,r.revision]).sort());if(stamp(mapped)!==stamp(current))fail('hktv_mapping_changed');}
 const plannedOrder=reason==='packing'&&mapped?{...plan.state.orders[0],productMappings:mapped.map(r=>({sku:r.data.sku,productId:r.data.productId,revision:r.revision}))}:plan.state.orders[0];
 const result=await store.write({order:plannedOrder,expectedRevision:input.expectedRevision,actorId:String(actor.userId),reason});
 return {...result,result:plan.result};
}
async function readMapping(args){
 const input=args.input||{};
 if(Object.keys(input).some(k=>k!=='sku')||typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>300)fail('hktv_mapping_query_invalid',422);
 const {state,store}=await context(args);
 if(state.state.mappingStorage!=='records-v1')fail('hktv_mapping_storage_not_active',503);
 const row=(await store.mappings.findMany([input.sku]))[0];
 return {mapping:row?.data||null,revision:row?.revision||0,settingsRevision:state.revision};
}
async function saveMapping(args){
 const {input,descriptor,actor,db,scope}=args;
 if(!input||Object.keys(input).some(k=>!['sku','productId','expectedRevision','settingsRevision'].includes(k))||typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>300||!/^[a-f0-9]{24}$/.test(input.productId||'')||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Number.isSafeInteger(input.settingsRevision))fail('hktv_mapping_input_invalid',422);
 const required=descriptor.commands?.['mapping.save'];
 if(!actor.permissions?.includes('manage')||!Array.isArray(required)||!required.length||required.some(p=>!actor.permissions.includes(p)))fail('hktv_mapping_forbidden',403);
 const {state,store}=await context(args);
 if(state.state.mappingStorage!=='records-v1')fail('hktv_mapping_storage_not_active',503);
 if(state.revision!==input.settingsRevision)fail('hktv_settings_changed');
 if(!await store.hasSku(input.sku))fail('hktv_mapping_sku_unknown',422);
 const command={type:'mapping.save',sku:input.sku,productId:input.productId};
 const prepare=args.prepareCatalogue||require('./extension-catalog').prepareContext;
 const catalogue=await prepare({db,scope,state:state.state,command,resources:['catalog.products'],selection:{productIds:[input.productId]}});
 const product=catalogue.products?.find(p=>p.id===input.productId);if(!product)fail('hktv_mapping_product_unavailable',409);
 const projected={...state.state,orders:[{lines:[{sku:input.sku}]}],mappings:[]};
 const plan=await descriptor.plan({state:projected,revision:state.revision,actor,command,context:catalogue});
 if(!plan||!Array.isArray(plan.effects)||plan.effects.length||plan.state?.mappings?.length!==1||plan.state.mappings[0].productId!==product.id||plan.state.mappings[0].sku!==input.sku||JSON.stringify({...plan.state,mappings:[]})!==JSON.stringify(projected))fail('hktv_mapping_plan_invalid',422);
 const latest=await (args.readState||namespace.readNamespace)(db,scope,descriptor,actor);
 if(latest.busy||latest.revision!==state.revision||latest.state.mappingStorage!=='records-v1')fail('hktv_settings_changed');
 const key=require('node:crypto').createHash('sha256').update(input.sku).digest('hex');
 return store.mappings.write({mapping:{key,sku:input.sku,productId:product.id,description:product.description},expectedRevision:input.expectedRevision,actorId:String(actor.userId),reason:'mapping'});
}
module.exports={readMapping,saveMapping,orderOptions,listOrders,readOrder,orderHistory,commandOrder,cloudStore};
