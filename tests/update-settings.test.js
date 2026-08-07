/*
 * Two promises the Updates screen makes, and the ways they were not kept.
 *
 * "Check for updates automatically" is a setting a shop turns off for a
 * reason - a metered connection, a machine that must not change during a busy
 * week, an installation someone else supports. UpdateService honoured it. The
 * Updates window did not: it checked on open and then every thirty seconds
 * whatever the setting said. A setting that is quietly ignored is worse than no
 * setting at all, because it is believed.
 *
 * "Go back" existed only as a menu item under a menu a shopkeeper never opens,
 * which is the wrong place for the one action wanted at the moment an update
 * has gone wrong.
 *
 * These are asserted against the source rather than a running window because
 * the failure is structural - a missing guard, a missing control - and that is
 * visible without a browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Sources are CRLF on Windows. Normalised on read so a pattern anchored
   with a newline after a closing brace matches here as it would on a
   runner - otherwise these tests pass or fail by line ending. */
const read = (...p) =>
  fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const UI = read("update-manager.html");
const SERVICE = read("update-service.js");
const INTEGRATION = read("update-integration.js");
const PRELOAD = read("preload.js");
const MAIN = read("main.js");

test('the automatic-update setting is reachable without editing a JSON file', () => {
  assert.match(UI, /id="setAutoCheck"/, 'no control for automatic checking');
  assert.match(UI, /id="setFrequency"/, 'no control for how often');
  assert.match(
    UI,
    /saveConfig\(\{\s*autoCheck/,
    'the control does not persist through update:config-save',
  );
});

test('and turning it off actually stops this window checking', () => {
  /* The regression that prompted this: the window polled regardless. */
  const init = UI.slice(UI.indexOf('DOMContentLoaded'));
  const guard = init.indexOf('if (!autoCheck)');
  const firstCheck = init.indexOf('setTimeout(() => doCheck()');
  const interval = init.indexOf('_autoCheckInterval = setInterval');

  assert.ok(guard > -1, 'the window never reads the autoCheck setting');
  assert.ok(
    guard < firstCheck && guard < interval,
    'the window schedules its checks before testing whether it is allowed to',
  );
  assert.match(
    init.slice(guard, guard + 200),
    /return;/,
    'reading the setting has to actually stop the scheduling',
  );
});

test('turning it off stops the polling already running, not only the next one', () => {
  /* Saved and then left ticking until restart would mean the shop watches it
     check again immediately after switching it off. */
  const save = UI.slice(UI.indexOf('async function saveSettings'));
  const body = save.slice(0, save.indexOf('\n    }'));
  assert.match(body, /clearInterval\(_autoCheckInterval\)/, 'the running poll is never cancelled');
});

test('the service honours the same setting on startup', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('startAutoCheck()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /config\.autoCheck/, 'startAutoCheck ignores the setting');
  assert.match(
    body.slice(body.indexOf('config.autoCheck')),
    /return;/,
    'reading the setting must prevent the schedule being created',
  );
});

test('going back is offered beside the update, not only in a menu', () => {
  assert.match(UI, /id="btnRevert"/, 'the Updates window has no way to go back');
  assert.match(
    INTEGRATION,
    /ipcMain\.handle\('update:revert'/,
    'nothing in the main process answers a revert request',
  );
  assert.match(
    PRELOAD,
    /revert:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('update:revert'\)/,
    'preload does not expose revert',
  );
});

test('the revert control is hidden when there is nothing to revert to', () => {
  /* Offering an action that can only fail is worse than not offering it. */
  assert.match(UI, /id="revertPanel"[^>]*style="display:none;"/, 'the panel starts visible');
  const fn = UI.slice(UI.indexOf('async function refreshRevert'));
  const body = fn.slice(0, fn.indexOf('\n    }\n'));
  assert.match(body, /!r\.available/, 'availability is never checked');
  assert.match(body, /display = 'none'/, 'the panel is never hidden');
});

test('and the main process refuses a revert it cannot perform', () => {
  const fn = INTEGRATION.slice(INTEGRATION.indexOf("ipcMain.handle('update:revert'"));
  const body = fn.slice(0, fn.indexOf('\n  });'));
  assert.match(body, /status\.active/, 'reverts without checking there is an active version');
  assert.match(body, /status\.previous/, 'reverts without checking there is a previous version');
  assert.match(body, /success: false/, 'has no failure path at all');
});

test('reverting does not need the network', () => {
  /* The machine most likely to need this is the one that cannot reach us. */
  const fn = INTEGRATION.slice(INTEGRATION.indexOf("ipcMain.handle('update:revert'"));
  const body = fn.slice(0, fn.indexOf('\n  });'));
  assert.doesNotMatch(body, /fetch|https?:|download/i, 'the revert path reaches for the network');
  assert.match(body, /updater\.revert\(\)/, 'revert is not a local pointer move');
});

test('the asset updater is actually handed to the update layer', () => {
  /* Without this the handler exists, returns "not configured", and the button
     never appears - which would look exactly like working software. */
  const start = MAIN.indexOf('setupUpdateIPC({');
  assert.ok(start > -1, 'main.js never calls setupUpdateIPC');

  /* To the closing of the call itself. Stopping at the first '});' would land
     on the inner runBackup call and read only part of the options object. */
  const call = MAIN.slice(start, MAIN.indexOf('\n  });', start));
  assert.match(
    call,
    /assetUpdater,/,
    'setupUpdateIPC is not given the asset updater, so revert is never available',
  );
});
