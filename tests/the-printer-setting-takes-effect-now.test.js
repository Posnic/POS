'use strict';

/*
 * CHANGING THE RECEIPT PRINTER TAKES EFFECT ON THE NEXT BILL.
 *
 * Owner: "print bill from desktop not working. thermal printer not taking
 * bills?" It was printing perfectly, and his own receipt log proves it:
 *
 *   19:25:44  BILL  545  source: Till  ->  "Posnic Reception"  success 910 bytes
 *   19:32:23  BILL  400  source: Floor bill -> POS-80C         success 796 bytes
 *   19:36:03  BILL  660  source: Till  ->  "Posnic Reception"  success 861 bytes
 *
 * Every desktop bill went to a printer on the other side of the shop while he
 * watched the thermal one. The handset's floor bill, which resolves its
 * printer in the main process, went to the right place.
 *
 * WHY. The Receipt Printer setting lives in `preferences`, a file the main
 * process owns, because Hardware Manager runs on a different origin with its
 * own localStorage. `syncPrinterPreferences` mirrors it into the till window -
 * and had exactly ONE call site, at startup, while its own doc comment said it
 * was "called at startup and again after printing". So the till addressed
 * every receipt to whatever printer it had cached at boot. Change the setting,
 * press Print Bill, and the bytes go to the old queue and the log records a
 * success. Nothing anywhere says the setting was ignored.
 *
 * This is the silent-no-op shape again: a mirror that exists, is correct, and
 * runs too rarely to matter.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
const NL = String.fromCharCode(10);

/** The body of one PosnicPro method, by name. */
function methodSource(name) {
  const at = CORE.indexOf(name + ': function');
  assert.ok(at > 0, name + ' is gone from PosnicPro.js');
  const next = CORE.indexOf(NL + '    ', CORE.indexOf('{', at));
  /* Far enough to cover the method; the assertions below are specific. */
  return CORE.slice(at, at + 4000);
}

test('the mirror from preferences into the window still exists', () => {
  const sync = methodSource('syncPrinterPreferences');
  assert.match(sync, /preferences\.get\('receipt_printer'\)/,
    'the receipt printer is no longer read from the machine settings');
  assert.match(sync, /local\.set\('receipt_printer'/,
    'the setting is read but never mirrored into the window');
});

test('a receipt resolves its printer AFTER refreshing the setting', () => {
  /*
   * The order matters and is the whole fix: sync, then resolve. Resolving
   * first reads a value cached at boot, which is what sent his bills to the
   * wrong printer.
   */
  const syncAt = CORE.indexOf('PosnicPro.syncPrinterPreferences())');
  const resolveAt = CORE.indexOf('return PosnicPro.resolveReceiptPrinter();');
  assert.ok(syncAt > 0, 'the print path no longer refreshes the printer setting');
  assert.ok(resolveAt > 0, 'the print path no longer resolves a receipt printer');
  assert.ok(syncAt < resolveAt,
    'the printer name is resolved before the setting is refreshed, so a change needs a restart');
});

test('a failed refresh still prints, rather than losing the sale', () => {
  /*
   * The mirror talks to the main process. If that ever fails, a customer
   * standing at the counter must still get a bill on the last known printer -
   * a receipt that never came out is worse than one on yesterday's queue.
   */
  const at = CORE.indexOf('PosnicPro.syncPrinterPreferences())');
  const chain = CORE.slice(at, at + 260);
  assert.match(chain, /\.catch\(/,
    'a failed settings refresh would reject the whole print chain');
});

test('the mirror is not left with a single call site again', () => {
  /*
   * It had one, at startup. Its own comment claimed two. The print path is
   * now the second, and that is what this counts - if somebody removes it,
   * the bug returns exactly as it was and nothing else fails.
   */
  const calls = CORE.match(/PosnicPro\.syncPrinterPreferences\(\)/g) || [];
  assert.ok(calls.length >= 2,
    'syncPrinterPreferences has ' + calls.length + ' call site(s); the print path must be one of them');
});
