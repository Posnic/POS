'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ObjectId}=require('mongodb'),namespace=require('./extension-namespace'),access=require('../utils/branch-access');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const key=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function reauthorize({db,scope,descriptor,actor},write){
 if(descriptor.id!=='posnic.hktvmall-gogox'||!actor.permissions?.includes('read')||(write&&!actor.permissions?.includes('write')))fail('hktv_status_forbidden',403);
 if(!/^[a-f0-9]{24}$/.test(actor.userId||''))fail('hktv_status_forbidden',403);
 const user=await db.collection('users').findOne({_id:new ObjectId(actor.userId),license:scope.license});
 if(!user||user.activate!==true||user.active===false||[1,'1',true].includes(user.del_status)||!access.allowed(user,descriptor.permissionModule||'extensions',write?'write':'read'))fail('hktv_status_forbidden',403);
 if(String(user.branch_id)!==String(scope.branchId)&&!user.branch_access?.some(b=>String(b.branch_id)===String(scope.branchId)))fail('hktv_status_forbidden',403);
 const installed=await db.collection('extension_installations').findOne({license:scope.license,branch_id:scope.branchId,extensionId:descriptor.id,packageDigest:descriptor.packageDigest,enabled:true});
 const state=await db.collection('extension_namespaces').findOne({license:scope.license,branch_id:scope.branchId,extensionId:descriptor.id});
 if(!installed||state?.lifecycle?.enabled===false||state?.lifecycle?.installed===false)fail('hktv_status_disabled',403);
}
async function runtime({db,scope,storeCode},withProvider){
 const root=process.env.POSNIC_HKTV_CONNECTOR_ROOT;if(!root||!path.isAbsolute(root))fail('hktv_cloud_connection_required',503);
 const config=JSON.parse(await fs.readFile(path.join(root,'private/config.json'),'utf8'));
 if(config.tenantDb!==db.databaseName||config.license!==String(scope.license)||config.branchId!==String(scope.branchId)||config.storeCode!==storeCode)fail('hktv_connection_scope_mismatch',403);
 const scoped={license:String(scope.license),branchId:String(scope.branchId),storeCode};
 const store=require(path.join(root,'src/order-store.cjs')).createOrderStore(db,scoped),journal=require(path.join(root,'src/status-command-journal.cjs')).createStatusCommandJournal(db,scoped);
 if(!withProvider)return {store,journal};
 const credentials={storeCode,uuid:config.uuid,privateKey:await fs.readFile(config.privateKeyFile)};
 return {store,journal,reader:new (require(path.join(root,'src/hktv.cjs')).HktvReader)(credentials),writer:new (require(path.join(root,'src/hktv-status.cjs')).HktvStatusWriter)(credentials),run:require(path.join(root,'src/status-command-runner.cjs')).runStatusCommand};
}
function view(command){return {id:command._id,state:command.state,revision:command.revision,orderKey:command.intent.orderKey,status:command.intent.status,actorId:command.intent.actorId,createdAt:command.createdAt,updatedAt:command.updatedAt,outcome:command.outcome||null,observedStatus:command.observedStatus||null,reason:command.reason||null,events:command.events};}
async function stateFor(args,write){
 await (args.reauthorize||reauthorize)(args,write);
 const state=await (args.readState||namespace.readNamespace)(args.db,args.scope,args.descriptor,args.actor);
 if(state.busy||state.state.orderStorage!=='records-v1')fail('hktv_status_workspace_unavailable');
 return state;
}
async function submitStatus(args){
 const {input,descriptor,actor}=args;
 if(!input||Object.keys(input).some(k=>!['orderKey','expectedRevision','settingsRevision','status','requestKey','confirmed'].includes(k))||!key(input.orderKey)||!key(input.requestKey)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Number.isSafeInteger(input.settingsRevision)||!['ACKNOWLEDGED','PICKED'].includes(input.status)||input.confirmed!==true)fail('hktv_status_input_invalid',422);
 const required=descriptor.commands?.['status.submit'];if(!Array.isArray(required)||!required.length||required.some(p=>!actor.permissions?.includes(p)))fail('hktv_status_forbidden',403);
 const before=await stateFor(args,true);if(before.revision!==input.settingsRevision)fail('hktv_settings_changed');
 if(before.state.statusUpdates?.enabled!==true)fail('hktv_status_opt_in_required',403);
 const r=await (args.getRuntime||runtime)({...args,storeCode:before.state.storeCode},true);
 const row=await r.store.read(input.orderKey);if(!row||row.revision!==input.expectedRevision)fail('hktv_order_changed');
 const order=row.data;if(order.proposed||order.handover)fail('hktv_order_review_required');
 await r.journal.ensureIndexes();
 const intent={requestKey:crypto.createHash('sha256').update(actor.userId+':'+input.requestKey).digest('hex'),orderKey:order.key,orderId:order.orderId,trackingId:order.trackingId,commercialHash:order.commercialHash,deliveryMethod:order.deliveryMethod,warehouseId:order.warehouseId,deliverToWarehouse:order.deliverToWarehouse,orderRevision:row.revision,status:input.status,actorId:actor.userId,confirmed:true};
 const command=await r.journal.prepare(intent);
 const authorize=async()=>{const current=await stateFor(args,true);if(current.revision!==before.revision||current.state.storeCode!==before.state.storeCode||current.state.statusUpdates?.enabled!==true)fail('hktv_settings_changed');};
 return view(await r.run({id:command._id,journal:r.journal,reader:r.reader,writer:r.writer,readOrder:r.store.read,withOrderLease:r.store.withStatusLease,authorize}));
}
async function readStatus(args){
 if(!args.input||Object.keys(args.input).length!==1||!((key(args.input.id)&&!args.input.orderKey)||(key(args.input.orderKey)&&!args.input.id)))fail('hktv_status_input_invalid',422);
 const state=await stateFor(args,false),r=await (args.getRuntime||runtime)({...args,storeCode:state.state.storeCode},false);
 if(args.input.orderKey)return {enabled:state.state.statusUpdates?.enabled===true,canDiscard:args.actor.permissions?.includes('write')&&Array.isArray(args.descriptor.commands?.['status.discard']),commands:(await r.journal.forOrder(args.input.orderKey)).map(view)};
 const command=await r.journal.read(args.input.id);
 if(!command)fail('hktv_status_not_found',404);return view(command);
}
async function reconcileStatus(args){
 if(!args.input||Object.keys(args.input).length!==1||!key(args.input.id))fail('hktv_status_input_invalid',422);
 const state=await stateFor(args,false),r=await (args.getRuntime||runtime)({...args,storeCode:state.state.storeCode},true);
 const command=await r.journal.read(args.input.id);if(!command)fail('hktv_status_not_found',404);
 // Readback remains available when outbound updates are switched off.
 const authorize=async()=>{const current=await stateFor(args,false);if(current.state.storeCode!==state.state.storeCode)fail('hktv_settings_changed');};
 return view(await r.run({id:command._id,journal:r.journal,reader:r.reader,readOrder:r.store.read,withOrderLease:r.store.withStatusLease,authorize,dispatchAllowed:false}));
}
async function discardStatus(args){
 const {input,descriptor,actor}=args;
 if(!input||Object.keys(input).some(k=>!['id','expectedRevision','confirmed'].includes(k))||!key(input.id)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||input.confirmed!==true)fail('hktv_status_input_invalid',422);
 const required=descriptor.commands?.['status.discard'];if(!Array.isArray(required)||!required.length||required.some(p=>!actor.permissions?.includes(p)))fail('hktv_status_forbidden',403);
 const state=await stateFor(args,true),r=await (args.getRuntime||runtime)({...args,storeCode:state.state.storeCode},false);
 const command=await r.journal.read(input.id);if(!command)fail('hktv_status_not_found',404);
 return r.store.withStatusLease(command.intent.orderKey,command._id,async()=>{
  const fresh=await stateFor(args,true);if(fresh.state.storeCode!==state.state.storeCode)fail('hktv_settings_changed');
  const current=await r.journal.read(input.id);if(!current)fail('hktv_status_not_found',404);
  if(current.state==='obsolete'&&current.reason==='UNSENT_REQUEST_DISCARDED')return view(current);
  if(current.state!=='prepared')fail('hktv_status_already_dispatched');
  if(current.revision!==input.expectedRevision)fail('hktv_status_command_changed');
  return view(await r.journal.transition(input.id,current.revision,'obsolete',{reason:'UNSENT_REQUEST_DISCARDED',actorId:actor.userId}));
 });
}
module.exports={submitStatus,readStatus,reconcileStatus,discardStatus,reauthorize};
