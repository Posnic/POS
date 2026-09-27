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
  assert.match((await r.send('other')).error, /Access denied/);
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
