'use strict';

/*
 * THE SWITCH HAS SOMEWHERE TO LIVE, AND A BUTTON THAT PROVES IT.
 *
 * The kitchen announcement shipped with no way to turn it on. The setting was
 * real, the IPC was real, and the only way to reach either was to open the
 * developer console on the machine at the pass and type:
 *
 *     posnic.kitchenCall.set({ ting: true, speak: true })
 *
 * Nobody was ever going to do that, so nobody did, and a finished feature sat
 * switched off for its whole life. A setting nobody can find is not a setting.
 *
 * It also had no way to be tested except by sending a real order to a real
 * kitchen, which is why two faults in it were found by reading a log instead
 * of by listening.
 *
 * Both of those are pinned here: the switches, and the button.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const PAGE = ['frontend', 'modules', 'settings_write.html'];
const WIRING = ['frontend', 'static', 'script', 'js', 'modules', 'js', 'device_settings.js'];

test('THE TWO SWITCHES ARE ON A PAGE SOMEBODY CAN OPEN', () => {
  const html = read(...PAGE);

  assert.match(html, /id="toggleSwitchKitchenTing"/, 'no switch for the chime');
  assert.match(html, /id="toggleSwitchKitchenSpeak"/, 'no switch for the reading');
});

test('they are two switches, not one', () => {
  /*
   * Owner: "ting sound on/off read it on/off seperately?"
   *
   * A kitchen that can see its printer wants the chime and comes to resent the
   * reading. One switch would make somebody choose between hearing nothing and
   * hearing too much, and they would choose nothing.
   */
  const wiring = read(...WIRING);

  assert.match(wiring, /ting:\s*\$\('#toggleSwitchKitchenTing'\)\.is\(':checked'\)/);
  assert.match(wiring, /speak:\s*\$\('#toggleSwitchKitchenSpeak'\)\.is\(':checked'\)/);
});

test('THE SWITCHES SHOW WHAT THE MACHINE IS ACTUALLY SET TO', () => {
  /*
   * A switch that always renders off is worse than none: somebody flips it,
   * flips it back, and has now turned off what was on.
   */
  const wiring = read(...WIRING);

  assert.match(wiring, /bridge\.get\(\)/, 'the page never asks what this machine is set to');
  assert.match(wiring, /\.prop\('checked',\s*!!\(said && said\.ting\)\)/);
  assert.match(wiring, /\.prop\('checked',\s*!!\(said && said\.speak\)\)/);
});

test('A BUTTON MAKES THE NOISE NOW', () => {
  const html = read(...PAGE);
  const wiring = read(...WIRING);

  assert.match(html, /id="kitchenSoundTest"/, 'no way to hear it without a real order');
  assert.match(wiring, /bridge\.test\(\)/, 'the button does not reach the main process');
});

test('and it says why when nothing happened', () => {
  /*
   * "I pressed it and nothing happened" is where this feature has spent its
   * entire life. Both reasons are worth naming: the switches are down, or this
   * machine could not play it.
   */
  const wiring = read(...WIRING);

  assert.match(wiring, /reason === 'off'/, 'silence with both switches down is unexplained');
  assert.match(wiring, /lang_turn_one_of_these_on_first/);
  assert.match(wiring, /lang_this_machine_could_not_play_it/);
});

