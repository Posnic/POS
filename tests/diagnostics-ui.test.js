'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
function setup() {
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/diagnostics.html'),'utf8'),{runScripts:'outside-only'}),w=dom.window;
 const state={active:false,expiresAt:Date.now()+1800000,health:[],uploadAvailable:true}; const calls=[];
 w.setInterval=()=>0;
 const api={state:async()=>state,start:async()=>{calls.push('start');state.active=true;},stop:async()=>{calls.push('stop');state.active=false;state.remote=null;},upload:async()=>calls.push('upload'),export:async()=>{calls.push('export');return {saved:true};},connect:async data=>{calls.push(data);state.remote={lastUpload:new Date().toISOString()};}};
 w.electronAPI={diagnostics:api};w.eval(fs.readFileSync(path.join(__dirname,'../src/diagnostics-ui.js'),'utf8')+';window.testRefresh=refresh;');
 return {dom,w,state,api,calls,click:id=>w.document.getElementById(id).click(),el:id=>w.document.getElementById(id)};
}
test('without a code advances step by step, records locally and saves after Finish without uploading',async()=>{
 const x=setup();await tick();assert.equal(x.el('step-choice').hidden,false);assert.equal(x.el('step-setup').hidden,true);assert.equal(x.w.document.querySelector('details').open,false);
 assert.equal(x.w.document.querySelector('input[value=remote]').checked,true);x.w.document.querySelector('input[value=local]').checked=true;x.click('next');await tick();assert.equal(x.el('step-setup').hidden,false);assert.equal(x.el('code-entry').hidden,true);assert.equal(x.calls.length,0);
 x.click('connect');await tick();assert.deepEqual(x.calls,['start']);assert.equal(x.el('step-running').hidden,false);assert.match(x.el('remote').textContent,/No report is being sent/);
 x.click('stop');await tick();assert.equal(x.el('step-done').hidden,false);x.click('export');await tick();assert.deepEqual(x.calls,['start','stop','export']);
 x.click('start');await tick();assert.equal(x.el('step-choice').hidden,false);x.dom.window.close();
});
test('with a code requires a code, shows progress and enters monitoring after connection',async()=>{
 const x=setup();await tick();x.w.document.querySelector('input[value=remote]').checked=true;x.click('next');await tick();assert.equal(x.el('code-entry').hidden,false);
 x.click('connect');await tick();assert.equal(x.calls.length,0);assert.match(x.el('status').textContent,/Paste your support code/);
 let resolve,received;x.api.connect=data=>{received=data;return new Promise(r=>{resolve=r;});};x.el('code').value='a'.repeat(64);x.click('connect');await tick();assert.match(x.el('status').textContent,/Connecting/);assert.equal(x.el('back').disabled,true);assert.equal(received.consent,true);assert.equal(received.code,'a'.repeat(64));
 x.state.remote={lastUpload:new Date().toISOString()};resolve();await tick();assert.equal(x.el('step-running').hidden,false);assert.match(x.el('remote').textContent,/Support is monitoring/);assert.equal(x.el('code').value,'');x.dom.window.close();
});
test('Back lets a customer switch from remote setup to local without connecting',async()=>{
 const x=setup();await tick();x.w.document.querySelector('input[value=remote]').checked=true;x.click('next');await tick();x.click('back');x.w.document.querySelector('input[value=local]').checked=true;x.click('next');await tick();assert.equal(x.el('code-entry').hidden,true);assert.equal(x.calls.length,0);x.dom.window.close();
});
test('expired recording reaches report saving and failed final upload still disconnects',async()=>{
 const x=setup();await tick();x.w.document.querySelector('input[value=local]').checked=true;x.click('next');await tick();x.click('connect');await tick();x.state.active=false;await x.w.testRefresh();assert.equal(x.el('step-done').hidden,false);
 x.state.active=true;x.state.remote={lastUpload:'2026-01-01T00:00:00Z'};await x.w.testRefresh();x.api.upload=async()=>{throw Error('Offline');};x.click('stop');await tick();assert.equal(x.state.active,false);assert.match(x.el('status').textContent,/could not be sent/);assert.equal(x.el('step-done').hidden,false);x.dom.window.close();
});
