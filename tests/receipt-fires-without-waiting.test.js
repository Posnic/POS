'use strict';

/*
 * What the receipt waits for before a byte reaches the printer.
 *
 * Owner: "receipt prniter is direct connection right, why its not fired
 * immediately? need deep investigation."
 *
 * It is a direct connection, and the printer was never the slow part. Two
 * things sat in front of it, both measured on a real Windows machine:
 *
 *   Enumerating the printers   about 2,100 ms with eight queues installed
 *   Starting PowerShell         about 546 ms, per copy
 *
 * The first was paid on every receipt that had no chosen printer, because the
 * Windows default is read out of that list and nothing remembered it. This
 * closes that one. The second is a bigger change and is still open.
 *
 * A third thing was not slow, just wrong: a printer named POS-80C, the factory
 * name on most generic 80mm units, was discarded and replaced by the Windows
 * default on the HTML path. The same rewrite was removed from the kitchen path
 * once already.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HW = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.js'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'hardware-ipc.js'), 'utf8');

test('the printer list is remembered, so a receipt does not pay the spooler for it', () => {
  assert.match(HW, /const LIST_CACHE_MS = \d+;/, 'there is no cache window');
  assert.match(HW, /async listPrinters\(\{ fresh = false \} = \{\}\) \{/, 'the list cannot be asked for fresh');
  assert.match(HW, /if \(!fresh && this\._printerCache && now - this\._printerCache\.at < LIST_CACHE_MS\)/,
    'a remembered list is not used');
  assert.match(HW, /this\._printerCache = \{ at: now, list \};/, 'nothing is remembered');
  assert.match(HW, /async _listPrintersUncached\(\) \{/, 'the real enumeration is gone');
  /* The enumeration itself must still be reachable exactly once. */
  assert.strictEqual((HW.match(/getPrintersAsync\(\)/g) || []).length, 1);
});

test('somebody choosing a printer always sees the real list', () => {
  /* A person who just plugged a printer in is standing there waiting for it
     to appear; fifteen seconds of memory would read as a broken chooser. */
  assert.match(IPC, /ipcMain\.handle\('printer:list', async \(\) => \{\s*return await hardwareManager\.listPrinters\(\{ fresh: true \}\);/);
});

test('the cache window is short enough that a printer turns up on its own', () => {
  const ms = Number((HW.match(/const LIST_CACHE_MS = (\d+);/) || [])[1]);
  assert.ok(ms >= 5000, 'shorter than this and the cache buys nothing on a busy counter');
  assert.ok(ms <= 60000, 'a printer plugged in during service would not appear for a minute');
});

test('a printer really called POS-80C can be addressed by its name', () => {
  /*
   * It is the factory name on most generic 80mm units. Rewriting it to the
   * Windows default meant such a shop could not send a job to its own
   * printer, and the only trace was a console warning nobody reads. Removed
   * from the kitchen path already; this is the other half.
   */
  assert.ok(
    !/requested\.toUpperCase\(\)\s*===\s*'POS-80C'/.test(HW),
    'the POS-80C rewrite is back; a shop with that printer prints to the wrong device'
  );
  assert.ok(
    !/Ignoring stale POS-80C/.test(HW),
    'the rewrite is still there, just quieter'
  );
  /* The name still has to exist on the machine: an unknown one is an error,
     not a silent redirect. */
  assert.match(HW, /throw new Error\(`Printer not found: \$\{requested\}/);
});