test('THE MAIN PROCESS ANSWERS THE BUTTON, down the road a real ticket takes', () => {
  /*
   * The same switches, the same tone, the same sentence, the same window. A
   * test button that took a shortcut would be the thing that passes while the
   * kitchen stays silent - which is the exact failure it exists to catch.
   */
  const main = read('src', 'main.js');

  assert.match(main, /ipcMain\.handle\('kitchen-announce:test'/, 'nothing answers the button');

  const start = main.indexOf("ipcMain.handle('kitchen-announce:test'");
  const handler = main.slice(start, start + 1200);

  assert.match(handler, /kitchenAnnounce\.settings\(\)/, 'the test ignores the switches');
  assert.match(handler, /announceKitchenTicket/, 'the test does not use the real announcer');
  assert.match(handler, /reason: 'off'/, 'the test cannot say the switches are down');
});

test('the bridge carries it', () => {
  const preload = read('src', 'preload.js');

  assert.match(preload, /test:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('kitchen-announce:test'\)/);
});

test('NO DEAD CONTROL IN A BROWSER', () => {
  /*
   * There is no posnic.kitchenCall outside the desktop app. A switch that
   * cannot do anything is worse than an absent one: somebody turns it on,
   * hears nothing, and stops trusting the rest of the page.
   */
  const wiring = read(...WIRING);

  assert.match(wiring, /if \(!bridge \|\| typeof bridge\.get !== 'function'\)/);
  assert.match(wiring, /block\(\)\.hide\(\)/, 'a browser is offered a switch that does nothing');
});

/* ------------------------------------------------------- where it lives */

test('IT LIVES WITH PRINTING, not on the sale screen settings', () => {
  /*
   * Owner, looking at it: "why settings in wrong place. is it belongs to
   * coresettings?"
   *
   * It had landed in the SALE tab, next to the auto-focus switches, because
   * those are also per-device. Per-device was the wrong thing to group by. The
   * kitchen sound is about the kitchen TICKET, so the person who wants it is
   * the person setting up the kitchen printer, and that is the Print tab -
   * which already carries the note explaining that printers, cash drawers and
   * kitchen hardware belong to this computer rather than to the shop.
   *
   * Nobody configuring the sale screen is looking for a speaker.
   */
  const html = read(...PAGE);
  const at = html.indexOf('toggleSwitchKitchenTing');
  assert.ok(at > -1, 'the switch is gone');

  const tabs = [...html.matchAll(/id="(core-tab-[a-z]+)"/g)];
  let living = null;
  for (const tab of tabs) if (tab.index < at) living = tab[1];

  assert.strictEqual(living, 'core-tab-print', `it is on ${living}`);
});

/* ------------------------------------------- nothing can take it away */

test('NO FAILURE CAN HIDE THE SWITCHES', () => {
  /*
   * This happened in a shop, in the worst shape available. Something in the
   * bell pickers threw - PosnicPro.i18n is not always ready at DOM ready, and
   * the repository has its own test about that - the failure path hid the row
   * holding the switches AND the Test button, and left three empty pickers on
   * screen.
   *
   * So the feature looked broken and impossible to turn on at the same time,
   * while the setting underneath was working perfectly. A missing switch is a
   * feature nobody can use; an unfilled picker is one somebody ignores.
   */
  const wiring = read(...WIRING);

  const hides = wiring.match(/block\(\)\.hide\(\)/g) || [];
  assert.strictEqual(
    hides.length,
    1,
    `${hides.length} places hide the block. Only the no-bridge case may: a ` +
      'setting that would not load is a reason to show the switches unchecked, ' +
      'not a reason to remove them.'
  );

  /* And the one that may hide is the browser case, decided before anything
     can fail. */
  const guard = wiring.slice(wiring.indexOf("typeof bridge.get !== 'function'"));
  assert.match(guard.slice(0, 200), /block\(\)\.hide\(\)/);
});

test('and what it hides is the whole block, not one row of it', () => {
  /*
   * `.closest('.row')` reached only the switches, so hiding in a browser left
   * the legend, the help text and three dead pickers behind. A fieldset is
   * what a person reads as one idea.
   */
  assert.match(read(...WIRING), /closest\('fieldset'\)/);
});

test('ASKING FOR A TRANSLATION CANNOT TAKE THE SCREEN DOWN', () => {
  /*
   * PosnicPro.i18n may not exist yet when this runs. Every string here goes
   * through a helper that falls back to the English it was handed, because the
   * English is the argument and is therefore always available.
   */
  const wiring = read(...WIRING);
  const mine = wiring.slice(wiring.indexOf('var bridge = window.posnic'));

  /* The helper itself asks, inside a try/catch, which is the whole point of
     having one. Everything after it must go through it. */
  const past = mine.slice(mine.indexOf('return english;'));
  const raw = past.match(/PosnicPro\.i18n\.t\(/g) || [];
  assert.deepStrictEqual(
    raw,
    [],
    'the kitchen sound block asks i18n directly; use say(key, english) so a ' +
      'page that loads before i18n still shows its controls'
  );
  assert.match(mine, /var say = function \(key, english\)/);
});
