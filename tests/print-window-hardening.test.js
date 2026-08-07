/*
 * The two offscreen windows that render for the printer, and why they differ.
 *
 * Both have been flagged by automated review as "webSecurity: false - fix it".
 * One of them should be fixed and now is. The other must not be, and turning it
 * on would not fail a test or raise an error - it would print receipts with no
 * stylesheet and no shop logo, found by a customer rather than by CI.
 *
 * So the difference is asserted here, in both directions:
 *
 *   - The kitchen ticket window keeps web security ON, and its HTML must stay
 *     self-contained for that to remain true. A logo added to a KOT ticket
 *     would silently stop loading.
 *   - The receipt window keeps it OFF, because the invoice HTML links a
 *     stylesheet and an image from the local API into a data: URL page, whose
 *     origin is opaque.
 *
 * Both are confined the same way regardless, because neither should ever open a
 * window or navigate.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const KOT = read('kot-manager.js');
const HARDWARE = read('hardware-manager.js');
const GUARD = read('print-window-guard.js');

/** The webPreferences block of the print window in a given source file. */
function printWindowPrefs(src) {
  const at = src.indexOf('new BrowserWindow({');
  assert.ok(at > -1, 'no BrowserWindow is created in this file');
  const from = src.indexOf('webPreferences', at);
  assert.ok(from > -1, 'the print window declares no webPreferences');
  return src.slice(from, src.indexOf('});', from));
}

test('the kitchen ticket window runs with web security on', () => {
  assert.match(
    printWindowPrefs(KOT),
    /webSecurity:\s*true/,
    'the KOT print window builds a self-contained document, so there is no ' +
      'reason for it to run with web security disabled',
  );
});

test('and its HTML stays self-contained, which is what makes that safe', () => {
  /* With web security on, an external stylesheet or image would simply not
     load - no error, just a ticket missing whatever was added. */
  const fn = KOT.slice(KOT.indexOf('_buildKOTHtml(sale, printKind, kotNumber)'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));

  for (const [pattern, what] of [
    [/<img\b/i, 'an image'],
    [/<link\b/i, 'a stylesheet link'],
    [/@font-face/i, 'a web font'],
    [/\bsrc\s*=/i, 'a src attribute'],
    [/url\(\s*['"]?https?:/i, 'a remote url()'],
    [/https?:\/\//i, 'an absolute URL'],
  ]) {
    assert.doesNotMatch(
      body,
      pattern,
      `the KOT document now contains ${what}. It runs with web security on ` +
        'from an opaque data: origin, so that resource will not load and the ' +
        'ticket will print without it. Either inline it, or serve the document ' +
        'from the local origin instead of a data: URL.',
    );
  }
});

test('the receipt window ties web security to where it loads from', () => {
  /*
   * This used to be a flat `webSecurity: false`, because the document was a
   * data: URL and its opaque origin could not fetch print.css or the shop's
   * logo from the local API.
   *
   * It is now served from the API itself, so the page is same-origin with both
   * and needs no exception. The exception survives only for the fallback path,
   * which is still a data: URL - see tests/print-document-store.test.js.
   *
   * Hardcoding either value would be wrong now: `true` breaks the fallback,
   * `false` gives the normal path an exception it does not need.
   */
  assert.match(
    printWindowPrefs(HARDWARE),
    /webSecurity:\s*route\.secure/,
    'the receipt print window no longer follows the route it loads from',
  );

  const before = HARDWARE.slice(0, HARDWARE.indexOf('new BrowserWindow({'));
  assert.match(
    before.slice(-2500),
    /opaque origin/,
    'the reason the fallback needs the exception must stay written next to it, ' +
      'or the next audit removes the fallback and printing breaks when the API ' +
      'is not yet up',
  );
});

test('both print windows are confined the same way', () => {
  for (const [name, src] of [['kot-manager.js', KOT], ['hardware-manager.js', HARDWARE]]) {
    assert.match(src, /require\('\.\/print-window-guard'\)/, `${name} does not load the guard`);
    assert.match(src, /hardenPrintWindow\(printWindow\)/, `${name} never applies it`);
  }
});

test('the guard refuses new windows and navigation', () => {
  assert.match(GUARD, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/, 'popups are not denied');
  assert.match(GUARD, /'will-navigate'/, 'navigation is not prevented');
  assert.match(GUARD, /preventDefault/, 'nothing actually stops the navigation');
});

test('and never stops a shop printing if it fails', () => {
  /* Hardening that can break printing is worse than the hole it closes. */
  const fn = GUARD.slice(GUARD.indexOf('function hardenPrintWindow'));
  assert.match(fn, /try\s*{/, 'the guard is not wrapped against its own failure');
  assert.match(fn, /catch/, 'a failure in the guard would propagate into the print path');
});

test('a print window still cannot reach IPC, whatever its web security', () => {
  /* This is the boundary that actually matters, and it is independent of both
     settings above: ipc-guard trusts file: and loopback http: origins only, so
     a data: page is refused. */
  const ipcGuard = read('ipc-guard.js');
  const fn = ipcGuard.slice(ipcGuard.indexOf('function isTrustedFrame'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  assert.match(body, /url\.protocol === 'file:'/, 'file: origins are no longer classified');
  assert.match(body, /url\.protocol === 'http:'/, 'http: origins are no longer classified');
  assert.match(
    body.trimEnd(),
    /return false;\s*$/,
    'isTrustedFrame must end by refusing anything it did not recognise - a ' +
      'data: print window depends on falling through to that',
  );
});
