'use strict';

/*
 * A shop can read its own printing speed, instead of taking mine.
 *
 * Owner, on the kitchen printer: "every seconds counts here. so give proper
 * solution." And later, on the work that followed: "improved sending to print
 * and printing fast? tested ?"
 *
 * The honest answer to the last part was "measured on one developer machine
 * with two virtual printers": 2,080 ms before the ESC/POS work, 184 ms after.
 * That is enough to choose a design. It is not enough to know what a real
 * kitchen sees, on a real roll, at the end of a long USB run down a corridor,
 * and there was no way to find out. The ticket log already existed and already
 * had a screen; it recorded the table, the items and which printers answered,
 * and said nothing at all about time.
 *
 * Two things are recorded now, and the second matters as much as the first.
 *
 *   ms    order accepted to last copy accepted, per printer and end to end
 *   via   'bytes' for the fast ESC/POS path, 'window' for the PDF fallback
 *
 * A ticket that quietly fell back to the window is roughly ten times slower
 * and used to look identical in the log to a fast one. A shop losing the fast
 * path had no symptom except that printing felt slow.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/* kot-manager runs in the Electron main process. The window class throws: if
   anything reaches for it in the byte-path tests below, the fast path was not
   taken and the test says so rather than passing slowly. */
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

const sale = {
  _id: 'x', sales_id: 'SB-1', sale_process: 'KOT', table_number: '5',
  _printKind: 'new', items: [{ item_name: 'Tea', item_quantity: 1 }],
};

/** A manager whose printer takes `delayMs`, with its log captured in memory. */
function till({ delayMs = 0, succeeds = true, printers = ['Reception'] } = {}) {
  const logged = [];
  const kot = new KOTManager({
    hardware: {
      sendRawToPrinter: async () => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return succeeds ? { success: true } : { success: false, error: 'offline' };
      },
    },
  });
  kot.config = { branchId: 'b1', printerNames: printers };
  kot._appendLog = (entry) => logged.push(entry);
  return { kot, logged };
}

test('every ticket records what it cost, end to end', async () => {
  const { kot, logged } = till({ delayMs: 60 });
  await kot.silentPrint(sale, ['Reception'], false);

  assert.strictEqual(logged.length, 1, 'the ticket was not logged');
  assert.ok(Number.isFinite(logged[0].ms), 'the log still says nothing about time');
  assert.ok(logged[0].ms >= 55, 'the time recorded is shorter than the print actually took');
  assert.ok(logged[0].ms < 5000, 'the clock is measuring something other than this print');
});

test('and which path it took, because one of them is ten times slower', async () => {
  const { kot, logged } = till();
  await kot.silentPrint(sale, ['Reception'], false);
  assert.strictEqual(logged[0].via, 'bytes',
    'a ticket that fell back to the window would look identical to a fast one');
});

test('each printer is timed on its own, not just the pair', async () => {
  /* A kitchen roll on a long extension and a reception printer on a short
     cable are two different answers, and the slow one is the one to find. */
  const { kot } = till({ delayMs: 40, printers: ['Reception', 'Kitchen'] });
  const results = await kot.silentPrint(sale, ['Reception', 'Kitchen'], true);

  assert.strictEqual(results.length, 2);
  for (const r of results) {
    assert.ok(Number.isFinite(r.ms), r.name + ' was not timed');
    assert.ok(r.ms >= 35, r.name + ' reports less time than the print took');
    assert.strictEqual(r.via, 'bytes');
  }
});

test('a printer that refuses is still timed, because a slow refusal is the worst case', async () => {
  /* Twenty seconds waiting on a wedged spooler and then a failure is a very
     different fault from an instant rejection, and the two read the same
     without a number beside them. */
  const { kot, logged } = till({ delayMs: 30, succeeds: false });
  const results = await kot.silentPrint(sale, ['Reception'], false);

  assert.strictEqual(results[0].status, 'failed');
  assert.ok(Number.isFinite(results[0].ms), 'a failed print is not timed');
  assert.ok(Number.isFinite(logged[0].ms));
});

test('a ticket printed before this shipped shows nothing, not zero', () => {
  /* The log is a file on the shop's disk and it already has yesterday in it.
     An old entry carries no ms at all, and "0 ms" would be a lie that makes
     the shop look faster than it is. */
  const cell = HTML.slice(HTML.indexOf('const speedHtml'), HTML.indexOf('const printerHtml'));
  assert.match(cell, /if \(!Number\.isFinite\(log\.ms\)\) return/,
    'an entry with no timing would render as a number');
});

test('the screen shows it, and says when the slow path was used', () => {
  assert.match(HTML, /<th style="[^"]*">Speed<\/th>/, 'the log table has no Speed column');
  assert.match(HTML, /<td style="padding:10px 12px;">\$\{speedHtml\}<\/td>/, 'the column has no cell');
  assert.match(HTML, /log\.via === 'window'/, 'a ticket on the slow path is not called out');
  assert.match(HTML, /via window/, 'nothing on screen names the fallback');
});

test('the thresholds match what this product promises', () => {
  /*
   * 184 ms is the measured byte path, so under a second is green. Past three
   * seconds a waiter is standing at a printer wondering whether it worked,
   * which is the complaint that started all of this, so it is red.
   */
  const cell = HTML.slice(HTML.indexOf('const speedHtml'), HTML.indexOf('const printerHtml'));
  assert.match(cell, /log\.ms < 1000/);
  assert.match(cell, /log\.ms < 3000/);
});

test('the log entry keeps every field it had before', () => {
  /* The detail popup and the export read these by name. Adding two fields
     must not quietly drop one. */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  /* The DEFINITION, not the first call site. `timing = {}` is what tells the
     two apart, and anchoring on the shorter signature silently read the wrong
     half of the file. */
  const at = src.indexOf('_logTicket(sale, printKind, kotNumber, saleDispId, saleDbId, printerResults, timing = {})');
  assert.notStrictEqual(at, -1, 'the log writer moved or changed shape');
  const entry = src.slice(at, src.indexOf('_saleData', at));
  for (const field of ['saleDisplayId', 'saleDbId', 'table', 'pax', 'dineType', 'printKind', 'kotNumber', 'deviceIp', 'items', 'printers']) {
    /* Several are shorthand properties with no colon after them, so match the
       name followed by a colon OR a comma. */
    assert.match(entry, new RegExp('\\b' + field + '\\s*[:,]'), 'the log entry lost ' + field);
  }
});
