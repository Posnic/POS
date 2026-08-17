/*
 * Applying an update when the shop closes the till, and the ordering that makes
 * it safe.
 *
 * This is the pattern every desktop application people already trust uses:
 * download quietly, apply on the next close. It suits a till better than it
 * suits a browser - a shop closes at the end of the day anyway, so the restart
 * costs nothing, and the one moment an update must never interrupt is the one
 * moment this cannot fire.
 *
 * electron-updater has autoInstallOnAppQuit for exactly this and it is
 * deliberately not used. Its quit handler bypasses quitAndInstall(), and with
 * it the forced backup that runs before an update is applied. The sequencing is
 * done here instead, and the order is the thing worth protecting: the backup
 * has to happen while the database is still running. Afterwards it would fail,
 * or - worse - appear to succeed and hold nothing.
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

const MAIN = read("main.js");
const SERVICE = read("update-service.js");
const UI = read("update-manager.html");
const INTEGRATION = read("update-integration.js");
const PRELOAD = read("preload.js");

test("electron-updater's own quit installer stays off", () => {
  /* Turning it on would silently drop the pre-update backup. */
  assert.match(
    SERVICE,
    /autoInstallOnAppQuit\s*=\s*false/,
    'autoInstallOnAppQuit must stay false - its quit handler bypasses ' +
      'quitAndInstall() and the backup that runs inside it',
  );
  /* The first version of this test only checked that the false assignment
     existed - and a later change set the flag to true elsewhere at runtime
     (on update-downloaded), which this grep happily missed while the backup
     guarantee was silently gone. Assert the absence of ANY true assignment. */
  assert.doesNotMatch(
    SERVICE,
    /autoInstallOnAppQuit\s*=\s*true/,
    'something sets autoInstallOnAppQuit = true at runtime - that re-enables ' +
      "electron-updater's own quit handler, bypassing the pre-update backup " +
      'and the installOnQuit setting',
  );
});

test('the backup runs before the shutdown that stops the database', () => {
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body = handler.slice(0, handler.indexOf('\n});'));

  const prepare = body.indexOf('prepareQuitInstall');
  const shutdown = body.indexOf('performGracefulShutdown');

  assert.ok(prepare > -1, 'nothing takes a backup before quitting with an update waiting');
  assert.ok(shutdown > -1, 'the graceful shutdown is not in this handler any more');
  assert.ok(
    prepare < shutdown,
    'the pre-update backup is sequenced after the shutdown, so it would run ' +
      'with mongod already stopped - producing a failure, or an empty backup ' +
      'that looks like a success',
  );
});

test('and the install happens after the shutdown, not before it', () => {
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body = handler.slice(0, handler.indexOf('\n});'));

  const shutdown = body.indexOf('performGracefulShutdown');
  const install = body.indexOf('finishQuitInstall');

  assert.ok(install > -1, 'the update is never handed to the installer');
  assert.ok(
    shutdown < install,
    'the installer is invoked before the database and API have stopped',
  );
});

