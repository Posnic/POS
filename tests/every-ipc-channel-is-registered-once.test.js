/*
 * NO IPC CHANNEL IS REGISTERED TWICE.
 *
 * `ipcMain.handle` THROWS on a duplicate channel: "Attempted to register a
 * second handler for 'x'". Inside setupHardwareIPC that is not a warning in a
 * log - it aborts the function, so every handler AFTER the duplicate is never
 * registered at all. The screens that call them then fail with "No handler
 * registered", which reads like a broken screen rather than a line of
 * registration that never ran.
 *
 * It happened: `bill:get-printing-key` went in twice, because a patch script
 * was run twice after a mid-way failure. It shipped in beta.847, and it took
 * the KOT log handlers, the reprint handler and the scale down with it.
 *
 * The same file is scanned for duplicate `ipcMain.on` channels, which do not
 * throw but silently double-fire - the quieter half of the same mistake.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src');

/** Every .js file in src/, where the main process registers its handlers. */
function mainProcessFiles() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(ROOT, e.name));
}

/** channel -> how many times this file registers it. */
function channels(source, call) {
  const found = new Map();
  const pattern = new RegExp(`ipcMain\\.${call}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  for (const m of source.matchAll(pattern)) {
    found.set(m[1], (found.get(m[1]) || 0) + 1);
  }
  return found;
}

test('no file registers the same ipcMain.handle channel twice', () => {
  const offences = [];
  for (const file of mainProcessFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [channel, count] of channels(source, 'handle')) {
      if (count > 1) offences.push(`${path.basename(file)}: '${channel}' x${count}`);
    }
  }
  assert.deepStrictEqual(offences, [],
    'ipcMain.handle throws on a duplicate, and everything registered after it in that '
    + 'function never runs:\n  ' + offences.join('\n  '));
});

test('no channel is handled by two different files either', () => {
  /*
   * Two files registering one channel is the same throw, just harder to see -
   * and whichever file is required second is the one that dies.
   */
  const owners = new Map();
  for (const file of mainProcessFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const channel of channels(source, 'handle').keys()) {
      const list = owners.get(channel) || [];
      list.push(path.basename(file));
      owners.set(channel, list);
    }
  }
  const shared = [...owners.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([channel, files]) => `'${channel}' in ${files.join(' and ')}`);
  assert.deepStrictEqual(shared, []);
});

test('no file listens on the same ipcMain.on channel twice', () => {
  /* These do not throw. They fire twice, which is worse: a print handler
     registered twice prints two copies of everything. */
  const offences = [];
  for (const file of mainProcessFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [channel, count] of channels(source, 'on')) {
      if (count > 1) offences.push(`${path.basename(file)}: '${channel}' x${count}`);
    }
  }
  assert.deepStrictEqual(offences, []);
});

test('the bill printing channels exist exactly once, and are reachable', () => {
  /* The two this test was written for, named so a rename cannot quietly drop
     the check. */
  const ipc = fs.readFileSync(path.join(ROOT, 'hardware-ipc.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

  for (const channel of ['bill:get-status', 'bill:get-printing-key']) {
    const times = [...ipc.matchAll(new RegExp(`ipcMain\\.handle\\('${channel}'`, 'g'))].length;
    assert.equal(times, 1, `'${channel}' is registered ${times} times`);
    assert.ok(preload.includes(channel), `'${channel}' is registered but nothing can call it`);
  }
});

test('the far door does not carry this machine\'s kiosk key', () => {
  /*
   * KIOSK_API_KEY guards every kiosk route on this till - the kitchen display,
   * the tablet, the phone ordering routes. Sending it to an address somebody
   * typed into a settings box risks all of that to buy printing. The cloud
   * door has a key worth exactly one thing.
   */
  const ipc = fs.readFileSync(path.join(ROOT, 'hardware-ipc.js'), 'utf8');
  const prefs = fs.readFileSync(path.join(ROOT, 'device-preferences.js'), 'utf8');

  assert.match(ipc, /ipcMain\.handle\('bill:get-printing-key',\s*\(\)\s*=>\s*preferences\.cloud_print_key/,
    'the screen shows the kiosk key, which is not what the cloud should be given');
  assert.match(prefs, /cloud_print_key/, 'the relay settings do not carry a key of their own');
  assert.match(ipc, /preferences\.cloud_print_key\s*=\s*require\('crypto'\)\.randomBytes\(32\)/,
    'nothing ever makes the key, so the field is empty for ever');
});
