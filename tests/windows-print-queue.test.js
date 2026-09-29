'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WindowsPrintQueue, idFor } = require('../src/windows-print-queue');

function rig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-print-recovery-'));
  let now = 1000;
  const health = { printer: 'Kitchen_Printer', port: 'USB003', usb: true, present: true,
    pnpId: 'USBPRINT\\Kitchen\\serial', workOffline: false, printerStatus: 3, extendedStatus: 3,
    detectedError: 2, jobs: [] };
  const calls = [], recovered = [], initialized = [], events = [];
  let sequence = 1, drain = true;
  const transport = {
    inspect: async printer => structuredClone({ ...health, printer }),
    recover: async printer => { recovered.push(printer); health.workOffline = false; health.printerStatus = 3; },
    initialize: async job => { initialized.push(job); return { success: true }; },
    submit: async job => {
      const id = sequence++;
      calls.push({ ...job, bytes: fs.readFileSync(job.file) });
      if (!drain) health.jobs.push({ id, document: job.document, status: 'Printing', error: false });
      return { success: true, spoolerJobId: id };
    },
  };
  const instances = [];
  function make() {
    const queue = new WindowsPrintQueue({ dir, transport, now: () => now, wait: async () => {}, onStatus: item => events.push(item) });
    instances.push(queue); return queue;
  }
  const queue = make();
  t.after(() => { instances.forEach(q => q.stop()); fs.rmSync(dir, { recursive: true, force: true }); });
  const send = (id = 'kot-1', printer = 'Kitchen_Printer', q = queue) => q.enqueue({ printer, bytes: Buffer.from([65, 10, 29, 86, 0]), jobId: id });
  return { queue, make, send, health, transport, calls, recovered, initialized, events, dir,
    tick: async (ms = 15000, q = queue) => { now += ms; await q.tick(); }, hold: () => { drain = false; } };
}

test('online: initialization has no paper feed and receipt bytes/cut are preserved', async t => {
  const r = rig(t); const result = await r.send();
  assert.equal(result.status, 'Sent to printer'); assert.equal(result.success, true);
  assert.equal(r.initialized.length, 1);
  assert.deepEqual([...r.calls[0].bytes], [27, 64, 65, 10, 29, 86, 0]);
  assert.equal(result.spoolerJobId, 1);
  assert.ok(r.events.some(e => e.status === 'Queued'));
});

test('sleeping physical printer clears WorkOffline, waits and rechecks before submitting', async t => {
  const r = rig(t); r.health.workOffline = true; r.health.printerStatus = 7;
  assert.equal((await r.send()).status, 'Sent to printer');
  assert.deepEqual(r.recovered, ['Kitchen_Printer']); assert.equal(r.calls.length, 1);
});

test('disconnected USB never submits or initializes and keeps payload for reconnect', async t => {
  const r = rig(t); r.health.present = false; r.health.workOffline = true;
  const result = await r.send(); assert.equal(result.error, 'Printer disconnected');
  assert.equal(result.success, false); assert.equal(r.calls.length + r.initialized.length + r.recovered.length, 0);
  assert.ok(fs.existsSync(path.join(r.dir, idFor('kot-1') + '.bin')));
  r.health.present = true; await r.tick(); assert.equal(r.calls.length, 1);
  assert.equal(r.queue.list()[0].status, 'Sent to printer');
});

test('retry schedule is 2, 5, 10 seconds then exhaustion, delayed reconnect resumes once', async t => {
  const r = rig(t); r.health.present = false;
  await r.send(); let job = r.queue.jobs.get(idFor('kot-1'));
  assert.equal(job.nextAt, 3000);
  await r.tick(2000); assert.equal(job.nextAt, 8000);
  await r.tick(5000); assert.equal(job.nextAt, 18000);
  await r.tick(10000); assert.equal(job.state, 'failed');
  await r.tick(); assert.equal(r.calls.length, 0);
  r.health.present = true; await r.tick(); assert.equal(job.state, 'sent');
  await r.tick(); assert.equal(r.calls.length, 1);
});

test('duplicate concurrent requests and restart cannot print an acknowledged job twice', async t => {
  const r = rig(t); await Promise.all([r.send(), r.send(), r.send()]);
  assert.equal(r.calls.length, 1);
  r.queue.stop(); const restored = r.make();
  assert.equal((await r.send('kot-1', 'Kitchen_Printer', restored)).success, true);
  assert.equal(r.calls.length, 1);
});

