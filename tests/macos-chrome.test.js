/*
 * The two things a Mac showed that Windows never did.
 *
 * Both came from the same habit: code written on Windows, where the assumption
 * happened to be true, then shipped everywhere.
 *
 *   Two sets of window buttons. The page draws minimise, maximise and close
 *   itself because Windows needed that. macOS keeps its traffic lights
 *   whatever the title bar style, so a Mac had Apple's three circles top-left
 *   and ours top-right - and neither looked wrong on its own.
 *
 *   "Windows default printer", on a Mac. The hardware screen offered it in a
 *   dropdown and warned that a receipt could not be sent to "the Windows
 *   default" - naming a thing that does not exist there. A shop reading that
 *   reasonably wonders what else the software has misunderstood about their
 *   machine.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const MAIN = read('src/main.js');
const HARDWARE = read('src/hardware-manager.html');
const PRELOAD = read('src/preload.js');

test('macOS gets one set of window controls, not two', () => {
  assert.match(
    MAIN,
    /titleBarStyle: process\.platform === 'darwin' \? 'hiddenInset' : 'hidden'/,
    "titleBarStyle is fixed, so macOS keeps its traffic lights while the page " +
      'also draws its own buttons',
  );
  assert.match(
    MAIN,
    /posnic-window-controls \{ display: none/,
    'nothing hides the page-drawn buttons on macOS',
  );
});

test('and the traffic lights do not sit on top of the page', () => {
  assert.match(MAIN, /trafficLightPosition/, 'the native buttons are not positioned for our bar height');
  assert.match(MAIN, /padding-left: 78px/, 'the page toolbar starts underneath the traffic lights');
});

test('the stylesheet survives navigation', () => {
  /* insertCSS applies to the current document. The till moves between pages,
     and a stylesheet inserted once would leave every page after the first
     showing both sets of buttons again. */
  const block = MAIN.slice(MAIN.indexOf("if (process.platform === 'darwin') {"));
  assert.match(
    block.slice(0, block.indexOf('\n  }') + 4),
    /on\('dom-ready', applyMacChrome\)/,
    'the macOS chrome is applied once rather than on every navigation',
  );
});

test('the renderer can find out which operating system it is on', () => {
  /* It had no way to ask, so it assumed. */
  assert.match(
    PRELOAD,
    /platform: process\.platform/,
    'no platform is exposed, so pages have to guess',
  );
});

test('nothing offers a Windows default printer on a Mac', () => {
  /* "Windows default" must still appear once - as the win32 branch of the
     label - so this looks for it being *used* rather than being absent. Any
     occurrence outside that one mapping line is a hardcoded string again. */
  const uses = HARDWARE.split('\n').filter((line) => {
    if (!/Windows default/.test(line)) return false;
    if (/OS_PLATFORM === 'win32'/.test(line)) return false;   // the label itself
    if (/^\s*[*/]/.test(line)) return false;                  // a comment explaining the bug
    return true;
  });
  assert.deepStrictEqual(
    uses, [],
    'the hardware screen names the Windows default printer directly instead of ' +
      'through the platform label:\n' + uses.join('\n'),
  );
  assert.match(HARDWARE, /OS_DEFAULT_LABEL/, 'the label is not derived from the platform');
});

test('and the label says the right thing for each platform', () => {
  const block = HARDWARE.slice(HARDWARE.indexOf('const OS_DEFAULT_LABEL'));
  const decl = block.slice(0, block.indexOf(';') + 1);

  assert.match(decl, /win32.*Windows/s, 'Windows is not named on Windows');
  assert.match(decl, /darwin.*macOS/s, 'macOS is not named on macOS');
  assert.match(decl, /linux/, 'Linux is not handled');
});

test('an unknown platform is vague rather than wrong', () => {
  /* Falling back to "Windows" would put the original bug back for anything the
     bridge could not answer for - including the browser build, where there is
     no Electron at all. */
  const block = HARDWARE.slice(HARDWARE.indexOf('const OS_DEFAULT_LABEL'));
  const decl = block.slice(0, block.indexOf(';') + 1);
  const fallback = decl.slice(decl.lastIndexOf(':'));

  assert.doesNotMatch(fallback, /Windows/, 'the fallback assumes Windows');
  assert.match(fallback, /system default/, 'the fallback is not the neutral wording');
});
