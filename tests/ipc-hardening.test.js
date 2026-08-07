/*
 * The renderer-to-main boundary.
 *
 * The professional-software audit found 78 ipcMain handlers across main.js,
 * hardware-ipc.js, pin-lock-ipc.js and update-integration.js, and not one
 * looked at event.senderFrame. backup:restore, backup:delete,
 * backup:browse-folder and desktop:open were among them - so any frame that
 * could reach ipcRenderer could restore a backup over a shop's live data.
 *
 * Three separate findings composed into that: the API's CSP allows
 * 'unsafe-eval' for the legacy frontend, print windows render HTML supplied by
 * the renderer, and those print windows ran with webSecurity off. A script in
 * one of them inherited the whole privileged surface.
 *
 * These tests hold three lines: every handler is registered through the guard,
 * the guard trusts only our own pages, and every window that can run our
 * preload is sandboxed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const IPC_FILES = ['main.js', 'hardware-ipc.js', 'pin-lock-ipc.js', 'update-integration.js'];

test('no file registers an IPC handler on the raw ipcMain', () => {
  /* The guard works by shadowing the binding: each file destructures
     `ipcMain: rawIpcMain` and rebinds `ipcMain` to the wrapper, so every
     registration below is covered without being touched. A call on
     rawIpcMain.handle would step around that. */
  const offenders = [];
  for (const file of IPC_FILES) {
    const src = read(file);
    src.split('\n').forEach((line, i) => {
      if (/\brawIpcMain\s*\.\s*(handle|on)\s*\(/.test(line)) {
        offenders.push(`${file}:${i + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'these register an IPC handler that skips sender validation:\n  ' + offenders.join('\n  '),
  );
});

test('every IPC file routes through the guard', () => {
  for (const file of IPC_FILES) {
    const src = read(file);
    if (!/ipcMain\s*\.\s*(handle|on)\s*\(/.test(src)) continue;
    assert.match(
      src,
      /require\(['"]\.\/ipc-guard['"]\)\.guard\(/,
      `${file} registers IPC handlers but never wraps ipcMain with the guard`,
    );
  }
});

test('the guard trusts this application and refuses everything else', () => {
  const { isTrustedFrame } = require('../ipc-guard');
  const previous = process.env.PORT;
  process.env.PORT = '42590';

  try {
    /* Ours. */
    assert.ok(isTrustedFrame({ url: 'http://localhost:42590/public/login.html' }));
    assert.ok(isTrustedFrame({ url: 'http://127.0.0.1:42590/public/dashboard.html' }));
    assert.ok(isTrustedFrame({ url: 'file:///C:/app/resources/app.asar/backup-manager.html' }));

    /* Not ours. Each of these is a way in that existed before the guard. */
    assert.ok(!isTrustedFrame({ url: 'https://evil.example/page' }), 'a remote page');
    assert.ok(!isTrustedFrame({ url: 'http://evil.example/page' }), 'a remote page over http');
    assert.ok(!isTrustedFrame({ url: 'about:blank' }), 'about:blank');
    assert.ok(!isTrustedFrame({ url: '' }), 'an empty url');
    assert.ok(!isTrustedFrame(null), 'no frame at all');
    assert.ok(
      !isTrustedFrame({ url: 'file:///C:/Users/someone/Downloads/evil.html' }),
      'a file this application does not ship',
    );

    /* The one that matters most: print windows are loaded as data: URLs built
       from HTML the renderer supplied. If data: were trusted, a page that can
       ask for a receipt could ask for a restore. */
    assert.ok(
      !isTrustedFrame({ url: 'data:text/html,<script>x</script>' }),
      'a data: URL - this is how print windows are loaded',
    );

    /* Any loopback port is ours. A customer display or catalog window served
       from a second local port must keep its IPC - pinning this to the API's
       port broke that for no gain, since anything on this machine's loopback
       can reach the API anyway. */
    assert.ok(
      isTrustedFrame({ url: 'http://localhost:5555/public/customer-display.html' }),
      'a second local port lost IPC',
    );
    assert.ok(
      isTrustedFrame({ url: 'http://127.0.0.1:9999/x' }),
      'a loopback port other than the API lost IPC',
    );

    /* A LAN device is not this machine. It reaches the API over HTTP like any
       other client; it does not get the main process. */
    assert.ok(
      !isTrustedFrame({ url: 'http://192.168.1.50:42590/public/login.html' }),
      'a LAN address was trusted',
    );

    /* A frame whose url getter throws - Electron does this for a destroyed
       frame - must be refused rather than crash the handler. */
    assert.ok(
      !isTrustedFrame({ get url() { throw new Error('destroyed'); } }),
      'a destroyed frame',
    );
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});

test('the guard does not care which port the app ended up on', () => {
  /* Whatever resolveLocalPorts derives, and whatever a second window is served
     from, loopback is loopback. This used to compare against one port and would
     have refused the customer display. */
  const { isTrustedFrame } = require('../ipc-guard');
  for (const port of [5555, 42590, 43111, 8080]) {
    assert.ok(
      isTrustedFrame({ url: `http://localhost:${port}/x` }),
      `port ${port} lost IPC`,
    );
  }
});

test('a refused message never reaches its handler', () => {
  const { guard } = require('../ipc-guard');

  const registered = new Map();
  const fakeIpcMain = {
    handle: (channel, fn) => registered.set(channel, fn),
    on: (channel, fn) => registered.set(channel, fn),
  };

  let ran = false;
  const refusals = [];
  const ipc = guard(fakeIpcMain, { onRefused: (channel) => refusals.push(channel) });
  ipc.handle('backup:restore', () => { ran = true; return 'restored'; });

  const handler = registered.get('backup:restore');

  assert.throws(
    () => handler({ senderFrame: { url: 'https://evil.example' } }),
    /Refused/,
    'a handler answered a frame that is not ours',
  );
  assert.strictEqual(ran, false, 'the handler body ran for an untrusted frame');
  assert.deepStrictEqual(refusals, ['backup:restore']);

  process.env.PORT = '42590';
  assert.strictEqual(handler({ senderFrame: { url: 'http://localhost:42590/x' } }), 'restored');
  assert.strictEqual(ran, true, 'the handler did not run for a trusted frame');
});

test('every window that loads our preload is sandboxed', () => {
  /* An attacker looks for the weakest renderer, not the main one. The main
     window always set sandbox and webSecurity; the backup, hardware, cloud and
     update windows did not, and they all load the same preload. */
  const src = read('main.js');
  const blocks = src.split('webPreferences:').slice(1);

  const weak = [];
  blocks.forEach((block, i) => {
    const body = block.slice(0, block.indexOf('}') + 1);
    if (!/preload:/.test(body)) return; // no bridge, nothing to reach
    if (!/sandbox:\s*true/.test(body)) weak.push(`webPreferences block ${i + 1}: no sandbox`);
    if (!/webSecurity:\s*true/.test(body)) weak.push(`webPreferences block ${i + 1}: no webSecurity`);
  });

  assert.deepStrictEqual(
    weak,
    [],
    'these windows expose the preload bridge without the main window\'s ' +
      'protections:\n  ' + weak.join('\n  '),
  );
});

test('permissions are denied by default and navigation is confined', () => {
  const src = read('main.js');

  assert.match(
    src,
    /setPermissionRequestHandler/,
    'no permission request handler: Chromium decides, and a page can ask for ' +
      'the camera, microphone, geolocation or clipboard',
  );
  assert.match(
    src,
    /setPermissionCheckHandler/,
    'no permission check handler: the synchronous path is still at the default',
  );
  assert.match(
    src,
    /on\('will-navigate'/,
    'nothing stops the main window navigating to a remote origin with the ' +
      'preload bridge still attached',
  );
  assert.match(
    src,
    /will-attach-webview/,
    'a webview could be attached, creating a renderer nothing here configured',
  );
});
