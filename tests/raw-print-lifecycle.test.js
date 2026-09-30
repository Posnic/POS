'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RawPrintService, powershellPath } = require('../src/raw-print-service');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(5); } assert.fail('condition did not settle'); }
function rig(t, options = {}) {
  const children = []; let throwSpawn = false;
  const service = new RawPrintService({ platform: 'win32', startupMs: 80, jobMs: 60,
    heartbeatMs: 10000, delays: [10, 20, 40], ...options,
    spawn: () => {
      if (throwSpawn) { throwSpawn = false; throw new Error('spawn denied'); }
      const c = new EventEmitter(); c.pid = children.length + 100; c.stdout = new EventEmitter();
      c.stdout.setEncoding = () => {}; c.stderr = new EventEmitter(); c.stdin = new EventEmitter();
      c.stdin.writable = true; c.writes = []; c.kills = 0;
      c.stdin.end = () => { c.stdin.writable = false; };
      c.stdin.write = (line, cb) => { c.writes.push(JSON.parse(line)); if (c.writeError) cb(new Error('EPIPE')); };
      c.kill = () => { c.kills++; if (!c.holdExit) queueMicrotask(() => c.emit('exit', 1)); return true; };
      c.ready = () => c.stdout.emit('data', 'READY\n');
      c.answer = (index, verb = 'OK', message = '') => c.stdout.emit('data', `${verb} ${c.writes[index].id} ${message}\n`);
      children.push(c); return c;
    } });
  t.after(() => service.stop());
  return { service, children, failSpawn: () => { throwSpawn = true; } };
}
test('concurrent USB and LAN callers share cold startup and clear startup timer', async t => {
 const {service:s,children:c}=rig(t);
 const a=s.send({printer:'Reception',file:'usb'}), b=s.send({printer:'Kitchen_New',file:'lan'});
 assert.equal(c.length,1); c[0].ready(); await until(()=>c[0].writes.length===2);
 assert.equal(s.state,'ready');assert.equal(s.attempt.timer,null);assert.equal(s.ready,null);
 c[0].answer(0,'OK','11');c[0].answer(1,'OK','12');
 assert.equal((await a).spoolerJobId,11);assert.equal((await b).spoolerJobId,12);
 assert.deepEqual(c[0].writes.map(j=>j.printer),['Reception','Kitchen_New']);
});
test('late READY after deadline cannot revive a rejected attempt; recovery is fresh',async t=>{
 const {service:s,children:c}=rig(t,{startupMs:25,delays:[40]});
 const first=s.send({printer:'Reception',file:'a'}); c[0].stderr.emit('data','compiler diagnostic');
 const failed=await first;assert.equal(failed.submission,'not-submitted');assert.match(failed.error,/Print helper startup failed/);
 assert.equal(s.ready,null);assert.ok(c[0].kills);c[0].ready();assert.notEqual(s.state,'ready');
 assert.match(s.lastDiagnostic.stderr,/compiler diagnostic/);
 await until(()=>c.length===2);const next=s.send({ping:true});c[1].ready();await until(()=>c[1].writes.length);
 c[1].answer(0);assert.equal((await next).success,true);
});
test('READY before deadline clears timer and does not kill healthy helper',async t=>{
 const {service:s,children:c}=rig(t,{startupMs:25});const start=s.warm();c[0].ready();assert.equal(await start,true);
 await pause(45);assert.equal(c[0].kills,0);assert.equal(s.state,'ready');
});
test('early exit and asynchronous spawn error recover without cached rejection',async t=>{
 const {service:s,children:c}=rig(t);const start=s.warm();c[0].emit('exit',9);assert.equal(await start,false);
 await until(()=>c.length===2);c[1].pid=undefined;c[1].emit('error',new Error('ENOENT'));
 await until(()=>c.length===3);c[2].ready();await until(()=>s.state==='ready');assert.equal(s.ready,null);
});
test('synchronous spawn failure can recover',async t=>{
 const r=rig(t);r.failSpawn();assert.equal(await r.service.warm(),false);assert.equal(r.service.ready,null);
 await until(()=>r.children.length);r.children[0].ready();assert.equal(await r.service.warm(),true);
});
test('old events cannot change replacement; no replacement until old child exits',async t=>{
 const {service:s,children:c}=rig(t,{startupMs:20});const p=s.warm();c[0].holdExit=true;
 assert.equal(await p,false);await pause(40);assert.equal(c.length,1);
 c[0].emit('exit',1);await until(()=>c.length===2);c[1].ready();await until(()=>s.state==='ready');
 c[0].emit('exit',1);c[0].emit('error',new Error('late'));c[0].ready();
 assert.equal(s.child,c[1]);assert.equal(s.state,'ready');
});
test('repeated callers cannot bypass recovery backoff',async t=>{
 const {service:s,children:c}=rig(t,{startupMs:20,delays:[100]});await s.warm();
 await Promise.all(Array.from({length:20},()=>s.send({ping:true})));assert.equal(c.length,1);
});
test('shutdown during startup resolves callers and cancels timers',async t=>{
 const {service:s,children:c}=rig(t);const p=s.send({printer:'Reception'});s.stop();
 assert.equal((await p).submission,'not-submitted');await pause(100);
 assert.equal(c.length,1);assert.equal(s.state,'stopped');assert.equal(s.ready,null);assert.equal(s.attempt.timer,null);
 assert.equal(s.restartTimer,null);assert.equal(s.heartbeatTimer,null);
 assert.equal((await s.send({ping:true})).success,false);
});
test('shutdown during backoff never restarts',async t=>{
 const {service:s,children:c}=rig(t,{startupMs:20,delays:[50]});await s.warm();s.stop();await pause(80);assert.equal(c.length,1);
});
test('stdin failure after write is uncertain, never marked unavailable',async t=>{
 const {service:s,children:c}=rig(t);const p=s.send({printer:'Reception',file:'x'});c[0].writeError=true;c[0].ready();
 const r=await p;assert.equal(r.submission,'uncertain');assert.equal(r.unavailable,undefined);
});
test('unwritable stdin before submission is safe non-submission',async t=>{
 const {service:s,children:c}=rig(t);const p=s.send({printer:'Reception'});c[0].stdin.writable=false;c[0].ready();
 assert.equal((await p).submission,'not-submitted');assert.equal(c[0].writes.length,0);
});
test('partial/error answer and accepted job are not retryable non-submissions',async t=>{
 const {service:s,children:c}=rig(t);const p=s.send({printer:'Reception'});c[0].ready();await until(()=>c[0].writes.length);
 c[0].answer(0,'ERR','Only 10 of 20 bytes reached the printer');assert.equal((await p).submission,'uncertain');
 const q=s.send({printer:'Kitchen_New'});await until(()=>c[0].writes.length===2);c[0].answer(1,'OK','42');assert.equal((await q).spoolerJobId,42);
});
test('helper can prove spooler rejection before acceptance',async t=>{
 const {service:s,children:c}=rig(t);const p=s.send({printer:'Reception'});c[0].ready();await until(()=>c[0].writes.length);
 c[0].answer(0,'NOTSENT','Could not open printer');assert.equal((await p).submission,'not-submitted');
});
test('idle heartbeat timeout retires helper without printer data',async t=>{
 const {service:s,children:c}=rig(t,{jobMs:25});const p=s.send({ping:true});c[0].ready();
 const r=await p;assert.equal(r.success,false);assert.deepEqual(Object.keys(c[0].writes[0]).sort(),['id','ping']);assert.ok(c[0].kills);
});
test('heartbeat timeout while receipt active does not kill or replay receipt',async t=>{
 const {service:s,children:c}=rig(t,{jobMs:100});const ping=s.send({ping:true});c[0].ready();await until(()=>c[0].writes.length);
 await pause(40);const job=s.send({printer:'Reception'});await until(()=>c[0].writes.length===2);
 assert.equal((await ping).success,false);assert.equal(c[0].kills,0);
 c[0].answer(1,'OK','9');assert.equal((await job).success,true);assert.equal(c[0].writes.length,2);
});
test('receipt timeout resolves uncertain and cannot be replayed by helper restart',async t=>{
 const {service:s,children:c}=rig(t,{jobMs:25});const p=s.send({printer:'Reception'});c[0].ready();
 assert.equal((await p).submission,'uncertain');await until(()=>c.length===2);c[1].ready();await pause(10);assert.equal(c[1].writes.length,0);
});
test('PowerShell path is absolute and does not depend on PATH lookup',()=>{
 assert.match(powershellPath({SystemRoot:'C:\\Windows'}),/^C:\\Windows\\(?:System32|Sysnative)\\WindowsPowerShell\\v1.0\\powershell.exe$/);
});
test('heartbeat scheduler skips busy receipts and recovers an idle ERR answer',async t=>{
 const {service:s,children:c}=rig(t,{heartbeatMs:20,jobMs:200});
 const receipt=s.send({printer:'Reception'});c[0].ready();await until(()=>c[0].writes.length);
 await pause(45);assert.equal(c[0].writes.length,1);
 c[0].answer(0,'OK','1');await receipt;
 await until(()=>c[0].writes.length===2);assert.equal(c[0].writes[1].ping,true);
 c[0].answer(1,'ERR','ping failed');await until(()=>c[0].kills>0);
});
test('shutdown during an active receipt resolves uncertain and does not restart',async t=>{
 const {service:s,children:c}=rig(t);const receipt=s.send({printer:'Reception'});c[0].ready();await until(()=>c[0].writes.length);
 s.stop();assert.equal((await receipt).submission,'uncertain');await pause(50);assert.equal(c.length,1);
});
