'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { WindowsPrintQueue } = require('../src/windows-print-queue');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-windows-kot-'));
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { getPath: () => base }, BrowserWindow: class {} };
  return load.call(this, name, ...args);
};
const KOT = require('../src/kot-manager');
const ledger = require('../src/print-ledger');
Module._load = load;

test('KOT delivery ledger and Windows recovery resume only the missing kitchen copy after restart', { skip: process.platform !== 'win32' }, async t => {
  let now = Date.now(), kitchenPresent = false;
  const calls = [];
  const transport = {
    inspect: async printer => ({ printer, port: printer === 'Kitchen' ? 'USB003' : 'USB004',
      pnpId: 'USBPRINT\\' + printer + '\\serial', usb: true, present: printer !== 'Kitchen' || kitchenPresent,
      workOffline: false, printerStatus: 3, extendedStatus: 3, detectedError: 2, jobs: [] }),
    submit: async job => { calls.push(job); return { success: true, spoolerJobId: calls.length }; },
  };
  function makeQueue() { return new WindowsPrintQueue({ dir: path.join(base, 'queue'), transport, now: () => now, wait: async () => {} }); }
  let queue = makeQueue();
  function makeManager() {
    const manager = new KOT({ hardware: { getWindowsPrintQueue: () => queue,
      sendRawToPrinter: (printer, bytes, _label, options) => queue.enqueue({ printer, bytes, jobId: options.jobId }) } });
    ledger.setDir(base);
    manager.config = { printers: [{ name: 'Kitchen', copies: 1 }, { name: 'Reception', copies: 1 }] };
    manager._rawTicket = () => Buffer.from('same ticket\n');
    return manager;
  }
  t.after(() => { queue.stop(); fs.rmSync(base, { recursive: true, force: true }); });
  let manager = makeManager(); ledger.claim('sale:order:immutable');
  const sale = { _deliveryKey: 'sale:order:immutable', _printKind: 'new' };
  const first = await manager._printRaw(sale, 'new', 7, ['Kitchen', 'Reception']);
  assert.equal(first[0].status, 'pending'); assert.equal(first[1].status, 'success');
  assert.deepEqual(calls.map(job => job.printer), ['Reception']);
  queue.stop(); queue = makeQueue(); manager = makeManager();
  kitchenPresent = true; now += 15000; await queue.tick();
  const final = await manager._printRaw(sale, 'new', 7, ['Kitchen', 'Reception']);
  assert.ok(final.every(result => result.status === 'success'));
  assert.deepEqual(calls.map(job => job.printer), ['Reception', 'Kitchen']);
  await manager._printRaw(sale, 'new', 7, ['Kitchen', 'Reception']);
  assert.equal(calls.length, 2);
});
