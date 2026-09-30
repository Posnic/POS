const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t, initial = {}){
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/hardware-manager.html'),'utf8'),{runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,d=w.document,calls=[];let sequence=0,fail=false,stopped=0;
 w.HTMLMediaElement.prototype.pause=function(){};
 let saved={outputs:[{id:'speaker',label:'Kitchen'}],talkEnabled:true,...initial};
 w.electronAPI={kitchenCall:{get:async()=>saved,set:async value=>{saved={...saved,...value};return true;},bells:async()=>({arrival:[]})},kot:{getConfig:async()=>({branches:[]})},kitchenAudio:{
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

test('disabled voice messages block IPC until enabled and saved', async t => {
 const {w,d,calls}=await setup(t,{talkEnabled:false});const button=d.getElementById('kitchenTalk');
 assert.equal(button.disabled,true);assert.match(d.getElementById('kitchenTalkSetup').textContent,/Voice messages are off/);
 button.click();await tick();assert.equal(calls.length,0);
 const enable=d.getElementById('kitchenTalkEnabled');enable.checked=true;enable.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(button.disabled,true);assert.match(d.getElementById('kitchenTalkSetup').textContent,/Save changes/);
 await w.saveKitchenAudioSettings();assert.equal(button.disabled,false);assert.equal(d.getElementById('kitchenTalkSetup').hidden,true);
 button.click();await tick();assert.equal(calls.filter(c=>c[0]==='start').length,1);button.click();await tick();
});
test('missing speakers block recording and backend state is rechecked before requesting a microphone', async t => {
 const {w,d,calls}=await setup(t,{outputs:[]});
 assert.equal(d.getElementById('kitchenTalk').disabled,true);assert.match(d.getElementById('kitchenTalkSetup').textContent,/Select a kitchen speaker/);
 d.getElementById('kitchenTalk').click();assert.equal(calls.length,0);
});
test('a setting disabled elsewhere is handled without calling the audio start IPC', async t => {
 const {w,d,calls}=await setup(t);
 w.electronAPI.kitchenCall.get=async()=>({talkEnabled:false,outputs:[{id:'speaker'}]});
 d.getElementById('kitchenTalk').click();await tick();assert.equal(calls.length,0);assert.equal(d.getElementById('kitchenTalk').disabled,true);
});
