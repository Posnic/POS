'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient,ObjectId}=require('mongodb');
const ExcelJS=require('exceljs');
const service=require('../src/services/spoilage'),inventory=require('../src/services/mobile-inventory');
let server,client,db,req,product;
before(async()=>{server=await MongoMemoryServer.create();client=await MongoClient.connect(server.getUri());db=client.db('spoilage_test');require('../src/models/base.model').getDb=async()=>db;});
after(async()=>{await client?.close();await server?.stop();});
beforeEach(async()=>{await db.dropDatabase();const license=new ObjectId(),branch=new ObjectId(),user=new ObjectId();req={db,user:{_id:user,license,username:'Operator',usertype:'staff',access:{item:{read:true,write:true}},branch_access:[{branch_id:branch}]},tenantContext:{licenseId:String(license),branchId:String(branch)},params:{},query:{},method:'POST'};
await db.collection('branches').insertOne({_id:branch,license,time_zone:'Asia/Kolkata'});await db.collection('users').insertOne({...req.user});product={_id:new ObjectId(),license,branch_id:branch,name:'Onion',itemid:'2',unit:'kg',company_price:20,available_quantity:10,track_inventory:true,item_weight_machine_based:true,updated_date:new Date()};await db.collection('items').insertOne(product);});
const owner=()=>({...req,user:{...req.user,_id:new ObjectId(),username:'Manager',usertype:'owner'}});
async function draft(overrides={}){const r=await service.save({...req,body:{clientId:'spoilage-test-request',occurredOn:'2026-10-30',lines:[{itemId:String(product._id),quantity:1500,reason:'Transit damage',remarks:'Crushed in transit'}],...overrides}});req.params={id:r.id};return r;}
async function pending(){const d=await draft();return service.submit({...req,body:{revision:d.revision}});}
async function stock(){return (await db.collection('items').findOne({_id:product._id})).available_quantity;}
test('draft, submission, authorised approval and concurrent retry deduct exactly once',async()=>{
const d=await draft();assert.equal(d.state,'draft');assert.equal(d.lines[0].estimatedValue,30);assert.equal(await stock(),10);
await service.submit({...req,body:{revision:d.revision}});assert.equal(await stock(),10);
await assert.rejects(service.decide({...req,body:{decision:'accept'}}),/authorised/);
const a=owner(),b=owner();await Promise.all([service.decide({...a,body:{decision:'accept'}}),service.decide({...b,body:{decision:'accept'}})]);
assert.equal(await stock(),8.5);assert.equal(await db.collection('stocklogs').countDocuments(),1);
const saved=await service.get(req);assert.equal(saved.state,'accepted');assert.equal(saved.applied.length,1);assert(saved.audit.some(a=>a.action==='Accepted'));
const log=await db.collection('stocklogs').findOne();assert.equal(log.spoilage_reference,d.id);
await assert.rejects(inventory.confirm({...a,params:{id:saved.operationId}}),/spoilage approval/);
});
test('rejection records remarks and never changes stock; submitted entries cannot be edited',async()=>{
await pending();await assert.rejects(service.decide({...owner(),body:{decision:'reject'}}),/reason for rejection/);
const r=await service.decide({...owner(),body:{decision:'reject',note:'Wrong consignment'}});assert.equal(r.state,'rejected');assert.equal(await stock(),10);
assert.equal(r.audit.at(-1).note,'Wrong consignment');await assert.rejects(draft({occurredOn:'2026-10-29'}),/changed or was submitted/);
});
test('validations reject duplicate, over-stock, precision, foreign and deleted items',async()=>{
const line={itemId:String(product._id),quantity:1500,reason:'Other',remarks:'Test'};
await assert.rejects(draft({lines:[line,line]}),/only once/);
await assert.rejects(draft({lines:[{...line,quantity:11000}]}),/exceeds/);
await assert.rejects(draft({lines:[{...line,quantity:1.5}]}),/three decimals/);
await assert.rejects(draft({lines:[{...line,itemId:String(new ObjectId())}]}),/unavailable/);
await assert.rejects(draft({occurredOn:'2026-02-30'}),/valid date/);
await db.collection('items').updateOne({_id:product._id},{$set:{del_status:1}});await assert.rejects(draft(),/unavailable/);
});
test('acceptance rechecks stock and conflict retry cannot double-apply earlier lines',async()=>{
const second={...product,_id:new ObjectId(),name:'Potato',itemid:'10'};await db.collection('items').insertOne(second);
const d=await draft({lines:[product,second].map(p=>({itemId:String(p._id),quantity:1500,reason:'Spoilage',remarks:'Inspection'}))});await service.submit({...req,body:{revision:d.revision}});
await db.collection('items').updateOne({_id:second._id},{$set:{available_quantity:1}});
let result=await service.decide({...owner(),body:{decision:'accept'}});assert.equal(result.state,'conflict');assert.equal(await stock(),8.5);
await assert.rejects(service.decide({...owner(),body:{decision:'reject',note:'Cannot reject partial'}}),/Only a pending/);
await db.collection('items').updateOne({_id:second._id},{$set:{available_quantity:3}});
result=await service.decide({...owner(),body:{decision:'accept'}});assert.equal(result.state,'accepted');assert.equal(await stock(),8.5);assert.equal((await db.collection('items').findOne({_id:second._id})).available_quantity,1.5);
assert.equal(await db.collection('stocklogs').countDocuments(),2);
});
test('reversal needs approval, restores once and preserves original history',async()=>{
await pending();await service.decide({...owner(),body:{decision:'accept'}});const original=req.params.id;
const reversal=await service.reverse({...owner(),body:{note:'Incorrect spoiled quantity'}});assert.equal(reversal.state,'pending');assert.equal(await stock(),8.5);
assert.equal((await service.get(req)).state,'reversal_pending');
const approve={...owner(),params:{id:reversal.id},body:{decision:'accept'}};await service.decide(approve);await service.decide(approve);
assert.equal(await stock(),10);assert.equal((await service.get(req)).state,'reversed');assert.equal(await db.collection('stocklogs').countDocuments(),2);
assert.equal((await service.reverse({...owner(),body:{note:'Retry same reversal'}})).id,reversal.id);
});
test('rejected reversal leaves stock unchanged and can be requested again',async()=>{
await pending();await service.decide({...owner(),body:{decision:'accept'}});const reversal=await service.reverse({...owner(),body:{note:'Recheck'}});
await service.decide({...owner(),params:{id:reversal.id},body:{decision:'reject',note:'Need investigation'}});assert.equal(await stock(),8.5);assert.equal((await service.get(req)).state,'accepted');
const retry=await service.reverse({...owner(),body:{note:'Investigation complete'}});assert.equal(retry.state,'pending');await service.decide({...owner(),params:{id:retry.id},body:{decision:'accept'}});assert.equal(await stock(),10);
});
test('branch isolation and read-only synced snapshots prevent replay on another installation',async()=>{
await pending();const d=await service.get(req);const other=client.db('other_spoilage');await other.dropDatabase();
await other.collection('branches').insertOne(await db.collection('branches').findOne());await other.collection('spoilage_entries').insertOne(await db.collection('spoilage_entries').findOne());
const remote={...owner(),db:other};const mirrored=await service.get(remote);assert.equal(mirrored.local,false);assert.equal(mirrored.canApprove,false);
await assert.rejects(service.decide({...remote,body:{decision:'accept'}}),/another installation/);
const alien={...req,tenantContext:{...req.tenantContext,licenseId:String(new ObjectId())}};await assert.rejects(service.get(alien),/Branch not found/);
});
test('daily report and Excel separate pending, rejected, accepted losses and reversals',async()=>{
await pending();const rows=await service.daily(db,{branch:req.tenantContext.branchId,license:req.tenantContext.licenseId,from:'2026-10-30',to:'2026-10-30'});assert.equal(rows[0].state,'pending');assert.equal(rows[0].applied,undefined);
await service.decide({...owner(),body:{decision:'accept'}});const file=await service.report({...req,query:{from:'2026-10-30',to:'2026-10-30'}});const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(file.base64,'base64'));assert.equal(book.worksheets[0].getCell('J2').value,1.5);assert.equal(book.worksheets[0].getCell('N2').value,30);
assert.equal((await service.list({...req,query:{status:'pending'}})).rows.length,0);
});
test('only administrators assign branch approvers; designated staff can approve',async()=>{
await assert.rejects(service.policy(req),/administrator/);
await service.policy({...owner(),body:{approvers:[String(req.user._id)]}});await pending();const r=await service.decide({...req,body:{decision:'accept'}});assert.equal(r.state,'accepted');
await assert.rejects(service.policy({...owner(),body:{approvers:[String(new ObjectId())]}}),/assigned to this branch/);
});
test('real stock screen saves stock directly without approval controls',async()=>{
const {JSDOM}=require('jsdom'),fs=require('fs');const dom=new JSDOM('<div id="inventory_count_detail"></div>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
try{
w.eval(fs.readFileSync(require('path').join(__dirname,'../../frontend/static/script/js/jquery.min.js'),'utf8'));
w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=function(){}; w.crypto.randomUUID=require('crypto').randomUUID;w.confirm=()=>true;
w.prompt=()=>{throw Error('prompt() is not supported.');};
w.swal=async options=>options.preConfirm('Local test reversal');
const actor=req.user;
w.PosnicPro={local:{get:()=>req.tenantContext.branchId},i18n:{t:(k,v)=>v},request:async(o,ok,bad)=>{try{
const u=new URL(o.url,'http://localhost'),body=o.data?JSON.parse(o.data):{},request={...req,user:actor,query:Object.fromEntries(u.searchParams),body,method:o.method||'GET'};let data;
if(u.pathname==='/items/priceSheet')data=[{id:req.tenantContext.branchId,name:'Test branch'}];
else if(u.pathname==='/inventory-counts/catalogue')data=await inventory.catalogue(request);
else if(u.pathname==='/inventory-counts/spoilage')data=await service[o.method==='POST'?'save':'list'](request);
else if(u.pathname==='/inventory-counts/spoilage/record')data=await service.record(request);
else {const parts=u.pathname.split('/');request.params={id:parts[3]};data=await service[parts[4]==='decision'?'decide':parts[4]||'get'](request);}
ok({type:'success',data:JSON.parse(JSON.stringify(data))});}catch(e){bad({responseJSON:{message:e.message}});}}};
w.eval(fs.readFileSync(require('path').join(__dirname,'../../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error(w.document.body.textContent);};
await w.PosnicPro.inventorycounts.openSpoilage();w.$('#sp_new').click();await wait(()=>w.$('.sp_add_result').length);
w.$('.sp_add_result').first().click();w.$('.sp_qty').val('1.500');w.$('.sp_remarks').val('Crushed in transit');w.$('#sp_save').click();await wait(()=>w.$('#sp_reverse').length);
assert.equal(await stock(),8.5);assert.match(w.$('#sp_detail').text(),/Saved/);
assert.equal(w.$('#sp_policy,#sp_accept,#sp_submit_new').length,0);
w.$('#sp_reverse').click();await wait(()=>/Local test reversal/.test(w.$('#sp_detail').text()));
assert.equal(await stock(),10);
}finally{dom.window.close();}
});

test('direct recording and undo by stock writer are idempotent without approver setup',async()=>{
const body={clientId:'direct-spoilage-test',occurredOn:'2026-10-30',lines:[{itemId:String(product._id),quantity:1500,reason:'Spoilage',remarks:'Damaged'}]};
const recorded=await service.record({...req,body}); req.params={id:recorded.id};
assert.equal(recorded.state,'accepted');assert.equal(await stock(),8.5);
await service.record({...req,body});assert.equal(await stock(),8.5);
await service.undo({...req,body:{note:'Incorrect entry'}});await service.undo({...req,body:{note:'Retry'}});
assert.equal(await stock(),10);assert.equal(await db.collection('stocklogs').countDocuments(),2);
const denied={...req,user:{...req.user,access:{item:{read:true,write:false}}}};
await assert.rejects(service.record({...denied,body:{...body,clientId:'unauthorised-request'}}));
});


test('spoilage Excel preview validates branch and quantities without writing stock or entries',async()=>{
  const sheets=require('../src/services/spoilage-sheet'),ExcelJS=require('exceljs');
  const exported=await sheets.download(req),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(exported.base64,'base64'));
  const sheet=book.worksheets[0];sheet.getCell(2,5).value=0.125;sheet.getCell(2,6).value='Handling damage';sheet.getCell(2,7).value='Damaged in transit';
  const upload=async()=>sheets.upload({...req,file:{originalname:'spoilage.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer())}});
  const result=await upload();assert.equal(result.lines.length,1);assert.equal(result.lines[0].quantity,125);assert.equal(await stock(),10);assert.equal(await db.collection('spoilage_commands').countDocuments(),0);
  sheet.getCell(2,9).value=String(new ObjectId());await assert.rejects(upload(),/another branch/);
  sheet.getCell(2,9).value=String(product.branch_id);sheet.getCell(2,5).value=11;await assert.rejects(upload(),/exceeds/);
  sheet.getCell(2,5).value={formula:'1+1'};await assert.rejects(upload(),/formulas/);
});

test('spoilage remarks are optional but reasons and the 500 character limit remain enforced',async()=>{
 const line={itemId:String(product._id),quantity:125,reason:'Spoilage'};
 for(const remarks of [undefined,null,'','   ']){const result=await service.previewLines(req,[{...line,remarks}]);assert.equal(result[0].remarks,'');}
 await assert.rejects(service.previewLines(req,[{...line,reason:''}]),/reason/);
 await assert.rejects(service.previewLines(req,[{...line,remarks:'a'.repeat(501)}]),/500/);
 const saved=await service.record({...req,body:{clientId:'optional-remarks-test-request',occurredOn:'2026-10-30',lines:[line]}});
 assert.equal(saved.state,'accepted');assert.equal(saved.lines[0].remarks,'');assert.equal(await stock(),9.875);
});


test('history pagination returns 25 unique records and a cursor for the remaining rows',async()=>{
 const original=await draft();const entry=await db.collection('spoilage_entries').findOne({_id:new ObjectId(original.id)});
 await db.collection('spoilage_entries').insertMany(Array.from({length:26},(_,i)=>({...entry,_id:new ObjectId(),clientId:'page-'+i,reference:'PAGE-'+i})));
 const first=await service.list({...req,query:{limit:25}});assert.equal(first.rows.length,25);assert(first.next);
 const second=await service.list({...req,query:{limit:25,after:first.next}});assert.equal(second.rows.length,2);assert.equal(second.next,null);
 assert.equal(new Set([...first.rows,...second.rows].map(x=>String(x._id))).size,27);assert.equal(await stock(),10);
});

test('spoilage details omit history and audit view is scoped and read only',async()=>{
await draft();
const detail=await service.get({...req,query:{view:'details'}});assert.equal(detail.audit,undefined);assert(detail.lines.length);
const history=await service.get({...req,query:{view:'audit'}});assert.equal(history.audit[0].action,'Created');assert.equal(history.lines,undefined);
assert.equal(await stock(),10);
await assert.rejects(service.get({...req,params:{id:String(new ObjectId())},query:{view:'audit'}}),/not found/);
await db.collection('spoilage_commands').deleteOne({_id:new ObjectId(req.params.id)});
const shared=await service.get({...req,query:{view:'audit'}});assert.equal(shared.audit[0].action,'Created');
});
