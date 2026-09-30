'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
test('Captain route requires authentication, sales permission, and authenticated branch context',async()=>{
 const routes=[], protect=()=>{},router={use:fn=>routes.push(fn),post:(...args)=>routes.push(args),get(){}};
 let allow=false,forwarded;
 const context={module:{exports:{}},setTimeout,clearTimeout,process:{listenerCount:()=>1,emit:(_name,value,done)=>{forwarded=value;done(null,{id:'session'});}},require:name=>{
  if(name==='express')return {Router:()=>router};
  if(name==='express-rate-limit')return {rateLimit:()=>()=>{}};
  if(name.endsWith('/auth'))return {protect};
  if(name.endsWith('/branch-access'))return {allowed:()=>allow,context:async()=>({license:'license',branchId:'trusted-branch',branch:{}})};
  if(name.endsWith('/captain-access'))return {fail:(_c,message,status)=>{throw Object.assign(Error(message),{status});}};
  if(name.endsWith('/kitchen-voice'))return {prepare:async()=>null,markQueued:async()=>{}};
  return {};
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/src/routes/captain-access.routes.js'),'utf8'),context);
 const route=routes.find(r=>Array.isArray(r)&&r[0]==='/kitchen-audio/:action');assert.ok(routes.indexOf(protect)<routes.indexOf(route));
 let status=200,body;const res={set(){},status(s){status=s;return this;},json(v){body=v;}};
 const req={params:{action:'start'},user:{_id:'staff'},body:{branchId:'spoofed'}};
 await route.at(-1)(req,res);assert.equal(status,403);assert.equal(forwarded,undefined);
 allow=true;status=200;await route.at(-1)(req,res);assert.equal(status,200);assert.equal(body.id,'session');assert.equal(forwarded.branchId,'trusted-branch');assert.equal(forwarded.owner,'license:staff');
 req.params.action='delete';await route.at(-1)(req,res);assert.equal(status,400);
});
test('desktop speaker rejects Captain from another branch and disabled talk',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-access-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bus=new EventEmitter(),settings={talkEnabled:true,branchId:'kitchen-branch',outputs:[{id:'speaker',label:'Kitchen'}]};
 class Window extends EventEmitter {constructor(){super();this.webContents=new EventEmitter();}loadFile(){return Promise.resolve();}destroy(){this.emit('closed');}}
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/kitchen-audio.js'),'utf8'),{module,__dirname:path.join(__dirname,'../src'),process:bus,console,setInterval:()=>({unref(){}}),clearInterval(){},require:name=>{
  if(name==='./kitchen-announce')return {settings:()=>settings};
  if(name==='./kitchen-audio-queue')return require('../src/kitchen-audio-queue');
  return require(name);
 }});
 const app=new EventEmitter();app.getPath=()=>dir;
 module.exports.install({app,BrowserWindow:Window,ipcMain:{handle(){}}});
 const send=request=>new Promise(resolve=>bus.emit('posnic:kitchen-audio',request,(error,result)=>resolve({error,result})));
 const denied=await send({action:'start',branchId:'other',owner:'staff'});assert.match(denied.error.message,/branch/);
 const good=await send({action:'start',branchId:'kitchen-branch',owner:'staff'});assert.ok(good.result.id);
 settings.talkEnabled=false;assert.match((await send({action:'start',branchId:'kitchen-branch',owner:'staff'})).error.message,/disabled/);
 app.emit('before-quit');
});