test('pending unsubmitted job recovers after application restart', async t => {
  const r = rig(t); r.health.present = false; await r.send(); r.queue.stop();
  const restored = r.make(); r.health.present = true;
  await r.tick(15000, restored); assert.equal(r.calls.length, 1);
  assert.equal(restored.list()[0].status, 'Sent to printer');
});

test('original queued Offline/Error job remains the only copy during retries and restart', async t => {
  const r = rig(t); r.hold(); await r.send();
  r.health.jobs[0].error = true; r.health.jobs[0].status = 'Offline, Error';
  await r.tick(); assert.equal(r.queue.list()[0].status, 'Printer offline');
  r.queue.stop(); const restored = r.make(); await r.tick(15000, restored);
  await r.send('kot-1', 'Kitchen_Printer', restored); assert.equal(r.calls.length, 1);
  r.health.jobs[0].error = false; r.health.jobs[0].status = 'Printing'; await r.tick(15000, restored);
  r.health.jobs = []; await r.tick(15000, restored);
  assert.equal(restored.list()[0].status, 'Sent to printer'); assert.equal(r.calls.length, 1);
});

test('job disappearing after Error is ambiguous, not success and never resubmitted', async t => {
  const r = rig(t); r.hold(); await r.send();
  r.health.jobs[0].error = true; r.health.jobs[0].status = 'Error'; await r.tick();
  r.health.jobs = []; await r.tick(); await r.send();
  assert.equal(r.queue.list()[0].status, 'Failed'); assert.match(r.queue.list()[0].error, /outcome unknown/);
  assert.equal(r.calls.length, 1);
});

test('restart with missing spooler job fails closed even if it may have printed', async t => {
  const r = rig(t); r.hold(); await r.send(); r.queue.stop();
  r.health.jobs = []; const restored = r.make(); await r.tick(15000, restored);
  assert.equal(restored.list()[0].status, 'Failed'); assert.equal(r.calls.length, 1);
});

test('lost helper response is reconciled by immutable document name without a second submission', async t => {
  const r = rig(t); r.hold(); const send = r.transport.submit;
  r.transport.submit = async job => { await send(job); throw Error('helper died'); };
  await r.send(); await r.tick(); await r.send(); assert.equal(r.calls.length, 1);
  r.health.jobs = []; await r.tick(); assert.equal(r.queue.list()[0].status, 'Failed');
});

test('single queue per printer holds the second receipt until the first has left Windows', async t => {
  const r = rig(t); r.hold(); await Promise.all([r.send('one'), r.send('two')]);
  assert.equal(r.calls.length, 1);
  r.health.jobs = []; await r.tick(); assert.equal(r.calls.length, 2);
});

test('reception and kitchen cannot reuse a job ID or change a pending destination', async t => {
  const r = rig(t); r.health.present = false; await r.send();
  const result = await r.send('kot-1', 'Reception_Printer');
  assert.match(result.error, /another printer/);
  r.queue.configure('Kitchen_Printer', { port: 'USB004', pnpId: 'USBPRINT\\Reception\\serial' });
  r.health.present = true; await r.tick();
  assert.equal(r.calls[0].printer, 'Kitchen_Printer');
  assert.equal(r.queue.jobs.get(idFor('kot-1')).binding.port, 'USB003');
});

test('actual port changed: no automatic swap, initialization or submission', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', { port: 'USB003' }); r.health.port = 'USB004';
  assert.match((await r.send()).error, /port changed/);
  assert.equal(r.calls.length + r.initialized.length, 0);
});

test('unrelated failed Windows jobs block submission and are never deleted', async t => {
  const r = rig(t); r.health.jobs = [{ id: 99, document: 'Another application', error: true, status: 'Error' }];
  await r.send(); await r.tick(); assert.equal(r.calls.length, 0); assert.equal(r.health.jobs[0].id, 99);
});

test('unknown USB presence and permission denied fail visibly without elevation', async t => {
  const r = rig(t); r.health.present = null;
  assert.match((await r.send()).error, /could not be identified/);
  r.health.present = true; r.health.workOffline = true;
  r.transport.recover = async () => { throw Error('Access denied'); };
  await r.tick(2000);
  assert.match((await r.send()).error, /Access denied/);
  assert.equal(r.calls.length, 0);
});

