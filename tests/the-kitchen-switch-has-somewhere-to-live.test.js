'use strict';

/*
 * THE KITCHEN'S SPEAKER HAS SOMEWHERE TO LIVE, AND IT TOOK THREE GOES.
 *
 * The announcement shipped with no way to turn it on at all. The setting was
 * real and the IPC was real, and the only route to either was opening a
 * developer console on the machine at the pass and typing:
 *
 *     posnic.kitchenCall.set({ ting: true, speak: true })
 *
 * Nobody was going to do that, so nobody did, and a finished feature sat
 * switched off for its whole life. A setting nobody can find is not a setting.
 *
 * Then it was put in the wrong place twice. First the Sale tab of Core
 * Settings, beside the auto-focus switches, because those are device-local
 * too. Then the Print tab, because the kitchen ticket is printed. Owner, on
 * the second: "this is about kitchen play right? not restaurant module?"
 *
 * Per-device was the right instinct and the wrong page both times. A speaker is
 * a device on ONE COMPUTER, like the cash drawer, the weighing scale and the
 * kitchen screen. Hardware Manager is where those live, and it is the window
 * somebody setting up the machine at the pass is already standing in.
 *
 * It also had no way to be tested except by sending a real order to a real
 * kitchen, which is why both faults in it were found by reading a log.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HOME = read('src', 'hardware-manager.html');

/* ------------------------------------------------------------- it exists */

test('THE SWITCHES ARE SOMEWHERE SOMEBODY CAN OPEN', () => {
  assert.match(HOME, /id="kitchenTing"/, 'no switch for the bell');
  assert.match(HOME, /id="kitchenSpeak"/, 'no switch for the reading');
  assert.match(HOME, /id="soundTab"/, 'the section is not there');
  assert.match(HOME, /switchTab\('sound'\)/, 'nothing opens it');
});

test('IT LIVES WITH THE OTHER THINGS PLUGGED INTO THIS COMPUTER', () => {
  /*
   * A speaker sits beside the cash drawer, the weighing scale and the kitchen
   * screen, and it is per machine for the same reason they are.
   */
  const tabs = HOME.slice(HOME.indexOf("switchTab('cash')"), HOME.indexOf("switchTab('scanner')"));
  assert.match(tabs, /switchTab\('sound'\)/, 'it is not among the hardware tabs');
});

test('AND IT IS REALLY GONE FROM WHERE IT USED TO BE', () => {
  /* Two homes drift apart, and then a shop has two answers to one question. */
  for (const page of [
    ['frontend', 'modules', 'settings_write.html'],
    ['frontend', 'static', 'script', 'js', 'modules', 'js', 'device_settings.js'],
  ]) {
    const left = read(...page);
    assert.ok(
      !/kitchenArrivalBell|kitchenSoundTest|toggleSwitchKitchenTing/.test(left),
      `${page.join('/')} still carries the kitchen sound controls`
    );
  }
});

test('they are two switches, not one', () => {
  /*
   * Owner: "ting sound on/off read it on/off seperately?"
   *
   * A kitchen that can see its printer wants the bell and comes to resent the
   * reading. One switch would make somebody choose between hearing nothing and
   * hearing too much, and they would choose nothing.
   */
  assert.match(HOME, /ting: at\('kitchenTing'\)\.checked/);
  assert.match(HOME, /speak: at\('kitchenSpeak'\)\.checked/);
});

test('THE SWITCHES SHOW WHAT THE MACHINE IS ACTUALLY SET TO', () => {
  /* A switch that always renders off is worse than none: somebody flips it,
     flips it back, and has now turned off what was on. */
  assert.match(HOME, /bridge\.get\(\)/, 'the window never asks what this machine is set to');
  assert.match(HOME, /at\('kitchenTing'\)\.checked = !!\(said && said\.ting\)/);
  assert.match(HOME, /at\('kitchenSpeak'\)\.checked = !!\(said && said\.speak\)/);
});

/* ------------------------------------------------ nothing can remove them */

test('NO FAILURE CAN HIDE THE SWITCHES', () => {
  /*
   * This happened in a shop. On the page this replaces, filling the voice
   * picker threw - PosnicPro.i18n is not always ready at DOM ready - and the
   * failure path hid the row holding the switches AND the Test button, leaving
   * three empty pickers on screen.
   *
   * The feature looked broken and impossible to turn on at the same time,
   * while the setting underneath was working perfectly.
   *
   * So the switches are set BEFORE anything that can fail, and the pickers
   * fill inside their own guard.
   */
  const wiring = HOME.slice(HOME.indexOf('bridge.get().then('));
  const switches = wiring.indexOf("at('kitchenTing').checked =");
  const pickers = wiring.indexOf('bridge.bells()');

  assert.ok(switches > -1 && pickers > -1, 'the wiring moved');
  assert.ok(switches < pickers, 'the pickers are filled before the switches are set');
  assert.match(wiring.slice(switches, pickers), /try \{/, 'the pickers are not guarded');
});

test('NO DEAD CONTROL WHERE THERE IS NO BRIDGE', () => {
  /*
   * Outside the desktop app there is no posnic.kitchenCall, and a control that
   * cannot do anything is worse than an absent one: somebody turns it on,
   * hears nothing, and stops trusting the rest of the window.
   */
  assert.match(HOME, /if \(!bridge \|\| typeof bridge\.get !== 'function'\)/);
  const guard = HOME.slice(HOME.indexOf("typeof bridge.get !== 'function'"));
  assert.match(guard.slice(0, 300), /style\.display = 'none'/, 'the tab is still offered');
});

/* ------------------------------------------------------------ the button */

test('A BUTTON MAKES THE NOISE NOW', () => {
  assert.match(HOME, /id="kitchenSoundTest"/, 'no way to hear it without a real order');
  assert.match(HOME, /bridge\.test\(\)/, 'the button does not reach the main process');
});

test('and it says why when nothing happened', () => {
  /*
   * "I pressed it and nothing happened" is where this feature has spent its
   * entire life. Both reasons are worth naming: the switches are down, or this
   * machine could not play it.
   */
  assert.match(HOME, /reason === 'off'/, 'silence with both switches down is unexplained');
  assert.match(HOME, /Turn one of these on first/);
  assert.match(HOME, /could not play it/);
  assert.match(HOME, /check the volume/);
});

test('THE MAIN PROCESS ANSWERS THE BUTTON, down the road a real ticket takes', () => {
  /*
   * The same switches, the same tone, the same sentence, the same window. A
   * test button that took a shortcut would be the thing that passes while the
   * kitchen stays silent - the exact failure it exists to catch.
   */
  const main = read('src', 'main.js');
  assert.match(main, /ipcMain\.handle\('kitchen-announce:test'/, 'nothing answers the button');

  const handler = main.slice(main.indexOf("ipcMain.handle('kitchen-announce:test'"), 0);
  const body = main.slice(main.indexOf("ipcMain.handle('kitchen-announce:test'"));
  assert.match(body.slice(0, 1200), /kitchenAnnounce\.settings\(\)/, 'the test ignores the switches');
  assert.match(body.slice(0, 1200), /announceKitchenTicket/, 'it does not use the real announcer');
  assert.match(body.slice(0, 1200), /reason: 'off'/, 'it cannot say the switches are down');
  assert.strictEqual(typeof handler, 'string');
});

test('the bridge carries all of it', () => {
  const preload = read('src', 'preload.js');

  assert.match(preload, /test:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('kitchen-announce:test'\)/);
  assert.match(preload, /bells:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('kitchen-announce:bells'\)/);
  assert.match(preload, /preview:\s*\(kind, which\)/);
});
