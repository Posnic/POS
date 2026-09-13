'use strict';

/*
 * The ticket log says where the order came from.
 *
 * Owner, looking at the KOT print log after a live test: "but i dont see which
 * asked to print from mobile app printed or not."
 *
 * He was right, and the column that looked like it answered him was the worst
 * part. "Device IP" was filled from this till's OWN os.networkInterfaces(), so
 * it read 192.168.137.1 on every single row whatever sent the order. It looked
 * like it identified the handset. It identified the machine doing the printing,
 * which is the one thing nobody is wondering about.
 *
 * The sale already knows. Every one carries a `channel`, and years of older
 * ones carry only the legacy `sale_method`, so both are read - the same rule
 * sales-channels.js follows on the server, and the reason is the same: reading
 * `sale_method` alone makes a shop's history vanish at a version boundary.
 *
 * The staff name goes in brackets because on a floor with four handsets "Ravi"
 * answers the question and an IP address starts another one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      BrowserWindow: class { constructor() { throw new Error('the window path was used'); } },
      app: { getPath: () => os.tmpdir() },
    };
  }
  return load.call(this, request, ...rest);
};
const KOTManager = require(path.join(ROOT, 'src', 'kot-manager.js'));
Module._load = load;

const HTML = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.html'), 'utf8');

const kot = new KOTManager({ hardware: { sendRawToPrinter: async () => ({ success: true }) } });
const from = (sale) => kot._orderSource(sale);

test('an order from a captain handset says so', () => {
  assert.strictEqual(from({ channel: 'tableside' }), 'Captain app');
});

test('and names the waiter, because four handsets look alike', () => {
  assert.strictEqual(from({ channel: 'tableside', user_name: 'Ravi' }), 'Captain app (Ravi)');
});

test('a customer ordering on their own phone is not the same thing', () => {
  assert.strictEqual(from({ channel: 'online' }), 'Customer phone');
  assert.strictEqual(from({ channel: 'kiosk' }), 'Kiosk');
});

test('an order rung up at the counter says Till', () => {
  assert.strictEqual(from({ channel: 'pos' }), 'Till');
  /* And a sale with nothing on it at all is a till sale, which is what a
     ticket with no channel has always been. */
  assert.strictEqual(from({}), 'Till');
});

test('years of older sales carry only sale_method, and still answer', () => {
  /*
   * THE TRAP THIS AVOIDS. Every sale written before `channel` existed has only
   * `sale_method`, and there are years of them. Reading the new field alone
   * would make every one of those rows say "Till", quietly and wrongly, which
   * is exactly how a shop's history goes missing at a version boundary.
   */
  assert.strictEqual(from({ sale_method: 'Table-Order' }), 'Captain app');
  assert.strictEqual(from({ sale_method: 'Self-Order' }), 'Customer phone');
  assert.strictEqual(from({ sale_method: 'Kiosk' }), 'Kiosk');
});

test('the new field wins when both are there', () => {
  /* A sale carries both during the overlap. The channel is the one the server
     maintains. */
  assert.strictEqual(from({ channel: 'pos', sale_method: 'Table-Order' }), 'Till');
});

test('something unrecognised is repeated, not guessed at', () => {
  /* A guess reads as fact on a screen somebody is using to work out where a
     missing ticket went. */
  assert.strictEqual(from({ sale_method: 'Swiggy' }), 'Swiggy');
});

test('every ticket records it', async () => {
  const logged = [];
  const k = new KOTManager({ hardware: { sendRawToPrinter: async () => ({ success: true }) } });
  k.config = { branchId: 'b1', printerNames: ['Kitchen'] };
  k._appendLog = (e) => logged.push(e);

  await k.silentPrint(
    { _id: 'x', sales_id: 'SB-1', sale_process: 'KOT', table_number: '6',
      channel: 'tableside', user_name: 'Ravi',
      _printKind: 'new', items: [{ item_name: 'Noodles', item_quantity: 1 }] },
    ['Kitchen'],
    false
  );

  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0].source, 'Captain app (Ravi)');
});

test('the screen shows it, in the list and in the detail panel', () => {
  assert.match(HTML, /<th style="[^"]*">From<\/th>/, 'the list has no From column');
  assert.ok(!/>Device IP</.test(HTML), 'the misleading Device IP column is still there');
  assert.match(HTML, /const sourceHtml = log\.source/, 'the cell is not built from the source');
  assert.match(HTML, /FROM<\/div><div style="font-weight:600;">\$\{log\.source/,
    'the detail panel does not say where the order came from');
});

test('a ticket from before this shipped reads as not recorded, not as broken', () => {
  /* The log is a file on the shop's disk and already has yesterday in it. */
  assert.match(HTML, /not recorded/, 'an older row would show undefined in the detail panel');
  const cell = HTML.slice(HTML.indexOf('const sourceHtml'), HTML.indexOf('const printerHtml'));
  assert.match(cell, /log\.source\s*\n?\s*\?/, 'the list cell does not handle a missing source');
});
