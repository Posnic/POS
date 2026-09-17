'use strict';

/*
 * THE ANNOUNCEMENT HAS TO REACH A WINDOW THAT CAN PLAY IT.
 *
 * The kitchen ticket was announced to
 * `getAllWindows().find(w => !w.isDestroyed())` - the FIRST window, whatever it
 * happened to be.
 *
 * That is a gamble everywhere and a bad one here, because of where this
 * feature runs. A kitchen machine is exactly the machine likely to have the
 * kitchen display open, and a support, log or hardware window can be in front
 * of the dashboard at any moment.
 *
 * Only the dashboard carries the player. `src/kitchen-screen.html` has one
 * inline script and no `kitchenCall` in it at all. A ticket announced into
 * that window is announced into nothing, silently, with no error anywhere -
 * which is the same failure this feature has already had twice, once from a
 * stale bundle and once from a CSP.
 *
 * The alarm beside it always had this right: main.js hands OrderAlert
 * `() => mainWindow`. The announcement did not.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const orderAlert = require('../src/order-alert');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** A window, as much of one as choosing between them needs. */
const windowAt = (url, { destroyed = false } = {}) => ({
  isDestroyed: () => destroyed,
  webContents: {
    getURL: () => url,
    send() {},
  },
});

const electron = (...windows) => ({ getAllWindows: () => windows });

test('IT PICKS THE DASHBOARD, not whichever window is first', () => {
  const kitchen = windowAt('file:///C:/app/resources/app.asar/src/kitchen-screen.html');
  const dashboard = windowAt('http://localhost:5555/dashboard.html#/sales');

  const chosen = orderAlert.speakingWindow(electron(kitchen, dashboard));

  assert.strictEqual(chosen, dashboard, 'it announced into the kitchen display, which has no player');
});

test('and it is not fooled by a support window sitting in front', () => {
  const support = windowAt('file:///C:/app/resources/app.asar/src/support.html');
  const log = windowAt('file:///C:/app/resources/app.asar/src/log.html');
  const dashboard = windowAt('http://localhost:5555/dashboard.html');

  assert.strictEqual(orderAlert.speakingWindow(electron(support, log, dashboard)), dashboard);
});

test('a window still loading has no URL yet and is not mistaken for one', () => {
  const loading = {
    isDestroyed: () => false,
    webContents: {
      getURL() {
        throw new Error('not ready');
      },
      send() {},
    },
  };
  const dashboard = windowAt('http://localhost:5555/dashboard.html');

  assert.strictEqual(orderAlert.speakingWindow(electron(loading, dashboard)), dashboard);
});

test('a destroyed dashboard is not chosen over a live window', () => {
  const dead = windowAt('http://localhost:5555/dashboard.html', { destroyed: true });
  const other = windowAt('file:///C:/app/src/kitchen-screen.html');

  assert.strictEqual(orderAlert.speakingWindow(electron(dead, other)), other);
});

test('WITH NO DASHBOARD IT STILL TRIES, rather than giving up', () => {
  /*
   * Before anybody signs in the only window is the sign-in screen, which has
   * no player either. But a shop with nobody signed in has nobody in the
   * kitchen, so silence then is correct rather than a fault - and trying is
   * still better than deciding not to.
   */
  const login = windowAt('http://localhost:5555/index.html');

  assert.strictEqual(orderAlert.speakingWindow(electron(login)), login);
});

test('and no windows at all is null, not a crash', () => {
  assert.strictEqual(orderAlert.speakingWindow(electron()), null);
  assert.strictEqual(orderAlert.speakingWindow({ getAllWindows: () => null }), null);
});

/* ------------------------------------------------- nothing guesses any more */

test('NOTHING STILL PICKS A WINDOW BY POSITION', () => {
  /*
   * Both roads matter. The real ticket goes through kot-manager; the Test
   * button goes through main.js, and a Test button that takes a different
   * road from a real ticket is the thing that passes while the kitchen stays
   * silent.
   */
  for (const file of ['kot-manager.js', 'main.js']) {
    const source = read('src', file);
    assert.ok(
      !/getAllWindows\(\)\.find\(/.test(source),
      `src/${file} still takes whichever window comes first`
    );
  }

  assert.match(read('src', 'kot-manager.js'), /speakingWindow\(BrowserWindow\)/);
  assert.match(read('src', 'main.js'), /speakingWindow\(BrowserWindow\)/);
});

test('the kitchen display genuinely has no player, which is why this matters', () => {
  /*
   * If somebody later gives that window the player, this test failing is the
   * signal to widen the choice rather than to delete the check.
   */
  const screen = read('src', 'kitchen-screen.html');

  assert.ok(
    !screen.includes('kitchenCall'),
    'the kitchen display now carries the player, so speakingWindow should allow it too'
  );
});