test('a failed backup cancels the update, not the shutdown', () => {
  /* An update deferred costs a day. An update applied over a database with no
     backup can cost the year. */
  const fn = SERVICE.slice(SERVICE.indexOf('async prepareQuitInstall()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /catch/, 'a backup failure is not caught');
  assert.match(body, /ok:\s*false/, 'a backup failure does not report itself as a failure');

  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body2 = handler.slice(0, handler.indexOf('\n});'));
  assert.match(body2, /app\.exit\(0\)/, 'the process must still exit when the update is skipped');
});

test('nothing installs on quit unless the shop left the setting on', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('shouldInstallOnQuit()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));

  assert.match(body, /isDownloaded\(\)/, 'it would try to install with nothing downloaded');
  assert.match(body, /installOnQuit/, 'the setting is not consulted');
  assert.match(body, /app\.isPackaged/, 'it would try to install from a checkout');
});

test('the setting is reachable from the Updates screen', () => {
  assert.match(UI, /id="setInstallOnQuit"/, 'no control for install-on-close');
  assert.match(UI, /saveConfig\(\{[^}]*installOnQuit/, 'the control does not persist');
});

test('the screen says what will actually happen, not a generic instruction', () => {
  /* "Restart to apply" is untrue when it will apply itself, and a screen that
     tells small untruths stops being read. */
  const fn = UI.slice(UI.indexOf("if (st === 'downloaded'"));
  const body = fn.slice(0, fn.indexOf('\n        }'));
  assert.match(body, /setInstallOnQuit/, 'the message ignores the setting');
  assert.match(body, /close Posnic/i, 'it never mentions the close-to-install behaviour');
});

test('what changed is shown, and shown as text', () => {
  /* A shop that turned automatic updates off is being asked to decide, and
     "a new version is available" is not something to decide on. */
  assert.match(UI, /id="releaseNotes"/, 'release notes are never rendered');

  const fn = UI.slice(UI.indexOf('function showNotes'));
  const body = fn.slice(0, fn.indexOf('\n    }\n'));
  assert.match(body, /textContent = info\.releaseNotes/, 'notes are not rendered as text');
  assert.match(body, /'available'|'downloaded'/, 'notes are not tied to a state');

  /* Comments are allowed to name innerHTML - the one here exists to say why it
     is not used. Only the code is checked. */
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(
    code,
    /innerHTML/,
    'release notes travel from github.com and this window can reach the ' +
      'updater through its preload - they must never be written as markup',
  );
});

test('notes survive a till that skipped several releases', () => {
  /* electron-updater hands over an array when more than one release was
     missed. Keeping only the string form meant the shop with the most to read
     saw nothing. */
  const fn = SERVICE.slice(SERVICE.indexOf('_notes(raw)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /Array\.isArray/, 'the multi-release array form is dropped');
  assert.match(body, /replace\(\/<\[\^>\]\*>\/g/, 'markup in a release body is not stripped');
});

test('the GitHub token flow is gone from every layer', () => {
  /* It asked shopkeepers for a credential no shop has, wrote it to disk in
     plain text, and bought nothing once releases are public. */
  for (const [name, src] of [
    ['update-service.js', SERVICE],
    ['update-integration.js', INTEGRATION],
    ['preload.js', PRELOAD],
    ['main.js', MAIN],
  ]) {
    /* Comments explaining the removal are fine; code is not. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.doesNotMatch(code, /process\.env\.GH_TOKEN/, `${name} still reads GH_TOKEN`);
    assert.doesNotMatch(code, /saveToken|hasToken|loadToken/, `${name} still handles a token`);
    assert.doesNotMatch(code, /requestHeaders/, `${name} still sets an Authorization header`);
  }
});

test('and a token left by an older build is deleted, not ignored', () => {
  /* Leaving it is leaving a credential in plain text beside the database
     credentials, which are not. */
  assert.match(SERVICE, /_removeLegacyCredentials/, 'nothing cleans up the old token file');
  const fn = SERVICE.slice(SERVICE.indexOf('_removeLegacyCredentials()'));
  assert.match(fn.slice(0, 600), /unlinkSync/, 'the old token file is not removed');
});

test('the releases link is a named intent, not a URL from the page', () => {
  /* desktop:open is an allowlist. Letting a page pass its own address would
     turn it into an open redirect for anything that reaches the channel. */
  /* The call is made through whichever preload bridge actually carries
     desktop, so the receiver's name is not the point - what must hold is that
     the argument is the intent 'releases' and never an address. */
  assert.match(UI, /\.open\('releases'\)/, 'the page passes something other than an intent');
  assert.doesNotMatch(
    UI,
    /\.open\(\s*['"`]https?:/,
    'the page passes a URL to desktop:open, which would make the allowlist an ' +
      'open redirect for anything that can reach the channel',
  );
  assert.match(MAIN, /case 'releases':/, 'the main process has no releases target');
  const fn = MAIN.slice(MAIN.indexOf("ipcMain.handle('desktop:open'"));
  const body = fn.slice(0, fn.indexOf('\n});'));
  assert.match(body, /default: return false/, 'the allowlist has no closed default');
});