test('retained initialization job blocks receipt and initialization does not repeat', async t => {
  const r = rig(t);
  r.transport.initialize = async job => { r.initialized.push(job); r.health.jobs.push({ id: 5, document: job.document, error: false, status: 'Spooling' }); return { success: true }; };
  assert.equal((await r.send()).status, 'Waiting'); await r.tick();
  assert.equal(r.initialized.length, 1); assert.equal(r.calls.length, 0);
  r.health.jobs = []; await r.tick(); assert.equal(r.calls.length, 1);
});

test('offline status with a present device can be initialized before readiness is rechecked', async t => {
  const r = rig(t); r.health.printerStatus = 7;
  r.transport.initialize = async job => { r.initialized.push(job); r.health.printerStatus = 3; return { success: true }; };
  assert.equal((await r.send()).status, 'Sent to printer');
  assert.equal(r.initialized.length, 1); assert.equal(r.calls.length, 1);
});

test('corrupt persisted state fails closed instead of losing duplicate protection', t => {
  const r = rig(t);
  fs.writeFileSync(path.join(r.dir, idFor('corrupt') + '.json'), '{broken');
  assert.throws(() => r.make());
  assert.equal(r.calls.length, 0);
});

test('completed records remove payloads but retain immutable duplicate protection', async t => {
  const r = rig(t); await r.send();
  assert.equal(fs.existsSync(path.join(r.dir, idFor('kot-1') + '.bin')), false);
  assert.equal(fs.existsSync(path.join(r.dir, idFor('kot-1') + '.json')), true);
});

test('diagnostic log rotates at one MiB and excludes receipt content', async t => {
  const r = rig(t); const log = path.join(r.dir, 'health.log');
  fs.writeFileSync(log, 'x'.repeat(1024 * 1024 + 1));
  await r.send(); assert.ok(fs.existsSync(log + '.1'));
  const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(entries.every(row => row.at));
  assert.ok(entries.some(row => row.port === 'USB003' && row.present === true));
  assert.ok(entries.some(row => row.spoolerJobId === 1));
});

test('idle keep-alive contacts each configured USB queue every 30 seconds without receipts', async t => {
  const r = rig(t);
  r.queue.configure('Kitchen_Printer', {});
  await r.tick(0);
  await r.tick(29999); assert.equal(r.initialized.length, 0);
  await r.tick(1); assert.equal(r.initialized.length, 1);
  assert.match(r.initialized[0].document, /^Posnic-idle-/);
  assert.equal(r.calls.length, 0);
  await r.tick(15000); assert.equal(r.initialized.length, 1);
  await r.tick(15000); assert.equal(r.initialized.length, 2);
  assert.notEqual(r.initialized[0].document, r.initialized[1].document);
});

test('idle disconnect submits nothing; reconnect clears WorkOffline and resumes pulses', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  r.health.present = false; r.health.workOffline = true;
  await r.tick(); await r.tick(60000);
  assert.equal(r.initialized.length + r.recovered.length, 0);
  r.health.present = true;
  await r.tick(); assert.equal(r.recovered.length, 1); assert.equal(r.initialized.length, 1);
});

test('queued idle pulse survives restart without accumulating another job', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  r.transport.initialize = async job => {
    r.initialized.push(job);
    r.health.jobs.push({ id: 42, document: job.document, status: 'Offline', error: true });
    return { success: true, spoolerJobId: 42 };
  };
  await r.tick(); await r.tick(30000);
  r.queue.stop(); const restored = r.make();
  await r.tick(60000, restored); await r.tick(60000, restored);
  assert.equal(r.initialized.length, 1);
  assert.equal((await r.send('receipt', 'Kitchen_Printer', restored)).status, 'Printer offline');
  assert.equal(r.calls.length, 0);
  r.health.jobs = [];
  // The real receipt runs after the old pulse drains, without duplicating it.
  r.transport.initialize = async job => { r.initialized.push(job); return { success: true }; };
  await r.tick(30000, restored);
  assert.equal(r.calls.length, 1);
  assert.equal(r.initialized.filter(j => j.document.startsWith('Posnic-idle-')).length, 1);
});

test('uncertain idle submission is not repeated across restart', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  r.transport.initialize = async job => { r.initialized.push(job); throw new Error('pipe lost'); };
  await r.tick(); await r.tick(30000);
  r.queue.stop(); const restored = r.make();
  await r.tick(60000, restored);
  assert.equal(r.initialized.length, 1);
  assert.match(restored.keepAlive.kitchen_printer.status, /outcome unknown/);
});

