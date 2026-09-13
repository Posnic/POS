'use strict';

/*
 * The one screen whose whole job is to prove the hardware works.
 *
 * The owner set up two printers on it and sent a test receipt. The screen
 * said, in this order:
 *
 *   "Sent undefined bytes. Check that every amount ends flush right."
 *   "No printer selected."   (under a list with a printer visibly ticked)
 *   "KOT polling started! Listening for new orders every 5 seconds."
 *
 * All three were false. The first because the print handler stopped carrying a
 * byte count when it learned to drive several printers. The second because the
 * summary was written when the list was drawn and after a save, and nothing
 * listened in between. The third because a sale has announced itself the
 * moment it is saved since the event bus went in, and the poll underneath has
 * been thirty seconds, not five.
 *
 * A diagnostic screen that lies is worse than no diagnostic screen: it sends
 * somebody looking at their printer when the fault is here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.html'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'hardware-ipc.js'), 'utf8');

test('the test print reports how many bytes it actually sent', () => {
  /* The screen reads result.bytes. The handler has to answer it. */
  assert.match(HTML, /'Sent ' \+ result\.bytes \+ ' bytes\./, 'the screen stopped reporting the size');
  const handler = IPC.slice(IPC.indexOf("ipcMain.handle('printer:print-receipt'"), IPC.indexOf("ipcMain.handle('printer:print-report'"));
  const block = handler || IPC;
  assert.match(block, /sent: bytes\.length/, 'nothing records what each copy sent');
  assert.match(block, /const sentBytes = results\.reduce\(/, 'the total is not worked out');
  assert.match(block, /bytes: sentBytes,/, 'the answer still has no byte count in it');
});

test('only successful copies are counted, so a failed print does not claim bytes', () => {
  const block = IPC.slice(IPC.indexOf('const sentBytes'), IPC.indexOf('const sentBytes') + 200);
  assert.match(block, /r\.success \? \(r\.sent \|\| 0\) : 0/, 'a refused copy is counted as sent');
});

test('the printer summary follows the ticks, not the Save button', () => {
  assert.match(HTML, /list\.addEventListener\('change', rpUpdateSummary\);/, 'ticking a printer updates nothing');
  assert.match(HTML, /list\.addEventListener\('input', rpUpdateSummary\);/, 'changing copies or paper updates nothing');
  /* Delegated from the container, because the rows are redrawn on every
     reload and listeners bound to them would be thrown away with them. */
  const wiring = HTML.slice(HTML.indexOf('function rpUpdateSummary'), HTML.indexOf('async function rpInit'));
  assert.match(wiring, /getElementById\('rpPrinterList'\)/, 'the listener is bound to rows, not the list');
});

test('the kitchen status does not promise a five second poll that does not exist', () => {
  assert.ok(!/Listening for new orders every 5 seconds/.test(HTML),
    'the screen still promises a five second poll');
  assert.match(HTML, /Kitchen printing is on\. Tickets print as orders arrive\./,
    'it no longer says what happens when it is on');
  /* And the number it used to quote is not the real one anyway. */
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /const KOT_FALLBACK_POLL_MS = 30000;/,
    'the fallback interval moved; check the wording on the screen still fits');
});
