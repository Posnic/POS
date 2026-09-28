'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {KitchenAudioQueue}=require('../src/kitchen-audio-queue');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sound-options-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const config={talkEnabled:true,outputs:[{id:'speaker',label:'Kitchen'}],talkTing:false,pauseWhileRecording:true};return {config,q:new KitchenAudioQueue(path.join(dir,'queue.json'),()=>config),dir};}
test('manual ting is optional, selected independently and queued in the same message before speech',t=>{
 const {q,config}=setup(t),data='data:audio/webm;base64,YQ==';
 let session=q.start('staff');q.voice('staff',session.id,data);assert.equal(q.jobs[0].steps.length,1);
 config.talkTing=true;config.talkBell='rising';session=q.start('staff');q.voice('staff',session.id,data);
 assert.equal(q.jobs[1].steps.length,2);assert.match(q.jobs[1].steps[0].audio,/^data:audio\/wav/);assert.equal(q.jobs[1].steps[1].audio,data);
 assert.equal(q.jobs[0].steps.length,1,'saved messages retain their original sound choices');
});
test('recording pause preference changes interruptions, never enables overlapping playback',t=>{
 const {q,config}=setup(t);q.enqueue({steps:[{text:'Order'}]},'order');q.start('staff');assert.equal(q.next(),null);
 config.pauseWhileRecording=false;assert.equal(q.next().jobId,'order');
 config.talkEnabled=false;assert.throws(()=>q.start('another'),/disabled/);
});
test('new options survive saving other settings and preserve legacy defaults',t=>{
 const {dir}=setup(t),settings=require('../src/kitchen-announce');settings.useApp({getPath:()=>dir});t.after(()=>settings.useApp(null));
 assert.equal(settings.settings().itemTing,true);assert.equal(settings.settings().talkTing,false);
 settings.set({speak:true,talkEnabled:false,talkTing:true,talkBell:'soft',itemTing:false,pauseWhileRecording:false});settings.set({volume:.5});
 const saved=settings.settings();assert.equal(saved.speak,true);assert.equal(saved.talkEnabled,false);assert.equal(saved.talkTing,true);assert.equal(saved.itemTing,false);assert.equal(saved.pauseWhileRecording,false);
});
test('automatic arrival ting can play without a ting before every dish',()=>{
 let message;const win={isDestroyed:()=>false,webContents:{send:(_event,data)=>message=data}};
 require('../src/order-alert').announceKitchenTicket(()=>win,{table:'5',items:[{item_name:'Rice',item_quantity:1}]},{ting:true,speak:true,itemTing:false});
 assert.match(message.sound,/^data:audio/);assert.equal(message.itemSound,'');
});
test('Kitchen Sound saves both source choices and their independent sound options together',async t=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/hardware-manager.html'),'utf8'),{runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,d=w.document;let saved={outputs:[{id:'speaker',label:'Kitchen'}],talkEnabled:false,talkBell:'rising',volume:1},submitted;
 w.electronAPI={kitchenCall:{get:async()=>saved,bells:async()=>({arrival:['rising','soft']}),set:async value=>{submitted=value;saved={...saved,...value};return true;}},kitchenAudio:{},kot:{getConfig:async()=>({branches:[]})}};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{enumerateDevices:async()=>[{kind:'audiooutput',deviceId:'speaker',label:'Kitchen'}]}});w.setInterval=()=>1;
 w.eval(fs.readFileSync(path.join(__dirname,'../src/kitchen-audio-controls.js'),'utf8'));await new Promise(r=>setImmediate(r));
 d.getElementById('kitchenSpeak').checked=false;d.getElementById('kitchenTing').checked=false;d.getElementById('kitchenTalkEnabled').checked=true;d.getElementById('kitchenTalkTing').checked=true;d.getElementById('kitchenTalkBell').value='soft';
 await w.saveKitchenAudioSettings();assert.equal(submitted.speak,false);assert.equal(submitted.talkEnabled,true);assert.equal(submitted.talkTing,true);assert.equal(submitted.talkBell,'soft');
 d.getElementById('kitchenSpeak').checked=true;d.getElementById('kitchenTalkEnabled').checked=false;await w.saveKitchenAudioSettings();assert.equal(submitted.speak,true);assert.equal(submitted.talkEnabled,false);
});
