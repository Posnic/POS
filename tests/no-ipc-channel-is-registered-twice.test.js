'use strict';

/*
 * No IPC channel is registered twice, because the second one kills the app.
 *
 * The owner installed a build from main and it hung on the loading screen at
 * "Starting services" forever. The log said why, once somebody looked:
 *
 *   [FATAL] Unhandled Rejection: Error: Attempted to register a second
 *   handler for 'bill:get-printing-key'
 *     at setupHardwareIPC (src/hardware-ipc.js:604)
 *
 * Electron refuses a duplicate `ipcMain.handle` by throwing. That throw
 * happened inside the boot chain, so setup stopped part-way: the window stayed
 * on its loading screen and nothing said so on screen. The till was simply
 * dead, and the only evidence was a line in a log file in AppData.
 *
 * The cause was ordinary. A merge brought the same hunk in twice - identical
 * comment, identical handler, ten lines apart - which is exactly the kind of
 * thing that reads fine in a diff and is invisible in review.
 *
 * A count is the whole test. It costs nothing and it catches every future
 * version of this, whoever writes it and whichever merge brings it in.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

/** Every channel name passed to ipcMain.handle or ipcMain.on, with its file. */
function registrations() {
  const found = [];
  for (const file of fs.readdirSync(SRC)) {
    if (!file.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    const re = /ipcMain\s*\.\s*(handle|on)\s*\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push({ kind: m[1], channel: m[2], file, line });
    }
  }
  return found;
}

test('no channel is handled twice', () => {
  /*
   * `handle` is the fatal one: Electron throws on the second registration,
   * and in the boot chain that throw stops the app starting at all.
   */
  const byChannel = new Map();
  for (const r of registrations()) {
    if (r.kind !== 'handle') continue;
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, []);
    byChannel.get(r.channel).push(`${r.file}:${r.line}`);
  }

  const twice = [...byChannel.entries()].filter(([, at]) => at.length > 1);
  assert.deepStrictEqual(
    twice.map(([channel, at]) => `${channel} at ${at.join(' and ')}`),
    [],
    'Electron throws on the second ipcMain.handle for a channel, and in the boot\n' +
      'chain that throw leaves the app stuck on its loading screen with nothing\n' +
      'on screen to say why. Delete the duplicate.'
  );
});

test('the channel that actually broke a build is registered exactly once', () => {
  /* Named on purpose, so the regression has a test with its own name. */
  const hits = registrations().filter((r) => r.channel === 'bill:get-printing-key');
  assert.strictEqual(hits.length, 1,
    'bill:get-printing-key is registered ' + hits.length + ' times: ' +
      hits.map((h) => h.file + ':' + h.line).join(', '));
});

test('every channel the preload asks for is answered by exactly one handler', () => {
  /*
   * The other direction, and the one that fails quietly rather than loudly: a
   * preload that invokes a channel nobody handles gets a rejected promise the
   * renderer usually swallows, so the button simply does nothing.
   */
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
  const asked = new Set();
  const re = /ipcRenderer\s*\.\s*(?:invoke|send)\s*\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(preload))) asked.add(m[1]);

  const answered = new Set(registrations().map((r) => r.channel));
  const unanswered = [...asked].filter((c) => !answered.has(c));
  assert.deepStrictEqual(unanswered, [],
    'the preload invokes these and nothing in src/ handles them, so the call\n' +
      'rejects and whatever button depends on it silently does nothing');
});