test('idle traffic does not reset a busy printer, unrelated job, or recent receipt', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  await r.tick(); r.health.printerStatus = 4;
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.health.printerStatus = 3;
  r.health.jobs = [{ id: 90, document: 'Another app', status: 'Printing', error: false }];
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.health.jobs = [];
  await r.send(); const count = r.initialized.length;
  await r.tick(29999); assert.equal(r.initialized.length, count);
  await r.tick(1); assert.equal(r.initialized.length, count + 1);
});

test('idle pulse and newly arriving receipt use one lock and receipt completes immediately afterward', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  let entered, finish;
  const enteredPulse = new Promise(resolve => { entered = resolve; });
  const release = new Promise(resolve => { finish = resolve; });
  r.transport.initialize = async job => {
    r.initialized.push(job);
    if (job.document.startsWith('Posnic-idle-')) { entered(); await release; }
    return { success: true };
  };
  await r.tick();
  const tick = r.tick(30000); await enteredPulse;
  const receipt = r.send();
  assert.equal(r.calls.length, 0);
  finish(); await tick;
  assert.equal((await receipt).status, 'Sent to printer');
  assert.equal(r.calls.length, 1);
  assert.deepEqual([...r.calls[0].bytes], [27, 64, 65, 10, 29, 86, 0]);
});

test('keep-alive respects opt-out, unknown devices, port mismatch, non-USB and stop', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', { keepAlive: false });
  await r.tick(); await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.queue.configure('Kitchen_Printer', { initialize: false });
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.queue.configure('Kitchen_Printer', { port: 'USB999' });
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.queue.configure('Kitchen_Printer', {}); r.health.present = null;
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.health.present = true; r.health.usb = false;
  await r.tick(60000); assert.equal(r.initialized.length, 0);
  r.health.usb = true; r.queue.stop();
  await r.tick(60000); assert.equal(r.initialized.length, 0);
});

test('reception and kitchen idle commands keep separate names, ports and payload files', async t => {
  const r = rig(t);
  r.queue.configure('Reception_Printer', { port: 'USB004' });
  r.queue.configure('Kitchen_Printer', { port: 'USB003' });
  r.transport.inspect = async printer => ({ ...r.health, jobs: [], printer,
    port: printer.toLowerCase().startsWith('reception') ? 'USB004' : 'USB003' });
  await r.tick(); await r.tick(30000);
  assert.deepEqual(r.initialized.map(j => j.printer).sort(), ['kitchen_printer', 'reception_printer']);
  assert.notEqual(r.initialized[0].file, r.initialized[1].file);
});

test('removed printers stop receiving idle commands', async t => {
  const r = rig(t); let selected = ['Kitchen_Printer'];
  r.queue.configured = () => selected;
  await r.tick(); await r.tick(30000); assert.equal(r.initialized.length, 1);
  selected = []; await r.tick(60000); assert.equal(r.initialized.length, 1);
});

test('real initialization adapter sends exactly ESC @ with no printable bytes, feed or cut', async t => {
  const r = rig(t);
  const raw = require('../src/raw-print-service');
  const original = raw.send;
  t.after(() => { raw.send = original; });
  let data;
  raw.send = async job => { data = fs.readFileSync(job.file); return { success: true, spoolerJobId: 7 }; };
  const adapter = require('../src/windows-printer-transport');
  await adapter.initialize({ printer: 'Kitchen_Printer', document: 'Paperless-test', file: path.join(r.dir, 'idle.bin') });
  assert.deepEqual([...data], [0x1b, 0x40]);
});

