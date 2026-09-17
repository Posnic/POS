'use strict';

/*
 * EVERY IPC HANDLER HAS A DOOR SOMEBODY CAN OPEN.
 *
 * The most expensive failures in this app this week were not broken code.
 * They were finished code nothing could reach:
 *
 *   - the kitchen announcement had two real switches and no UI, so the only
 *     way to turn it on was typing into a developer console. Nobody did, and a
 *     complete feature sat switched off for its whole life.
 *   - the handset's sold-out long press called POSNIC.askRunOut(), which did
 *     not exist, while the till endpoint it would have reached sat live and
 *     uncalled.
 *   - main.js handled 'open-hardware-manager' with a comment saying it was for
 *     a renderer, and preload.js never exposed it. Context isolation means a
 *     page has no ipcRenderer of its own, so no renderer could ever send it.
 *
 * All three read as finished from the inside. Nothing failed, nothing logged,
 * and the tests were green, because each half was correct on its own.
 *
 * `preload.js` is the only door between a page and the main process, so a
 * handler it does not expose is a handler nothing can reach. That is checkable,
 * and this checks it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const main = read('src', 'main.js');
const preload = read('src', 'preload.js');

const handled = [...main.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map((m) => m[1]);
const reachable = new Set(
  [...preload.matchAll(/ipcRenderer\.(?:invoke|send|sendSync|on)\(\s*'([^']+)'/g)].map((m) => m[1])
);

/*
 * Channels the main process handles for something other than a page.
 *
 * Empty on purpose. A name added here is a promise that something which is not
 * a renderer sends it, and the reason belongs beside the name so the next
 * person does not have to work it out.
 */
const NOT_FOR_A_PAGE = {};

test('THE SWEEP FINDS SOMETHING, or it is not a sweep', () => {
  /* A regex that matches nothing passes every assertion built on it. */
  assert.ok(handled.length > 20, `only found ${handled.length} handlers in main.js`);
  assert.ok(reachable.size > 20, `only found ${reachable.size} channels in preload.js`);
});

test('EVERY HANDLER IS REACHABLE FROM THE PRELOAD', () => {
  const shut = handled
    .filter((channel) => !reachable.has(channel))
    .filter((channel) => !(channel in NOT_FOR_A_PAGE));

  assert.deepStrictEqual(
    shut,
    [],
    `main.js handles these and no page can send them: ${shut.join(', ')}. ` +
      'preload.js is the only door - context isolation means a page has no ' +
      'ipcRenderer of its own. Either expose it there, or delete the handler, ' +
      'or add it to NOT_FOR_A_PAGE with the reason it is not for a page.'
  );
});

test('and the preload does not offer doors into empty rooms', () => {
  /*
   * The mirror, and the one that produces a silence rather than dead code: a
   * page awaits something the main process never answers. `invoke` on a
   * channel with no handler rejects; `send` to one goes nowhere at all, which
   * is the quieter and worse of the two.
   */
  const handledSet = new Set(handled);
  const alsoHandledElsewhere = (channel) =>
    /* Other main-process files register their own. kot-manager, the sync agent
       manager and the alert both do, and this test only reads main.js. */
    fs
      .readdirSync(path.join(ROOT, 'src'))
      .filter((f) => f.endsWith('.js'))
      .some((f) => read('src', f).includes(`'${channel}'`));

  const nowhere = [...reachable].filter(
    (channel) => !handledSet.has(channel) && !alsoHandledElsewhere(channel)
  );

  assert.deepStrictEqual(
    nowhere,
    [],
    `preload.js offers these and nothing in src/ answers them: ${nowhere.join(', ')}`
  );
});
