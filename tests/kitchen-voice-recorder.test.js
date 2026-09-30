const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t){
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/hardware-manager.html'),'utf8'),{runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,d=w.document,calls=[];let sequence=0,fail=false,stopped=0;
 w.HTMLMediaElement.prototype.pause=function(){};
 w.electronAPI={kitchenCall:{get:async()=>({outputs:[{id:'speaker',label:'Kitchen'}]}),bells:async()=>({arrival:[]})},kot:{getConfig:async()=>({branches:[]})},kitchenAudio:{
 start:async()=>{const id='session-'+(++sequence);calls.push(['start',id]);return {id};},
 cancel:async(id)=>calls.push(['cancel',id]),voice:async(id,data)=>{calls.push(['voice',id,data]);if(fail){fail=false;throw Error('Response lost');}return {id,queued:true};}
 }};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{enumerateDevices:async()=>[],getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}});
 w.MediaRecorder=class{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new w.Blob(['voice'])});void this.onstop();}};
 w.FileReader=class{readAsDataURL(){this.result='data:audio/webm;base64,dm9pY2U=';this.onload();}};
 w.eval(fs.readFileSync(path.join(__dirname,'../src/kitchen-audio-controls.js'),'utf8'));await tick();
 return {w,d,calls,failNext:()=>{fail=true;},stopped:()=>stopped};
}
test('desktop stops for review, releases the recording pause, and retries one immutable upload',async t=>{
 const {d,calls,failNext,stopped}=await setup(t);
 d.getElementById('kitchenTalk').click();await tick();assert.match(d.getElementById('kitchenTalk').textContent,/Stop/);
 d.getElementById('kitchenTalk').click();await tick();
 assert.equal(calls.filter(c=>c[0]==='voice').length,0,'Stop never sends');
 assert.equal(d.getElementById('kitchenTalkPreview').hidden,false);assert.ok(stopped());
 assert.deepEqual(calls.find(c=>c[0]==='cancel'),['cancel','session-1']);
 failNext();d.getElementById('kitchenTalkSend').click();await tick();
 assert.equal(d.getElementById('kitchenTalkPreview').hidden,false);
 d.getElementById('kitchenTalkSend').click();await tick();
 assert.deepEqual(calls.filter(c=>c[0]==='voice').map(c=>c[1]),['session-2','session-2']);
 assert.equal(d.getElementById('kitchenTalkPreview').hidden,true);
});
test('discarding a desktop draft never broadcasts it',async t=>{
 const {d,calls}=await setup(t);d.getElementById('kitchenTalk').click();await tick();d.getElementById('kitchenTalk').click();await tick();
 d.getElementById('kitchenTalkDiscard').click();assert.equal(d.getElementById('kitchenTalkSend').hidden,true);assert.equal(calls.some(c=>c[0]==='voice'),false);
});
