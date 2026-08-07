/*
 * Where backup restore and delete are allowed to touch.
 *
 * Both are reachable from renderer IPC, and both are destructive: delete
 * removes a folder recursively, restore reads a database out of a folder and
 * writes it over the shop's own. So the boundary is the whole of the safety.
 *
 * deleteBackup drew that boundary with
 *
 *     path.normalize(target).startsWith(path.normalize(root))
 *
 * which compares the spelling of two paths rather than their position. A root
 * of PosnicBackups makes the separate folder PosnicBackups-OLD read as inside
 * it, and it would be deleted.
 *
 * restoreBackup had no boundary at all: any folder containing a manifest.json
 * would do. A page that managed to run someone else's script could point it at
 * a prepared folder and replace the till's books. Restricting it to the backup
 * root alone would have closed that and also broken the case the Browse button
 * exists for - restoring from a USB stick after a machine dies - so the main
 * process now remembers what the user picked in its own dialog, and restore
 * accepts that or the configured root. A renderer can name a granted path; it
 * cannot grant one.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const BackupManager = require('../backup-manager.js');

/* An instance without touching disk: these are pure path decisions. */
function manager(configuredRoot) {
  const Ctor = typeof BackupManager === 'function'
    ? BackupManager
    : BackupManager.BackupManager || BackupManager.default;
  const m = Object.create(Ctor.prototype);
  m.loadConfig = () => ({ path: configuredRoot });
  return m;
}

const ROOT = path.resolve('C:/Users/Kayal/PosnicBackups');

/* ---- the boundary itself ---------------------------------------------- */

test('a folder inside the root is inside it', () => {
  const m = manager(ROOT);
  assert.strictEqual(m._isInside(ROOT, path.join(ROOT, '2026-08-03')), true);
  assert.strictEqual(m._isInside(ROOT, path.join(ROOT, 'a', 'b', 'c')), true);
});

test('the root is inside itself', () => {
  const m = manager(ROOT);
  assert.strictEqual(m._isInside(ROOT, ROOT), true);
});

test('a sibling that merely starts with the same letters is not inside', () => {
  /* The bug, stated exactly. PosnicBackups-OLD is a different folder. */
  const m = manager(ROOT);
  assert.strictEqual(m._isInside(ROOT, ROOT + '-OLD'), false);
  assert.strictEqual(m._isInside(ROOT, ROOT + '-OLD' + path.sep + 'anything'), false);
  assert.strictEqual(m._isInside(ROOT, ROOT + '2'), false);
});

test('climbing out with .. is not inside', () => {
  const m = manager(ROOT);
  assert.strictEqual(
    m._isInside(ROOT, path.join(ROOT, '..', '..', 'Windows', 'System32')), false);
});

test('the parent is not inside the child', () => {
  const m = manager(ROOT);
  assert.strictEqual(m._isInside(ROOT, path.dirname(ROOT)), false);
});

test('nothing is inside nothing', () => {
  const m = manager(ROOT);
  assert.strictEqual(m._isInside(ROOT, ''), false);
  assert.strictEqual(m._isInside('', ROOT), false);
  assert.strictEqual(m._isInside(ROOT, null), false);
});

/* ---- delete ------------------------------------------------------------ */

test('delete refuses a path outside the configured root', () => {
  const m = manager(ROOT);
  const out = m.deleteBackup(ROOT + '-OLD' + path.sep + 'x');

  assert.strictEqual(out.success, false);
  assert.match(out.error, /outside backup root/);
});

test('delete refuses a traversal', () => {
  const m = manager(ROOT);
  const out = m.deleteBackup(path.join(ROOT, '..', 'Documents'));

  assert.strictEqual(out.success, false);
  assert.match(out.error, /outside backup root/);
});

/* ---- restore ----------------------------------------------------------- */

test('restore refuses a folder nobody chose', async () => {
  const m = manager(ROOT);
  m.isRunning = false;

  const out = await m.restoreBackup('C:/Windows/Temp/prepared-by-someone-else');

  assert.strictEqual(out.success, false);
  assert.match(String(out.error), /file picker|Browse/);
});

test('restore accepts the configured backup root', async () => {
  /* It gets past the boundary and fails later for a real reason - the folder
     does not exist - which is what proves the boundary let it through. */
  const m = manager(ROOT);
  m.isRunning = false;

  const out = await m.restoreBackup(path.join(ROOT, '2026-08-03'));

  assert.strictEqual(out.success, false);
  assert.doesNotMatch(String(out.error), /file picker|Browse/);
});

test('restore accepts what the user picked in the dialog', async () => {
  const m = manager(ROOT);
  m.isRunning = false;

  const usbStick = 'E:/PosnicBackup';
  let out = await m.restoreBackup(usbStick);
  assert.match(String(out.error), /file picker|Browse/, 'should be refused before granting');

  m.grantRestorePath(usbStick);

  out = await m.restoreBackup(usbStick);
  assert.doesNotMatch(String(out.error), /file picker|Browse/,
    'should be allowed once the user has chosen it');
});

test('a granted folder also allows the dated folders inside it', async () => {
  /* The dialog selects the parent; the backups sit in dated folders below. */
  const m = manager(ROOT);
  m.isRunning = false;
  m.grantRestorePath('E:/PosnicBackup');

  const out = await m.restoreBackup('E:/PosnicBackup/2026-08-03');
  assert.doesNotMatch(String(out.error), /file picker|Browse/);
});

test('granting one folder does not grant its neighbours', async () => {
  const m = manager(ROOT);
  m.isRunning = false;
  m.grantRestorePath('E:/PosnicBackup');

  const out = await m.restoreBackup('E:/PosnicBackup-OTHER');
  assert.match(String(out.error), /file picker|Browse/);
});

test('only the main process can grant, and it does', () => {
  /* The grant is called from the folder-picker handler, with what the OS
     dialog returned - not with anything the renderer sent. */
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  const from = main.indexOf("ipcMain.handle('backup:browse-folder'");
  assert.notStrictEqual(from, -1, 'the folder-picker handler has gone');

  /* To the next ipcMain.handle, not to the first "});" - the dialog call
     inside the handler contains one of those. */
  const next = main.indexOf('ipcMain.handle(', from + 1);
  const body = main.slice(from, next === -1 ? main.length : next);

  assert.match(body, /grantRestorePath\(result\.filePaths\[0\]\)/,
    'the folder picker no longer grants the path it returned, so restoring '
    + 'from a chosen folder will be refused');
});
