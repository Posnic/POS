'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const spooler = require('../src/windows-spooler');
const temp = require('../src/print-temp-files');
const ledger = require('../src/print-ledger');
const online = () => ({ present: true, portPresent: true, devicePresent: true, jobs: [] });
let queue = online();
let tick = 0;
const service = spooler.createSpooler({ platform: 'win32', inspect: async () => queue,
  now: () => tick, delay: async ms => { tick += ms; }, timeoutMs: 200 });
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { getPath: () => os.tmpdir() }, BrowserWindow: class {} };
  if (name === './windows-spooler') return { ...spooler, ...service };
  return originalLoad.call(this, name, ...args);
};
const KOTManager = require('../src/kot-manager');
Module._load = originalLoad;

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-spool-test-'));
  t.after(() => {
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
  });
  return dir;
}

test('offline, missing printer and absent USB port never submit to any destination', async () => {
  for (const fault of [{ present: false }, { workOffline: true }, { portPresent: false }, { devicePresent: false }]) {
    queue = { ...online(), ...fault };
    let calls = 0;
    const r = await service.submit({ printerName: 'Kitchen_Printer', documentName: 'one',
      submit: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(r.printerName, 'Kitchen_Printer');
    assert.equal(r.success, false);
    assert.equal(r.retryable, true);
    assert.equal(r.submitted, false);
  }
});

test('Electron callback success without a matching spooler job is not success', async () => {
  queue = online();
  queue.jobs.push({ id: 3, document: 'unrelated receipt' });
  const r = await service.submit({ printerName: 'Kitchen_Printer', documentName: 'ticket',
    submit: async () => ({ success: true }) });
  assert.equal(r.success, false);
  assert.equal(r.state, 'unknown');
  assert.equal(r.jobId, null);
  assert.equal(r.retryable, false, 'absence must not cause a duplicate automatic submission');
});

test('positive StartDocPrinter ID confirms even a job that leaves the queue immediately', async () => {
  queue = online();
  const r = await service.submit({ printerName: 'Kitchen_Printer', documentName: 'raw',
    submit: async () => ({ success: true, jobId: 42 }) });
  assert.equal(r.success, true);
  assert.equal(r.jobId, 42);
  assert.equal(r.state, 'spooled');
});

test('simultaneous submissions and retries reuse the existing exact spooler job', async () => {
  queue = online();
  let count = 0;
  const options = { printerName: 'Kitchen_Printer', documentName: spooler.documentName('immutable-key', 0),
    submit: async name => { count++; queue.jobs.push({ id: 9, document: name }); return { success: true }; } };
  const results = await Promise.all([service.submit(options), service.submit(options)]);
  results.push(await service.submit(options));
  assert.equal(count, 1);
  assert.ok(results.every(r => r.success && r.jobId === 9));
  queue.jobs[0].status = 'Error';
  const blocked = await service.submit(options);
  assert.equal(blocked.success, false);
  assert.equal(blocked.retryable, false);
  assert.equal(count, 1);
});

test('offline reconnect retries only the outstanding copy using the original job key', async t => {
  const manager = new KOTManager();
  ledger.setDir(directory(t));
  const key = 'immutable-reconnect';
  ledger.claim(key, {});
  const jobs = ledger.deliveryPlan(key, [{ name: 'Kitchen_Printer', copies: 1 }]);
  const sale = { _deliveryKey: key };
  let count = 0;
  const send = async name => { count++; queue.jobs.push({ id: 17, document: name }); return { success: true }; };
  queue = { ...online(), workOffline: true };
  const failed = await manager._deliverCopy(sale, jobs, 0, 'test', send);
  assert.equal(failed.status, 'failed');
  assert.equal(count, 0);
  assert.equal(manager.printedJobs.has(key), false);
  queue = online();
  const later = Date.now() + 30001;
  t.mock.method(Date, 'now', () => later);
  assert.equal((await manager._deliverCopy(sale, jobs, 0, 'test', send)).status, 'success');
  assert.equal((await manager._deliverCopy(sale, jobs, 0, 'test', send)).status, 'success');
  ledger.setDir(null);
  assert.equal(count, 1);
  assert.equal(queue.jobs[0].document, spooler.documentName(key, 0));
});

test('PDF retention and startup cleanup keep recent and foreign files', t => {
  const dir = directory(t);
  const own = path.join(dir, 'posnic-kot-test.pdf');
  const foreign = path.join(dir, 'customer.pdf');
  fs.writeFileSync(own, 'pdf'); fs.writeFileSync(foreign, 'private');
  temp.retain(own);
  const created = fs.statSync(own).mtimeMs;
  temp.cleanup(dir, created + temp.RETAIN_MS - 1);
  assert.ok(fs.existsSync(own), 'PDF deleted before the driver could consume it');
  temp.cleanup(dir, created + temp.RETAIN_MS + 1);
  assert.equal(fs.existsSync(own), false);
  assert.ok(fs.existsSync(foreign));
});

test('an unverified KOT remains on the server and is never automatically sent twice', async t => {
  queue = online();
  let sends = 0;
  const manager = new KOTManager({ hardware: { sendRawToPrinter: async () => {
    sends++; return { success: true }; // Electron/driver acceptance without a job ID
  } } });
  ledger.setDir(directory(t));
  manager.config = { branchId: 'b1', printerNames: ['Kitchen_Printer'],
    printers: [{ name: 'Kitchen_Printer', copies: 1, pageSize: '80mm' }] };
  const sale = { _id: 'sale-pending', sales_id: 'S1', print_jobs: [{ type: 'new',
    timestamp: '2026-09-27T12:00:00Z', items: [{ item_name: 'Rice', item_quantity: 1 }] }] };
  const key = require('../src/kot-job-key').kotJobKey(sale._id, sale.print_jobs[0]);
  manager.logsDir = directory(t);
  const acknowledgements = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    if (String(url).includes('multiKitchenPrint')) return { ok: true, json: async () => ({ data: [sale] }) };
    if (String(url).includes('markKitchenPrinted')) acknowledgements.push(init);
    return { ok: true };
  });
  await manager._pollOnce();
  await manager._pollOnce();
  assert.equal(sends, 1);
  assert.equal(manager.printedJobs.has(key), false);
  assert.deepEqual(acknowledgements, [], 'markKitchenPrinted acknowledged an unverified job');
  assert.equal(ledger.deliveryPlan(key)[0].state, 'attempted');
  ledger.setDir(null);
});

test('new helpers ship in the installed application', () => {
  const files = require('../package.json').build.files;
  for (const name of ['windows-spooler', 'print-temp-files']) assert.ok(files.includes(`src/${name}.js`));
});

test('a copy cannot be sent when its durable attempt cannot be saved', async t => {
  queue = online();
  const manager = new KOTManager();
  ledger.setDir(directory(t));
  ledger.claim('disk-error');
  const jobs = ledger.deliveryPlan('disk-error', [{ name: 'Kitchen_Printer', copies: 1 }]);
  t.mock.method(fs, 'writeFileSync', () => { throw new Error('disk full'); });
  let sends = 0;
  const r = await manager._deliverCopy({ _deliveryKey: 'disk-error' }, jobs, 0, 'test', async () => {
    sends++; return { success: true, jobId: 1 };
  });
  assert.equal(sends, 0);
  assert.equal(r.status, 'pending');
  assert.match(r.error, /save the print attempt/);
  ledger.setDir(null);
});