function legacyFailure(r, overrides = {}) {
  const id = idFor('legacy');
  const job = { id, printer: 'Kitchen_Printer', document: 'Posnic-' + id, binding: { port: 'USB003' },
    state: 'failed', reason: 'USB device could not be identified; configure its PnP instance ID',
    submitted: false, retries: 0, nextAt: 0, ...overrides };
  fs.writeFileSync(path.join(r.dir, id + '.bin'), Buffer.from('test only'));
  r.queue.write(id + '.json', job); return job;
}
test('legacy identity failure is scheduled after restart, without needing fresh enqueue', async t => {
  const r = rig(t); legacyFailure(r); r.queue.stop();
  const next = r.make(); await r.tick(0, next);
  assert.equal(r.calls.length, 1); assert.equal(next.list()[0].status, 'Sent to printer');
  await r.tick(30000, next); assert.equal(r.calls.length, 1);
});
test('legacy identity failure migrates during tick and fresh repeated enqueue', async t => {
  for (const trigger of ['tick', 'enqueue']) {
    const r = rig(t); const job = legacyFailure(r); r.queue.jobs.set(job.id, job);
    if (trigger === 'tick') await r.tick(); else await r.send('legacy');
    assert.equal(r.calls.length, 1); assert.equal(job.state, 'sent');
    await r.send('legacy'); assert.equal(r.calls.length, 1);
  }
});
test('migration never replays submitted, accepted, observed, spooler-ID or unrelated failures', async t => {
  for (const fields of [{submitted:true}, {accepted:true}, {observed:true}, {spoolerId:93}, {reason:'Other error'}]) {
    const r = rig(t); legacyFailure(r, fields); r.queue.stop(); const next = r.make();
    await r.tick(0, next); assert.equal(r.calls.length, 0);
  }
});
test('discovery errors retry on schedule and return after exhaustion without duplicate submissions', async t => {
  const r = rig(t); const inspect = r.transport.inspect;
  r.transport.inspect = async () => { throw Error('PnP enumeration failed'); };
  await r.send(); const job = r.queue.jobs.get(idFor('kot-1'));
  await r.tick(1000); assert.equal(job.retries, 1);
  await r.tick(1000); await r.tick(5000); await r.tick(10000);
  assert.equal(job.state, 'failed'); assert.equal(job.reconnect, true); assert.equal(r.calls.length, 0);
  r.transport.inspect = inspect; await r.tick(); await r.send(); assert.equal(r.calls.length, 1);
});
test('ambiguous identity is not disconnected; reconnect resolves it and pins the destination', async t => {
  const r = rig(t); r.health.discovery = 'ambiguous'; r.health.present = null; r.health.pnpId = '';
  assert.match((await r.send()).error, /Multiple connected/); assert.equal(r.calls.length, 0);
  r.health.discovery = 'resolved'; r.health.present = true; r.health.pnpId = 'USBPRINT\\Kitchen\\serial';
  await r.tick(); assert.equal(r.calls.length, 1);
  assert.equal(r.queue.jobs.get(idFor('kot-1')).binding.pnpId, r.health.pnpId);
});
test('driver extended status Unknown with primary Idle permits serialized quiet-period initialization', async t => {
  const r = rig(t); r.health.extendedStatus = 2; r.queue.configure('Kitchen_Printer', {});
  await r.tick(); assert.equal(r.initialized.length, 0);
  await r.tick(30000); assert.equal(r.initialized.length, 1);
});
test('stale saved identity never switches to a replacement; original reconnect resumes once', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {port:'USB003',pnpId:r.health.pnpId});
  r.health.discovery = 'stale-binding'; r.health.present = null;
  await r.send(); assert.equal(r.calls.length, 0);
  r.health.discovery = 'resolved'; r.health.present = true;
  await r.tick(); assert.equal(r.calls.length, 1);
});

test('external helper or unavailable audit suppresses optional idle writes', async t => {
  const r = rig(t); r.queue.configure('Kitchen_Printer', {});
  r.transport.systemSettings = async () => ({externalKeepAlive:true});
  await r.tick(); await r.tick(30000); assert.equal(r.initialized.length, 0);
  r.transport.systemSettings = async () => {throw Error('Denied');};
  await r.tick(30000); assert.equal(r.initialized.length, 0);
  r.transport.systemSettings = async () => ({externalKeepAlive:false});
  await r.tick(30000); assert.equal(r.initialized.length, 1);
});
test('missing legacy payload is not automatically recreated or replayed', async t => {
  const r = rig(t); const job = legacyFailure(r);
  fs.unlinkSync(path.join(r.dir, job.id + '.bin')); r.queue.stop();
  const next = r.make(); await r.tick(0,next); assert.equal(r.calls.length,0);
  assert.equal(next.jobs.get(job.id).state,'failed');
});

