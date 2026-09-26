'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kot-delivery-'));
const load=Module._load;
Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>root},BrowserWindow:class {
 constructor(){this.webContents={on(){},setWindowOpenHandler(){}};} async loadURL(){} close(){} on(){}
}};return load.call(this,name,...args);};
const KOT=require('../src/kot-manager'),ledger=require('../src/print-ledger'),{kotJobKey}=require('../src/kot-job-key');Module._load=load;
function rig(t,{windowPath=false,legacy=false}={}){
 const dir=fs.mkdtempSync(path.join(root,'case-'));let now=Date.now();t.mock.method(Date,'now',()=>now);
 const calls=[],marks=[];let behavior=()=>({success:true}),ack=true;
 const sale={_id:'sale1',sales_id:'S1',sale_process:'KOT',table_number:'23',items:[{item_name:'Rice',item_quantity:2}]};
 if(!legacy)sale.print_jobs=[{type:'new',timestamp:'2026-09-26T17:00:00Z',items:sale.items}];
 const config={branchId:'b1',printerNames:['Kitchen','Pass'],printers:[{name:'Kitchen',copies:2,pageSize:'80mm'},{name:'Pass',copies:1,pageSize:'58mm'}]};
 let announced=0;
 function make(){
  const manager=new KOT({hardware:windowPath?null:{sendRawToPrinter:async(name,bytes,label)=>{calls.push({name,label});return behavior(name,calls.length);}}});
  ledger.setDir(dir);manager.config=structuredClone(config);manager._announceToKitchen=()=>announced++;
  manager._waitForPrintPage=async()=>{};
  manager._printToDeviceWithFallback=async(_w,name,size,strict)=>{calls.push({name,size,strict});return behavior(name,calls.length);};
  return manager;
 }
 const manager=make();
 t.mock.method(global,'fetch',async(url,init)=>{
  if(url.includes('multiKitchenPrint'))return {ok:true,json:async()=>({data:[sale]})};
  marks.push(JSON.parse(init.body));return {ok:ack,status:ack?200:500};
 });
 return {manager,calls,marks,sale,dir,make,set(fn){behavior=fn;},tick(ms=300001){now+=ms;},get announced(){return announced;},ack(value){ack=value;}};
}
test('partial failure retries only missing copies after restart and retains original targets',async t=>{
 const r=rig(t);r.set((_name,n)=>({success:n!==2,error:'offline'}));
 await r.manager._pollOnce();assert.deepEqual(r.calls.map(x=>x.name),['Kitchen','Kitchen','Pass']);assert.equal(r.marks.length,0);
 await r.manager._pollOnce();assert.equal(r.calls.length,3,'retry backoff');
 r.tick();const restarted=r.make();restarted.config.printers=[{name:'New printer',copies:4}];
 await restarted._pollOnce();assert.deepEqual(r.calls.map(x=>x.name),['Kitchen','Kitchen','Pass','Kitchen']);assert.equal(r.marks.length,1);
 assert.equal(r.calls[3].label,r.calls[1].label,'retry changed the KOT number or copy number');
 await restarted._pollOnce();assert.equal(r.calls.length,4,'lost acknowledgement must not duplicate');
});
test('a driver exception does not stop later printers and only the failed copy retries',async t=>{
 const r=rig(t);r.set((_name,n)=>{if(n===1)throw Error('driver disconnected');return {success:true};});
 await r.manager._pollOnce();assert.equal(r.calls.length,3);assert.equal(r.marks.length,0);
 r.tick();await r.manager._pollOnce();assert.equal(r.calls.length,4);assert.equal(r.marks.length,1);assert.equal(r.announced,1);
});
test('window path keeps all copies and paper sizes, catches errors, and never uses a default printer',async t=>{
 const r=rig(t,{windowPath:true});r.set((_name,n)=>{if(n===1)throw Error('driver disconnected');return {success:true};});
 await r.manager._pollOnce();assert.deepEqual(r.calls.map(x=>[x.name,x.size,x.strict]),[['Kitchen','80mm',true],['Kitchen','80mm',true],['Pass','58mm',true]]);assert.equal(r.marks.length,0);
 r.tick();await r.manager._pollOnce();assert.equal(r.calls.length,4);assert.equal(r.marks.length,1);
});
test('a long outage stays queued after more than three attempts and eventually recovers',async t=>{
 const r=rig(t);r.set(name=>({success:name==='Pass',error:'offline'}));
 for(let i=0;i<6;i++){await r.manager._pollOnce();r.tick();}
 assert.equal(r.marks.length,0);assert.equal(r.calls.filter(x=>x.name==='Pass').length,1);
 r.set(()=>({success:true}));await r.manager._pollOnce();assert.equal(r.marks.length,1);
});
test('an interrupted copy is not guessed successful or automatically duplicated; unattempted copies still print',async t=>{
 const r=rig(t);const key=kotJobKey(r.sale._id,r.sale.print_jobs[0]);ledger.claim(key);
 ledger.deliveryPlan(key,r.manager.config.printers);ledger.beginDelivery(key,0);
 const restarted=r.make();await restarted._pollOnce();
 assert.deepEqual(r.calls.map(x=>x.name),['Kitchen','Pass']);assert.equal(r.marks.length,0);
 assert.equal(ledger.deliveryPlan(key)[0].state,'attempted');
});
test('legacy sales also keep a missing printer queued without duplicating successful copies',async t=>{
 const r=rig(t,{legacy:true});r.set(name=>({success:name==='Pass',error:'offline'}));await r.manager._pollOnce();assert.equal(r.marks.length,0);
 r.tick();r.set(()=>({success:true}));await r.manager._pollOnce();assert.equal(r.calls.length,5);assert.equal(r.marks.length,1);
});
test('counter retry does not return success while one kitchen copy is missing',async t=>{
 const r=rig(t);r.sale.print_jobs[0].key='counter-key';r.set((_name,n)=>({success:n!==2,error:'offline'}));
 assert.equal((await r.manager.printCounterTicket(r.sale)).success,false);
 r.tick();assert.equal((await r.manager.printCounterTicket(r.sale)).success,true);assert.equal(r.calls.length,4);
 assert.equal((await r.manager.printCounterTicket(r.sale)).success,true);assert.equal(r.calls.length,4);
});
test('pending deliveries survive the normal ledger age limit',t=>{
 const r=rig(t);ledger.claim('old');ledger.deliveryPlan('old',r.manager.config.printers);
 const file=path.join(r.dir,'print-ledger.json');const data=JSON.parse(fs.readFileSync(file));data.entries.old.day='2000-01-01';fs.writeFileSync(file,JSON.stringify(data));ledger.setDir(r.dir);
 assert.equal(ledger.deliveryPlan('old').length,3);
});
test('a layout fallback is decided before sending any raw copy',async t=>{
 const r=rig(t);r.manager._rawTicket=(_s,_k,_n,columns)=>columns===32?null:Buffer.from('ticket');
 await r.manager._pollOnce();assert.equal(r.calls.length,3);
 assert.ok(r.calls.every(c=>c.strict===true),'some copies were sent raw before the window fallback');
 assert.equal(r.marks.length,1);
});
