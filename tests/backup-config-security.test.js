const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BackupManager = require('../src/backup-manager');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-backup-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const m = new BackupManager({ userDataPath: root });
  m.defaultConfig.path = path.join(root, 'backups');
  fs.mkdirSync(m.defaultConfig.path);
  return { m, root };
}
test('renderer cannot grant a root or overwrite internal state', (t) => {
  const { m, root } = fixture(t);
  for (const config of [
    { path: root },
    { path: path.parse(root).root },
    { status: 'success' },
    { lastBackupHash: 'fake' },
    { retentionDays: 0 },
    { enabled: 'true' },
  ]) {
    assert.throws(() => m.saveConfig(config));
  }
  assert.equal(m.loadConfig().path, m.defaultConfig.path);
});
test('OS-selected destination and ordinary schedule persist without losing internal status', (t) => {
  const { m, root } = fixture(t);
  const selected = path.join(root, 'selected');
  fs.mkdirSync(selected);
  m.grantBackupPath(selected);
  m._saveConfig({ status: 'success', lastBackup: 'previous' });
  m.saveConfig({
    path: selected,
    enabled: true,
    frequency: 'daily',
    time: '02:30',
    retentionDays: 14,
  });
  assert.equal(m.loadConfig().path, fs.realpathSync(selected));
  assert.equal(m.loadConfig().lastBackup, 'previous');
  const restarted = new BackupManager({ userDataPath: root });
  restarted.saveConfig({ path: selected, enabled: false });
  assert.equal(restarted.loadConfig().path, selected);
});
test('delete protects root and unrelated data; deletes only a backup child', (t) => {
  const { m } = fixture(t);
  const root = m.loadConfig().path;
  const other = path.join(root, 'documents');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'keep.txt'), 'keep');
  assert.equal(m.deleteBackup(root).success, false);
  assert.equal(m.deleteBackup(other).success, false);
  assert.equal(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8'), 'keep');
  const backup = path.join(root, 'posnic-backup-test');
  fs.mkdirSync(backup);
  fs.writeFileSync(
    path.join(backup, 'manifest.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), collections: [] }),
  );
  assert.equal(m.deleteBackup(backup).success, true);
  assert.equal(fs.existsSync(backup), false);
});
test('delete refuses a junction escaping the root', (t) => {
  const { m, root } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const link = path.join(m.loadConfig().path, 'posnic-backup-link');
  fs.symlinkSync(outside, link, 'junction');
  assert.equal(m.deleteBackup(link).success, false);
  assert.equal(fs.existsSync(outside), true);
});

test('all backup IPC rejects other windows and child frames before touching a manager', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const handlers = new Map();
  const frame = {};
  const webContents = { mainFrame: frame };
  let calls = 0;
  const mainFrame = {};
  const mainContents = { mainFrame };
  const context = {
    mainWindow: { isDestroyed: () => false, webContents: mainContents },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    backupWindow: { isDestroyed: () => false, webContents },
    getBackupManager: () => {
      calls++;
      return { loadConfig: () => ({ path: 'safe' }) };
    },
    path,
    app: { getPath: () => '/safe' },
  };
  vm.runInNewContext(
    source.slice(
      source.indexOf('function requireBackupWindow('),
      source.indexOf('// Open backup manager window'),
    ),
    context,
  );
  assert.equal(handlers.size, 10);
  for (const handler of handlers.values()) {
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: webContents, senderFrame: {} },
    ]) {
      await assert.rejects(async () => handler(event, {}), /Open Backup Manager/);
    }
  }
  assert.equal(calls, 0);
  assert.equal(
    handlers.get('backup:get-config')({ sender: webContents, senderFrame: frame }).success,
    true,
  );
  const mainEvent = { sender: mainContents, senderFrame: mainFrame };
  assert.equal(handlers.get('backup:get-config')(mainEvent).success, true);
  for (const name of ['backup:restore', 'backup:delete'])
    await assert.rejects(async () => handlers.get(name)(mainEvent), /Open Backup Manager/);
});
test('restore refuses a junction to an unselected folder', (t) => {
  const { m, root } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const link = path.join(m.loadConfig().path, 'escaped');
  fs.symlinkSync(outside, link, 'junction');
  assert.equal(m._mayRestoreFrom(link), false);
});
