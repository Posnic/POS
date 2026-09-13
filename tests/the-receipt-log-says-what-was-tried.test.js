'use strict';

/*
 * A day of receipt prints, tried as well as done.
 *
 * Asked for directly, after looking at the kitchen ticket log: "receipt also
 * will have 1 day log? just to see what printed ?? or tried to print..
 * something same like KOT ?"
 *
 * The answer was no. Kitchen tickets have had a log with its own screen for a
 * long time; receipts had nothing at all - not a line, not a file. When a
 * customer says their bill never came out, there was no way to tell whether
 * the till had tried, which printer it went to, or what the printer said back.
 * The only recourse was to print it again and watch.
 *
 * TRIED IS THE HALF THAT MATTERS. A receipt that printed is not the one
 * anybody comes to this screen about. A log that records only successes is
 * silent at exactly the moment it is needed, which is the same failure as the
 * Device IP column that looked like it identified the handset and did not.
 *
 * Three ways a receipt reaches paper, and all three are recorded:
 *
 *   the counter receipt, through the print handler
 *   the floor bill, which is the one a waiter cannot see at all
 *   a render failure, which never reaches a printer and today looks exactly
 *   like the till ignoring the button
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const receiptLog = require(path.join(ROOT, 'src', 'receipt-log.js'));

const HTML = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.html'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'hardware-ipc.js'), 'utf8');
const BILL = fs.readFileSync(path.join(ROOT, 'src', 'bill-manager.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

/* A throwaway directory per run, so a real till's logs are never touched. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-receipt-log-'));
receiptLog._setDir(dir);
const today = new Date().toISOString().slice(0, 10);

test('a receipt that printed is written down', () => {
  const row = receiptLog.record({
    saleId: 'SB1D10-000034', title: 'RECEIPT', total: 420, source: 'Till', ms: 124,
    printers: [{ name: 'Posnic Reception', status: 'success', bytes: 535 }],
  });
  assert.strictEqual(row.status, 'printed');
  assert.strictEqual(receiptLog.forDate(today).length, 1);
});

test('and so is one that did NOT, with the printer\'s own words', () => {
  /* The whole point. Without the reason, "failed" sends somebody to look at
     the wrong thing. */
  const row = receiptLog.record({
    saleId: 'SB1D10-000035', source: 'Till',
    printers: [{ name: 'Posnic Reception', status: 'failed', reason: 'The spooler did not confirm the job' }],
  });
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.printers[0].reason, 'The spooler did not confirm the job');
});

test('a network print job is reduced to bounded display-safe receipt data', () => {
  const row = receiptLog.record({
    time: 'not-a-date',
    kind: 'anything',
    saleId: `BILL\u0000${'x'.repeat(200)}`,
    title: 'Bill\nprint',
    source: 'Cloud\tqueue',
    ms: -4,
    printers: [{
      name: `Counter\u0000${'x'.repeat(200)}`,
      status: 'unexpected',
      reason: `No\nresponse${'x'.repeat(600)}`,
      bytes: -1,
      nested: { never: 'persisted' },
    }, { status: 'success' }, { status: 'success' }, { status: 'success' },
      { status: 'success' }, { status: 'success' }, { status: 'success' },
      { status: 'success' }, { status: 'success' }, { status: 'success' },
      { status: 'success' }, { status: 'success' }, { status: 'success' },
      { status: 'success' }, { status: 'success' }, { status: 'success' },
      { status: 'success' }],
  });
  assert.strictEqual(row.kind, 'receipt');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(row.saleId + row.title + row.source));
  assert.ok(row.saleId.length <= 128 && row.printers[0].name.length <= 128);
  assert.ok(row.printers[0].reason.length <= 512);
  assert.strictEqual(row.ms, 0);
  assert.strictEqual(row.printers[0].status, 'failed');
  assert.strictEqual(row.printers[0].bytes, 0);
  assert.strictEqual(row.printers.length, 16);
  assert.ok(!Object.hasOwn(row.printers[0], 'nested'));
});

test('one printer failing does not call the whole receipt failed', () => {
  /* The customer has their copy; the file copy did not print. Those are not
     the same event and a shopkeeper should not chase the first. */
  const row = receiptLog.record({
    saleId: 'SB1D10-000036',
    printers: [
      { name: 'Reception', status: 'success' },
      { name: 'Back office', status: 'failed', reason: 'offline' },
    ],
  });
  assert.strictEqual(row.status, 'printed');
});

test('a day with nothing in it is empty, not an error', () => {
  assert.deepStrictEqual(receiptLog.forDate('1999-01-01'), []);
});

