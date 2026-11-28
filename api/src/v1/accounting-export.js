'use strict';
const {createHash}=require('node:crypto');
const {exportSale,identity,projection}=require('./accounting-source');
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
function scope(user,branchFilter){
 if(typeof user?.license!=='string'||!user.license||user.license.length>256||user.access?.sales?.read!==true)fail(403,'forbidden');
 const branches=user.branch_access??[];
 if(!Array.isArray(branches))fail(403,'invalid_branch_scope');
 const ids=branches.map(row=>{try{return JSON.stringify(identity(row?.branch_id));}catch{fail(403,'invalid_branch_scope');}});
 const filter={license:user.license},branch=branchFilter(user);
 const query=branch?{$and:[filter,branch]}:filter;
 const key=createHash('sha256').update(JSON.stringify({license:user.license,branches:[...new Set(ids)].sort()})).digest('hex');
 return {query,key,license:user.license};
}
function decode(value,key){
 if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))fail(400,'bad_cursor');
 try{
  const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)throw Error();
  const text=bytes.toString('utf8'),prefix=text.slice(0,4);
  if(!['oid:','str:'].includes(prefix))throw Error();
  const cursor=JSON.parse(text.slice(4));
  if(prefix!==(cursor.kind==='objectId'?'oid:':'str:'))throw Error();
  if(Object.keys(cursor).sort().join(',')!=='kind,scope,value,version'||cursor.version!==1||cursor.scope!==key)throw Error();
  validateId(cursor.kind,cursor.value);return cursor;
 }catch{fail(400,'bad_cursor');}
}
function validateId(kind,value){
 if(!['objectId','string'].includes(kind)||typeof value!=='string'||!value||value.length>256||/[\x00-\x1f\x7f]/.test(value)||kind==='objectId'&&!/^[a-f0-9]{24}$/.test(value))fail(400,'bad_id');
}
function idValue(kind,value){return kind==='objectId'?new (require('mongodb').ObjectId)(value):value;}
function mount(router,{branchFilter}){
 const handle=work=>async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const selected=scope(req.user,branchFilter);if(!req.db)fail(503,'no_tenant');
   const body=await work(req,selected);
   const json=JSON.stringify(body);if(Buffer.byteLength(json)>4*1024*1024)fail(413,'accounting_export_too_large');
   res.type('json').send(json);
  }catch(error){const status=error.code==='accounting_source_unsupported'?422:error.status||500;
   res.status(status).json({error:{code:status===500?'internal':error.code,message:'Could not read accounting source.'}});}
 };
 router.get('/accounting/sales',handle(async(req,selected)=>{
  if(Object.keys(req.query).some(k=>!['limit','cursor'].includes(k)))fail(400,'invalid_query');
  const limit=req.query.limit===undefined?25:Number(req.query.limit);
  if(!Number.isInteger(limit)||limit<1||limit>25||req.query.limit!==undefined&&!/^[1-9][0-9]*$/.test(req.query.limit))fail(400,'invalid_limit');
  const cursor=req.query.cursor===undefined?null:decode(req.query.cursor,selected.key);
  const unsupported=await req.db.collection('sales').findOne({$and:[selected.query,{$nor:[{_id:{$type:'objectId'}},{_id:{$type:'string'}}]}]},{projection:{_id:1}});
  if(unsupported)fail(422,'accounting_source_unsupported');
  const docs=[];
  // Explicit type partitions avoid Mongo comparison type-bracketing skipping
  // legacy string IDs after ObjectIds. Ordering never depends on mutable dates.
  for(const kind of cursor?.kind==='string'?['string']:['objectId','string']){
   const id={_id:{$type:kind==='objectId'?'objectId':'string'}};
   if(cursor?.kind===kind)id._id.$gt=idValue(kind,cursor.value);
   const rows=await req.db.collection('sales').find({$and:[selected.query,id]},{projection}).collation({locale:'simple'}).sort({_id:1}).limit(limit+1-docs.length).toArray();
   docs.push(...rows);if(docs.length>limit)break;
  }
  const more=docs.length>limit,page=docs.slice(0,limit),data=page.map(row=>exportSale(row,selected.license));
  const last=data.at(-1)?.sourceId;
  const next=more?Buffer.from((last.kind==='objectId'?'oid:':'str:')+JSON.stringify({version:1,scope:selected.key,...last})).toString('base64url'):null;
  return {schema:'posnic.sale-source-page.v1',data,meta:{count:data.length,next_cursor:next}};
 }));
 router.get('/accounting/sales/:kind/:id',handle(async(req,selected)=>{
  if(Object.keys(req.query).length)fail(400,'invalid_query');
  validateId(req.params.kind,req.params.id);
  const row=await req.db.collection('sales').findOne({$and:[selected.query,{_id:idValue(req.params.kind,req.params.id)}]},{projection,collation:{locale:'simple'}});
  if(!row)fail(404,'not_found');
  return {schema:'posnic.sale-source-item.v1',data:exportSale(row,selected.license)};
 }));
}
function spec(){
 const record={type:'object',required:['sourceId','revision','sourceJson'],properties:{sourceId:{type:'object',required:['kind','value'],properties:{kind:{type:'string',enum:['objectId','string']},value:{type:'string',maxLength:256}}},revision:{type:'string',pattern:'^[a-f0-9]{64}$'},sourceJson:{type:'string',description:'Selected stored evidence; not proof of a settled payment or permission to post.'}}};
 const errors={400:{description:'Invalid query, identity or scope-specific cursor'},401:{description:'Authentication required'},403:{description:'Sales read permission and valid shop/branch scope required'},413:{description:'Page exceeds the 4 MiB response limit'},422:{description:'Stored data cannot be represented safely'},429:{description:'Rate limit exceeded'}};
 return {
  '/accounting/sales':{get:{summary:'Review selected sale accounting evidence',description:'ObjectIds then string IDs, ordered by identity. This is a live browse, not a change feed or immutable snapshot. Restart browsing to discover earlier inserts; refetch an item before saving its reviewed revision.',parameters:[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:25,default:25}},{name:'cursor',in:'query',schema:{type:'string',maxLength:2048}}],responses:{...errors,200:{description:'Selected sources and the next scope-specific cursor',content:{'application/json':{schema:{type:'object',properties:{schema:{type:'string',enum:['posnic.sale-source-page.v1']},data:{type:'array',items:record},meta:{type:'object',properties:{count:{type:'integer'},next_cursor:{type:'string',nullable:true}}}}}}}}}}},
  '/accounting/sales/{kind}/{id}':{get:{summary:'Read the current revision of a typed sale identity',parameters:[{name:'kind',in:'path',required:true,schema:{type:'string',enum:['objectId','string']}},{name:'id',in:'path',required:true,schema:{type:'string',maxLength:256}}],responses:{...errors,404:{description:'No such sale in the permitted scope'},200:{description:'Selected source and revision',content:{'application/json':{schema:{type:'object',properties:{schema:{type:'string',enum:['posnic.sale-source-item.v1']},data:record}}}}}}}}
 };
}
module.exports={mount,spec};
