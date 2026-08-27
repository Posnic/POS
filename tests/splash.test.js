/*
 * The window that appears the moment somebody double-clicks the icon.
 *
 * Between the click and the till appearing there are several seconds of
 * resolving ports, starting the database and booting the API. With nothing on
 * screen the shop assumes the click missed and clicks again - and the second
 * launch hits the single-instance lock, so it looks like nothing happened
 * twice.
 *
 * The rules worth pinning are the ones whose failure is invisible: a splash
 * that appears during a scheduled backup at ten at night, and a splash that
 * never goes away.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const MAIN = read('src/main.js');
const SPLASH = read('src/splash.js');
const splash = require('../src/splash');
const pkg = require('../package.json');

test('it can be loaded without Electron', () => {
  /* electron is passed in rather than required at the top, so this file can be
     read by the suite and by anything else that is not an Electron process. */
  assert.strictEqual(typeof splash.showSplash, 'function');
  assert.strictEqual(typeof splash.closeSplash, 'function');
  assert.doesNotMatch(SPLASH, /^const .*= require\('electron'\)/m, 'splash.js requires electron at load');
});

test('closing is safe before it ever opened, and twice over', () => {
  /* Startup has several exits and none of them should have to know which one
     ran. */
  assert.doesNotThrow(() => splash.closeSplash());
  assert.doesNotThrow(() => splash.closeSplash());
  assert.strictEqual(splash.splashIsOpen(), false);
});

test('a hidden start shows nothing', () => {
  assert.strictEqual(splash.showSplash({}, { hidden: true }), null);
});

test('nothing appears during a scheduled task', () => {
  /* The backup runs with nobody watching. A window flashing up on the screen of
     whoever is logged in at ten at night is exactly what the headless path
     exists to avoid. */
  const call = MAIN.slice(MAIN.indexOf('showSplash(require('));
  const body = call.slice(0, call.indexOf('});') + 3);

  assert.match(body, /--scheduled-task=/, 'the scheduled task is not excluded');
  assert.match(body, /__posnicStartHidden/, 'a start minimised to the tray is not excluded');
});

test('it is shown before the work that makes startup slow', () => {
  /* Placed after port resolution or database start, it would appear once there
     was nothing left to wait for. */
  const ready = MAIN.indexOf('app.whenReady().then');
  const show = MAIN.indexOf('showSplash(require(', ready);
  const ports = MAIN.indexOf('resolveLocalPorts', ready);
  const window = MAIN.indexOf('createWindow()', ready);

  assert.ok(show > ready, 'the splash is not shown from the ready handler');
  assert.ok(show < window, 'the splash is shown after the main window is created');
  if (ports > -1) {
    assert.ok(show < ports, 'the splash is shown after the ports are resolved');
  }
});

test('and it is always taken down again', () => {
  assert.match(MAIN, /mainWindow\.once\('show', closeSplash\)/, 'nothing closes it when the window appears');
  assert.match(
    MAIN,
    /if \(mainWindow\.isVisible\(\)\) closeSplash\(\);/,
    'a cold start creates the window already visible, so the show event has ' +
      'fired before the listener is attached and the splash would never close',
  );
  assert.match(
    MAIN,
    /setTimeout\(closeSplash,/,
    'there is no backstop - a startup that never shows a window would leave a ' +
      'splash on screen with a moving bar forever',
  );
});

test('it asks for no privilege at all', () => {
  const prefs = SPLASH.slice(SPLASH.indexOf('webPreferences'), SPLASH.indexOf('});', SPLASH.indexOf('webPreferences')));
  assert.match(prefs, /nodeIntegration: false/);
  assert.match(prefs, /contextIsolation: true/);
  assert.match(prefs, /sandbox: true/);
  assert.doesNotMatch(prefs, /preload/, 'a splash has nothing to say to the main process');
});

test('the progress bar does not claim to measure anything', () => {
  /* Startup takes one second or forty depending on whether it is a first run.
     A bar that crawls to 90% and stops is a worse lie than one that never
     claimed to know. */
  assert.doesNotMatch(SPLASH, /\b\d{1,3}%\s*(?:complete|done)/i);
  assert.match(SPLASH, /animation: slide/, 'the bar is not animated');
  assert.match(SPLASH, /prefers-reduced-motion/, 'the animation ignores the accessibility setting');
});

test('it ships', () => {
  assert.ok(pkg.build.files.includes('src/splash.js'), 'splash.js is missing from build.files');
});

test('the mark it draws is actually packaged', () => {
  /* splash.js and the About window both read builds/icon-256.png from
     __dirname, which is inside the asar. It was not in build.files, so both
     rendered without a logo in every installed build while looking correct
     from a checkout - the kind of gap only a packaged run shows. */
  assert.ok(
    pkg.build.files.includes('builds/icon-256.png'),
    'builds/icon-256.png is missing from build.files, so the splash and the ' +
      'About window ship with no mark',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'builds', 'icon-256.png')),
    'the mark itself is missing from the repository',
  );
});

test('shutting down says so, because it is not quick', () => {
  /* Stopping the API and closing mongod is the better part of a minute. With
     nothing on screen a restart reads as a crash. */
  assert.match(SPLASH, /function showShutdown/, 'there is no shutdown window');
  assert.match(MAIN, /showShutdown\(require\('electron'\)/, 'nothing shows it on quit');

  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  const shown = body.indexOf('showShutdown');
  const shutdown = body.indexOf('performGracefulShutdown');
  assert.ok(shown > -1 && shown < shutdown,
    'the window must appear before the shutdown starts, not after it finishes');
});

test('and it distinguishes restarting from closing', () => {
  const fn = SPLASH.slice(SPLASH.indexOf('function showShutdown'));
  assert.match(fn.slice(0, 1600), /restarting/, 'restart and quit say the same thing');
  assert.match(MAIN, /restarting: relaunchAfterQuit/, 'the caller does not pass which one it is');
});

test('a failure to draw it cannot stop the shutdown', () => {
  /* A till that will not close is worse than one that closes quietly. */
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const around = handler.slice(0, handler.indexOf('performGracefulShutdown'));
  assert.match(around, /try \{[\s\S]*showShutdown[\s\S]*catch/,
    'showShutdown is not wrapped, so an error in it would abort the quit');
});
