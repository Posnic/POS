const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('connected desktop can back up but cannot restore into an active sync connection', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const handlers = new Map();
  const frame = {}, contents = { mainFrame: frame };
  let connected = true, backups = 0, restores = 0;
  vm.runInNewContext(source.slice(source.indexOf('function requireBackupWindow('), source.indexOf('// Open backup manager window')), {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    backupWindow: { isDestroyed: () => false, webContents: contents },
    mainWindow: null,
    fs: { existsSync: () => connected },
    CLOUD_CONFIG_FILE: '/test/cloud.json',
    getBackupManager: () => ({
      runBackup: async () => { backups++; return { success: true }; },
      restoreBackup: async () => { restores++; return { success: false, error: 'fixture' }; },
    }),
  });
  const event = { sender: contents, senderFrame: frame };
  assert.equal((await handlers.get('backup:run-now')(event, true)).success, true);
  assert.equal(backups, 1);
  const denied = await handlers.get('backup:restore')(event, '/test/backup');
  assert.equal(denied.success, false);
  assert.match(denied.error, /Disconnect this device/);
  assert.equal(restores, 0);
  connected = false;
  await handlers.get('backup:restore')(event, '/test/backup');
  assert.equal(restores, 1);
});