test('one row can be removed without disturbing the rest', () => {
  const before = receiptLog.forDate(today).length;
  const row = receiptLog.record({ saleId: 'SB-DELETE-ME', printers: [{ name: 'x', status: 'success' }] });
  assert.strictEqual(receiptLog.remove(today, row.id), true);
  assert.strictEqual(receiptLog.forDate(today).length, before);
  assert.strictEqual(receiptLog.remove(today, 'no-such-id'), false);
});

test('a till printing all day does not grow a file nobody will read', () => {
  assert.ok(receiptLog.MAX_PER_DAY > 0 && receiptLog.MAX_PER_DAY <= 5000,
    'the per-day cap is missing or far too large');
});

test('a log that cannot be written never loses a receipt', () => {
  /* A customer is standing there. A logging problem must not become a
     printing problem. */
  receiptLog._setDir('\0 not a directory');
  assert.doesNotThrow(() => receiptLog.record({ saleId: 'X', printers: [] }));
  assert.strictEqual(receiptLog.record({ saleId: 'X', printers: [] }), null);
  receiptLog._setDir(dir);
});

test('the counter receipt records its outcome, and its time', () => {
  const handler = IPC.slice(IPC.indexOf("ipcMain.handle('printer:print-receipt'"), IPC.indexOf("ipcMain.handle('printer:print-report'"));
  assert.match(handler, /const startedAt = Date\.now\(\);/, 'the receipt is not timed');
  assert.match(handler, /receiptLog\.record\(\{/, 'a successful receipt is not recorded');
  assert.match(handler, /status: r\.success \? 'success' : 'failed'/, 'per-printer results are not carried');
});

test('a receipt that never reached a printer is recorded too', () => {
  /*
   * The failures BEFORE any printer is touched - a layout that will not draw,
   * a missing setting - would otherwise leave no trace at all, and look
   * exactly like the till ignoring the button.
   */
  const handler = IPC.slice(IPC.indexOf("ipcMain.handle('printer:print-receipt'"), IPC.indexOf("ipcMain.handle('printer:print-report'"));
  const katch = handler.slice(handler.indexOf('} catch (err)'));
  assert.match(katch, /receiptLog\.record\(/, 'a render failure is not recorded');
  assert.match(katch, /never reached a printer/);
});

test('the floor bill is recorded, and says it is a floor bill', () => {
  /* The one a waiter cannot see. They ask from the floor and walk to the
     printer; if nothing is there, nothing anywhere said why. */
  assert.match(BILL, /require\('\.\/receipt-log'\)\.record\(\{/, 'the floor bill is not recorded');
  assert.match(BILL, /source: 'Floor bill'/, 'a floor bill would be mistaken for a counter receipt');
  assert.match(BILL, /kind: 'bill'/);
  /* Including when it never reached a printer at all. */
  const katch = BILL.slice(BILL.indexOf('[BILL] could not print:'));
  assert.match(katch, /receipt-log/, 'a bill that never reached a printer leaves no trace');
});

test('logging never takes a bill down with it', () => {
  /* Both record calls in bill-manager sit inside their own try. */
  const guards = BILL.split("require('./receipt-log')").length - 1;
  assert.strictEqual(guards, 2, 'expected exactly two recorded outcomes in the bill path');
  assert.match(BILL, /try \{\s*\n\s*require\('\.\/receipt-log'\)/);
});

test('the screen can read it, and shows failures rather than hiding them', () => {
  assert.match(PRELOAD, /getReceiptLogs: \(date\) => ipcRenderer\.invoke\('receipt:get-logs', date\)/);
  assert.match(IPC, /ipcMain\.handle\('receipt:get-logs'/, 'nothing answers the screen');
  assert.match(HTML, /Receipt &amp; Bill Prints/, 'the screen has no receipt log section');
  assert.match(HTML, /async function rcptLoadLogs\(\)/);
  const fn = HTML.slice(HTML.indexOf('async function rcptLoadLogs'), HTML.indexOf('async function kotLoadLogs'));
  assert.match(fn, /Failed/, 'a failed receipt is not shown as failed');
  assert.match(fn, /firstWhy/, 'the printer\'s reason is not shown');
  assert.match(fn, /r\.ms < 1000/, 'the speed thresholds do not match the kitchen log');
});

test('the module is in the packaged build', () => {
  /* build.files is an allowlist. A module missing from it throws "Cannot find
     module" on a customer's counter and nowhere else. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/receipt-log.js'));
});