test('startup failure is diagnosed accurately and pre-submission retries are bounded', async t => {
 const r=rig(t);let attempts=0;
 r.transport.initialize=async()=>{attempts++;return {success:false,unavailable:true,submission:'not-submitted',error:'Print helper startup failed: READY deadline exceeded'};};
 await r.send();for(let i=0;i<6;i++)await r.tick(60000);
 assert.equal(attempts,4);assert.equal(r.calls.length,0);
 const job=r.queue.jobs.get(idFor('kot-1'));
 assert.equal(job.state,'failed');assert.equal(job.submitted,false);assert.equal(r.queue.canRecover(job),true);
 assert.match(job.reason,/Print helper startup failed/);assert.doesNotMatch(job.reason,/check Windows queue/);
});
test('controlled legacy recovery preserves a successful Reception copy and Kitchen identity', async t => {
 const r=rig(t);await r.send('reception','Reception');
 const submit=r.transport.submit;
 r.transport.initialize=async()=>({success:false,unavailable:true,error:'Print helper startup failed'});
 await r.send('kitchen','Kitchen_New');
 const job=r.queue.jobs.get(idFor('kitchen'));
 job.state='failed';job.reason='Printer initialization failed; check Windows queue';delete job.nonSubmissionVerified;
 r.queue.write(job.id+'.json',job);
 r.queue.stop();const restored=r.make();
 r.transport.initialize=async()=>({success:true});r.transport.submit=submit;
 const before={...job.binding};
 const result=await restored.recoverUnsubmitted(job.id);
 assert.equal(result.success,true);assert.equal(result.jobId,job.id);
 assert.deepEqual(restored.jobs.get(job.id).binding,before);
 assert.deepEqual(r.calls.map(j=>j.printer),['Reception','Kitchen_New']);
 await restored.recoverUnsubmitted(job.id);await r.send('reception','Reception',restored);
 assert.equal(r.calls.length,2);
});
test('uncertain, accepted and partial receipts are never eligible for controlled recovery',async t=>{
 const r=rig(t);r.transport.submit=async()=>({success:false,submission:'uncertain',error:'partial write'});
 await r.send();const job=r.queue.jobs.get(idFor('kot-1'));
 assert.equal(job.submitted,true);assert.equal(r.queue.canRecover(job),false);
 assert.equal((await r.queue.recoverUnsubmitted(job.id)).success,false);
 // Contradictory old records must also fail closed, even with a legacy reason.
 job.submitted=false;job.reason='Printer initialization failed; check Windows queue';job.accepted=true;
 assert.equal(r.queue.canRecover(job),false);job.accepted=false;job.spoolerId=7;assert.equal(r.queue.canRecover(job),false);
});
test('failure before receipt submission is retried once helper recovers; failures after write are not',async t=>{
 const r=rig(t);const submit=r.transport.submit;let tries=0;
 r.transport.submit=async job=>++tries===1?{success:false,unavailable:true,submission:'not-submitted',error:'Print helper startup failed'}:submit(job);
 await r.send();assert.equal(r.queue.jobs.get(idFor('kot-1')).submitted,false);
 await r.tick();assert.equal(r.calls.length,1);await r.tick();assert.equal(r.calls.length,1);
});
test('optional retained initialization cannot starve healthy receipts indefinitely',async t=>{
 const r=rig(t);r.transport.initialize=async job=>{r.initialized.push(job);r.health.jobs.push({id:99,document:job.document,status:'Spooling',error:false});return {success:true};};
 await r.send();assert.equal(r.calls.length,0);await r.tick(30001);
 assert.equal(r.calls.length,1);assert.equal(r.initialized.length,1);
});
test('unknown idle pulse suppresses further optional traffic but not healthy receipts',async t=>{
 const r=rig(t);r.queue.keepAlive.kitchen_printer={at:0,pending:true,document:'Posnic-idle-old',status:'unknown'};
 await r.send();assert.equal(r.calls.length,0);await r.tick(30001);
 assert.equal(r.calls.length,1);assert.equal(r.queue.keepAlive.kitchen_printer.suppressed,true);
});
test('a failed Windows queue job still blocks receipts after optional wake deadline',async t=>{
 const r=rig(t);r.queue.keepAlive.kitchen_printer={at:0,pending:true,document:'Posnic-idle-old',status:'unknown'};
 r.health.jobs=[{id:1,document:'Posnic-idle-old',error:true,status:'Error'}];
 await r.send();await r.tick(30001);assert.equal(r.calls.length,0);
 assert.match(r.queue.jobs.get(idFor('kot-1')).reason,/failed job/);
});
